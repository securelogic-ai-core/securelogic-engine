/**
 * erasureExecutor.ts — request, approve, dry-run and execute a tenant erasure.
 *
 * UNREACHABLE FROM THE APPLICATION BY CONSTRUCTION. There is no route, no
 * worker, no job type and no cron that calls this. It takes a `PoolClient` it
 * does not create, and the destructive path only succeeds on a connection whose
 * `session_user` is `erasure_agent` — a role that is NOLOGIN until Increment 4
 * issues a credential. Importing this module grants nothing.
 *
 * ── THE PROPERTY THIS FILE EXISTS FOR ───────────────────────────────────────
 *
 * "We checked the legal hold ten minutes ago" is not a safety property. Between
 * approval and destruction a hold can be placed, the tenant can grow by an
 * order of magnitude, the approver can be deprovisioned, the organization can
 * already be gone. So every destructive precondition is re-derived from freshly
 * read rows inside the SAME transaction as the deletion — and then re-checked
 * again, independently, by the database guard on every single row.
 *
 * Two mechanisms, deliberately not sharing an assumption: the executor can be
 * wrong about a hold and the trigger still refuses.
 */

import type { PoolClient } from "pg";
import { logger } from "../../../infra/logger.js";
import {
  APPROVAL_TTL_HOURS,
  approvalExpiry,
  canApproveErasure,
  canRequestErasure,
  certificateRetainUntil,
  diffInventory,
  evaluateExecutionGate,
  organizationNameDigest,
  scopeFingerprint,
  type ExecutionRefusal,
  type Inventory,
} from "./erasurePolicy.js";
import { clearBlockingRows, inventoryOrganization } from "./erasureInventory.js";

export interface CertificateRow {
  id: string;
  organization_id: string;
  requested_by_user_id: string;
  approved_by_user_id: string | null;
  status: string;
  dry_run: boolean;
  scope_fingerprint: string | null;
  inventory_snapshot: Inventory | null;
  approval_expires_at: Date | null;
  attempt_count: number;
}

/* ────────────────────────────── audit ────────────────────────────────────── */

export const ERASURE_EVENTS = {
  requested: "governance.erasure_requested",
  approved: "governance.erasure_approved",
  denied: "governance.erasure_denied",
  dryRun: "governance.erasure_dry_run",
  started: "governance.erasure_started",
  failed: "governance.erasure_failed",
  completed: "governance.erasure_completed",
} as const;

/**
 * Erasure audit events, written directly rather than through
 * governanceAudit.recordGovernanceEvent, for one reason that matters:
 * `security_audit_log.organization_id` has a foreign key to `organizations`.
 * After the tenant is gone that FK cannot be satisfied, so the completion event
 * — the single most important one — MUST be written with a NULL organization
 * and the erased id carried in the payload instead.
 *
 * Payloads carry identifiers, counts and governance text. Never content.
 */
async function audit(
  client: PoolClient,
  input: {
    organizationId: string | null;
    actorUserId: string | null;
    eventType: string;
    certificateId: string;
    payload: Record<string, unknown>;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO security_audit_log
       (organization_id, actor_user_id, event_type, resource_type, resource_id, payload)
     VALUES ($1,$2,$3,'erasure_certificate',$4,$5)`,
    [
      input.organizationId,
      input.actorUserId,
      input.eventType,
      input.certificateId,
      JSON.stringify(input.payload),
    ]
  );
}

/* ───────────────────────────── request ───────────────────────────────────── */

export type RequestResult =
  | { outcome: "requested"; certificateId: string; inventory: Inventory; totalRows: number }
  | { outcome: "denied"; reason: string };

/** Take the inventory and open a draft certificate. Destroys nothing. */
export async function requestErasure(
  client: PoolClient,
  input: {
    organizationId: string;
    actorUserId: string | null;
    actorRole: string | null;
    reason: string;
    legalBasis: "gdpr_art17_request" | "contract_termination" | "operator_decommission";
  }
): Promise<RequestResult> {
  const authority = canRequestErasure(input);
  if (!authority.allowed) return { outcome: "denied", reason: authority.reason! };

  const org = await client.query<{ name: string }>(
    `SELECT name FROM organizations WHERE id = $1`,
    [input.organizationId]
  );
  if (org.rowCount === 0) return { outcome: "denied", reason: "organization_missing" };

  const snapshot = await inventoryOrganization(client, input.organizationId);

  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO erasure_certificates
       (organization_id, organization_name_digest, requested_by_user_id, reason,
        legal_basis, dry_run, status, inventory_snapshot)
     VALUES ($1,$2,$3,$4,$5,TRUE,'draft',$6)
     RETURNING id`,
    [
      input.organizationId,
      organizationNameDigest(org.rows[0]!.name),
      input.actorUserId,
      input.reason,
      input.legalBasis,
      JSON.stringify(snapshot.inventory),
    ]
  );
  const certificateId = rows[0]!.id;

  await audit(client, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    eventType: ERASURE_EVENTS.requested,
    certificateId,
    payload: {
      legalBasis: input.legalBasis,
      tablesWithRows: Object.keys(snapshot.inventory).length,
      totalRows: snapshot.totalRows,
      tablesScanned: snapshot.tablesScanned,
    },
  });

  return {
    outcome: "requested",
    certificateId,
    inventory: snapshot.inventory,
    totalRows: snapshot.totalRows,
  };
}

/* ───────────────────────────── approve ───────────────────────────────────── */

export type ApproveResult =
  | { outcome: "approved"; fingerprint: string; expiresAt: Date }
  | { outcome: "denied"; reason: string };

/**
 * The second person. Re-takes the inventory at approval time and BINDS the
 * approval to it: what is approved is a specific measured scope, not a tenant
 * name.
 *
 * `destructive` is opt-in. A certificate stays dry-run unless an approver
 * explicitly clears it for destruction, so the default outcome of this whole
 * subsystem is a rehearsal.
 */
export async function approveErasure(
  client: PoolClient,
  input: {
    certificateId: string;
    actorUserId: string | null;
    actorRole: string | null;
    destructive: boolean;
    now?: Date;
  }
): Promise<ApproveResult> {
  const now = input.now ?? new Date();
  const { rows } = await client.query<CertificateRow>(
    `SELECT id, organization_id, requested_by_user_id, approved_by_user_id, status,
            dry_run, scope_fingerprint, inventory_snapshot, approval_expires_at, attempt_count
       FROM erasure_certificates WHERE id = $1 FOR UPDATE`,
    [input.certificateId]
  );
  const cert = rows[0];
  if (!cert) return { outcome: "denied", reason: "certificate_not_found" };

  const authority = canApproveErasure({
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    requestedByUserId: cert.requested_by_user_id,
    currentStatus: cert.status,
  });
  if (!authority.allowed) {
    await audit(client, {
      organizationId: cert.organization_id,
      actorUserId: input.actorUserId,
      eventType: ERASURE_EVENTS.denied,
      certificateId: cert.id,
      payload: { stage: "approval", reason: authority.reason },
    });
    return { outcome: "denied", reason: authority.reason! };
  }

  const snapshot = await inventoryOrganization(client, cert.organization_id);
  const fingerprint = scopeFingerprint(cert.organization_id, snapshot.inventory);
  const expiresAt = approvalExpiry(now);

  await client.query(
    `UPDATE erasure_certificates
        SET status='approved', approved_by_user_id=$2, approved_at=$3,
            scope_fingerprint=$4, inventory_snapshot=$5, approval_expires_at=$6,
            dry_run=$7
      WHERE id=$1`,
    [
      cert.id,
      input.actorUserId,
      now,
      fingerprint,
      JSON.stringify(snapshot.inventory),
      expiresAt,
      !input.destructive,
    ]
  );

  await audit(client, {
    organizationId: cert.organization_id,
    actorUserId: input.actorUserId,
    eventType: ERASURE_EVENTS.approved,
    certificateId: cert.id,
    payload: {
      requestedBy: cert.requested_by_user_id,
      approvedBy: input.actorUserId,
      destructive: input.destructive,
      scopeFingerprint: fingerprint,
      totalRows: snapshot.totalRows,
      approvalTtlHours: APPROVAL_TTL_HOURS,
      expiresAt: expiresAt.toISOString(),
    },
  });

  return { outcome: "approved", fingerprint, expiresAt };
}

/* ───────────────────────────── dry run ───────────────────────────────────── */

export interface DryRunReport {
  certificateId: string;
  organizationId: string;
  wouldDelete: Inventory;
  totalRows: number;
  blockingTables: string[];
  activeLegalHolds: number;
  scopeMatchesApproval: boolean | null;
  refusalIfExecutedNow: ExecutionRefusal | null;
}

/**
 * The default mode. Reads only — it takes no locks on tenant rows, writes no
 * certificate state, and destroys nothing. It reports what WOULD happen,
 * including the refusal that would be returned if execution were attempted at
 * this instant.
 */
export async function dryRunErasure(
  client: PoolClient,
  input: { certificateId: string; actorUserId: string | null; now?: Date }
): Promise<DryRunReport | { outcome: "denied"; reason: string }> {
  const now = input.now ?? new Date();
  const { rows } = await client.query<CertificateRow>(
    `SELECT id, organization_id, requested_by_user_id, approved_by_user_id, status,
            dry_run, scope_fingerprint, inventory_snapshot, approval_expires_at, attempt_count
       FROM erasure_certificates WHERE id = $1`,
    [input.certificateId]
  );
  const cert = rows[0];
  if (!cert) return { outcome: "denied", reason: "certificate_not_found" };

  const orgExists = (await client.query(`SELECT 1 FROM organizations WHERE id=$1`, [
    cert.organization_id,
  ])).rowCount === 1;

  const holds = (await client.query<{ n: string }>(
    `SELECT erasure_active_hold_count($1)::text AS n`,
    [cert.organization_id]
  )).rows[0]!.n;

  const snapshot = orgExists
    ? await inventoryOrganization(client, cert.organization_id)
    : { inventory: {} as Inventory, totalRows: 0, blocking: [], tablesScanned: 0, organizationId: cert.organization_id };

  const observed = orgExists ? scopeFingerprint(cert.organization_id, snapshot.inventory) : null;

  const gate = evaluateExecutionGate({
    status: cert.status,
    dryRun: cert.dry_run,
    requestedByUserId: cert.requested_by_user_id,
    approvedByUserId: cert.approved_by_user_id,
    approvalExpiresAt: cert.approval_expires_at,
    scopeFingerprint: cert.scope_fingerprint,
    observedFingerprint: observed,
    organizationExists: orgExists,
    activeLegalHolds: Number(holds),
    now,
  });

  await audit(client, {
    organizationId: orgExists ? cert.organization_id : null,
    actorUserId: input.actorUserId,
    eventType: ERASURE_EVENTS.dryRun,
    certificateId: cert.id,
    payload: {
      totalRows: snapshot.totalRows,
      tablesWithRows: Object.keys(snapshot.inventory).length,
      activeLegalHolds: Number(holds),
      wouldProceed: gate.proceed,
      refusal: gate.refusal ?? null,
    },
  });

  return {
    certificateId: cert.id,
    organizationId: cert.organization_id,
    wouldDelete: snapshot.inventory,
    totalRows: snapshot.totalRows,
    blockingTables: [...new Set(snapshot.blocking.map((b) => b.child))].sort(),
    activeLegalHolds: Number(holds),
    scopeMatchesApproval: cert.scope_fingerprint ? observed === cert.scope_fingerprint : null,
    refusalIfExecutedNow: gate.refusal ?? null,
  };
}

/* ──────────────────────────── execute ────────────────────────────────────── */

export type ExecuteResult =
  | { outcome: "erased"; certificateId: string; deleted: Record<string, number>; totalRows: number }
  | { outcome: "already_erased"; certificateId: string }
  | { outcome: "refused"; reason: ExecutionRefusal | "not_erasure_agent" };

/**
 * Claim the certificate in its OWN committed transaction, before anything
 * destructive is attempted.
 *
 * This is what makes an interrupted erasure diagnosable. If the process dies
 * after this and before the destructive transaction commits, the certificate is
 * left in `executing` with a bumped attempt_count and a timestamp — visible
 * evidence that something was tried — while the tenant data is untouched,
 * because the destructive work is a separate atomic transaction that rolled
 * back. Without this the two outcomes "never started" and "died mid-run" would
 * be indistinguishable.
 */
export async function claimForExecution(
  client: PoolClient,
  certificateId: string,
  now: Date = new Date()
): Promise<void> {
  await client.query(
    `UPDATE erasure_certificates
        SET status='executing', started_at=COALESCE(started_at,$2),
            attempt_count=attempt_count+1, last_attempt_at=$2, failure_reason=NULL
      WHERE id=$1`,
    [certificateId, now]
  );
}

/**
 * Destroy the tenant. Everything is re-derived here; nothing is trusted from
 * approval time.
 *
 * The caller supplies a client whose session_user is `erasure_agent`; if it is
 * not, this refuses before touching anything, and the database guard would
 * refuse anyway.
 */
export async function executeErasure(
  client: PoolClient,
  input: { certificateId: string; actorUserId: string | null; now?: Date }
): Promise<ExecuteResult> {
  const now = input.now ?? new Date();

  const who = await client.query<{ session_user: string }>(`SELECT session_user`);
  if (who.rows[0]!.session_user !== "erasure_agent") {
    return { outcome: "refused", reason: "not_erasure_agent" };
  }

  // FOR UPDATE: a second executor blocks here rather than racing us, which is
  // what makes duplicate execution safe rather than merely unlikely.
  const { rows } = await client.query<CertificateRow>(
    `SELECT id, organization_id, requested_by_user_id, approved_by_user_id, status,
            dry_run, scope_fingerprint, inventory_snapshot, approval_expires_at, attempt_count
       FROM erasure_certificates WHERE id = $1 FOR UPDATE`,
    [input.certificateId]
  );
  const cert = rows[0];
  if (!cert) return { outcome: "refused", reason: "certificate_not_found" };

  const orgExists = (await client.query(`SELECT 1 FROM organizations WHERE id=$1`, [
    cert.organization_id,
  ])).rowCount === 1;

  // Idempotency: a retry after a successful run finds the tenant already gone.
  // That is a completion, not a failure and not a second erasure.
  if (!orgExists && cert.status === "executing") {
    await finalize(client, cert, {}, 0, now, input.actorUserId);
    return { outcome: "already_erased", certificateId: cert.id };
  }

  // ── THE TOCTOU BOUNDARY ───────────────────────────────────────────────────
  // Freshly read, inside this transaction, moments before destruction.
  // Definer-rights read. A direct SELECT here runs as erasure_agent, which is
  // NOBYPASSRLS with no tenant context set — legal_holds' RLS policy would
  // return zero rows and the check would FAIL OPEN. See 20261019.
  const holds = Number(
    (await client.query<{ n: string }>(
      `SELECT erasure_active_hold_count($1)::text AS n`,
      [cert.organization_id]
    )).rows[0]!.n
  );
  const snapshot = orgExists
    ? await inventoryOrganization(client, cert.organization_id)
    : null;
  const observed = snapshot ? scopeFingerprint(cert.organization_id, snapshot.inventory) : null;

  const gate = evaluateExecutionGate({
    status: cert.status,
    dryRun: cert.dry_run,
    requestedByUserId: cert.requested_by_user_id,
    approvedByUserId: cert.approved_by_user_id,
    approvalExpiresAt: cert.approval_expires_at,
    scopeFingerprint: cert.scope_fingerprint,
    observedFingerprint: observed,
    organizationExists: orgExists,
    activeLegalHolds: holds,
    now,
  });

  if (!gate.proceed) {
    await audit(client, {
      organizationId: orgExists ? cert.organization_id : null,
      actorUserId: input.actorUserId,
      eventType: ERASURE_EVENTS.denied,
      certificateId: cert.id,
      payload: { stage: "execution", reason: gate.refusal, activeLegalHolds: holds },
    });
    logger.warn(
      { event: "erasure_refused", certificate_id: cert.id, reason: gate.refusal },
      "tenant erasure refused at the execution gate"
    );
    return { outcome: "refused", reason: gate.refusal! };
  }

  await audit(client, {
    organizationId: cert.organization_id,
    actorUserId: input.actorUserId,
    eventType: ERASURE_EVENTS.started,
    certificateId: cert.id,
    payload: {
      attempt: cert.attempt_count,
      totalRows: snapshot!.totalRows,
      scopeFingerprint: observed,
    },
  });

  // Move the certificate to 'executing' INSIDE this transaction. The guard
  // requires that state, so the window in which destruction is possible is
  // exactly this transaction: if it rolls back, the status reverts with it and
  // nothing is left armed.
  //
  // This is distinct from claimForExecution(), which commits separately BEFORE
  // this runs so that an interrupted attempt leaves a durable trace. The two
  // together give both properties: a visible attempt record, and an armed
  // window that cannot outlive its transaction.
  await client.query(
    `UPDATE erasure_certificates
        SET status='executing', started_at=COALESCE(started_at,$2)
      WHERE id=$1 AND status IN ('approved','executing')`,
    [cert.id, now]
  );

  // Arm the database guard for THIS org and THIS certificate only.
  await client.query(`SELECT set_config('app.erasure_certificate_id', $1, true)`, [cert.id]);
  await client.query(`SELECT set_config('app.erasure_org_id', $1, true)`, [cert.organization_id]);

  const cleared = await clearBlockingRows(client, cert.organization_id, snapshot!.blocking);
  const orgDelete = await client.query(`DELETE FROM organizations WHERE id = $1`, [
    cert.organization_id,
  ]);

  // Completion criterion: the organization row is actually gone. The
  // certificate is only written once that is true.
  if ((orgDelete.rowCount ?? 0) !== 1) {
    throw new Error("erasure: organization row was not deleted; refusing to certify");
  }
  const stillThere = await client.query(`SELECT 1 FROM organizations WHERE id=$1`, [
    cert.organization_id,
  ]);
  if (stillThere.rowCount !== 0) {
    throw new Error("erasure: organization still present after delete; refusing to certify");
  }

  await finalize(client, cert, { ...cleared, organizations: 1 }, snapshot!.totalRows, now, input.actorUserId);

  return {
    outcome: "erased",
    certificateId: cert.id,
    deleted: { ...cleared, organizations: 1 },
    totalRows: snapshot!.totalRows,
  };
}

/** Write the completion state and the certificate's scope digest. */
async function finalize(
  client: PoolClient,
  cert: CertificateRow,
  deleted: Record<string, number>,
  totalRows: number,
  now: Date,
  actorUserId: string | null
): Promise<void> {
  await client.query(
    `UPDATE erasure_certificates
        SET status='completed', completed_at=$2, retain_until=$3, scope_digest=$4
      WHERE id=$1`,
    [cert.id, now, certificateRetainUntil(now), JSON.stringify(deleted)]
  );

  // organization_id is NULL: the FK to organizations can no longer be
  // satisfied, and the erased id lives in the payload instead.
  await audit(client, {
    organizationId: null,
    actorUserId,
    eventType: ERASURE_EVENTS.completed,
    certificateId: cert.id,
    payload: {
      erasedOrganizationId: cert.organization_id,
      totalRowsAtInventory: totalRows,
      deletedByTable: deleted,
      retainUntilYears: 7,
    },
  });
}

/** Record a failed attempt so the next operator can see what happened. */
export async function recordExecutionFailure(
  client: PoolClient,
  certificateId: string,
  err: unknown,
  now: Date = new Date()
): Promise<void> {
  const message = ((err as Error)?.message ?? String(err)).slice(0, 2000);
  await client.query(
    `UPDATE erasure_certificates SET failure_reason=$2 WHERE id=$1 AND status='executing'`,
    [certificateId, message]
  );
  const cert = (await client.query<{ organization_id: string }>(
    `SELECT organization_id FROM erasure_certificates WHERE id=$1`,
    [certificateId]
  )).rows[0];
  const orgExists = cert
    ? (await client.query(`SELECT 1 FROM organizations WHERE id=$1`, [cert.organization_id])).rowCount === 1
    : false;
  await audit(client, {
    organizationId: orgExists ? cert!.organization_id : null,
    actorUserId: null,
    eventType: ERASURE_EVENTS.failed,
    certificateId,
    payload: { errorCode: message.slice(0, 200) },
  });
  logger.error(
    { event: "erasure_failed", certificate_id: certificateId, message },
    "tenant erasure attempt failed"
  );
}

export { diffInventory };
