/**
 * erasurePolicy.ts — the DB-free decisions behind a tenant erasure.
 *
 * Same split as the rest of governance: rules here, I/O elsewhere. It matters
 * more than usual for this feature, because these are the rules that decide
 * whether an irreversible act proceeds, and they should be provable without
 * standing up a database to ask.
 */

import crypto from "node:crypto";

/** How long an approval remains executable. A stale approval is not an approval. */
export const APPROVAL_TTL_HOURS = 24;

/**
 * How much a tenant may change between approval and execution before the
 * approval no longer describes it. Zero: any change to any counted table voids
 * the approval.
 *
 * That is deliberately absolute rather than a tolerance. A tolerance invites
 * the question "how much destruction is close enough to what was approved",
 * and there is no defensible answer to it for an irreversible operation.
 */
export const MATERIAL_CHANGE_TOLERANCE = 0;

/** table name -> row count for one organization. */
export type Inventory = Readonly<Record<string, number>>;

/**
 * Tables excluded from the scope fingerprint — and ONLY from the fingerprint.
 * They are still inventoried, reported and erased.
 *
 * WHY THIS EXISTS, found by building it: the governance workflow writes to
 * these tables as a side effect of ITSELF. Requesting an erasure inserts a
 * certificate and an audit event; approving writes another; a dry run writes a
 * third. Counting them in the binding made every approval invalidate its own
 * fingerprint the instant it was created — the first approval was immediately
 * `scope_changed`.
 *
 * The distinction that resolves it: the fingerprint's job is to detect the
 * TENANT changing between approval and execution, not the erasure process
 * leaving its own footprints. A system ledger recording "an erasure was
 * approved" is not tenant activity, and treating it as such made the control
 * unusable rather than strict.
 */
export const FINGERPRINT_EXCLUDED_TABLES: ReadonlySet<string> = new Set([
  "security_audit_log",
  "erasure_certificates",
]);

/**
 * A digest of exactly what was approved. Stable across key order, and salted
 * with the organization id so a fingerprint from one tenant can never validate
 * against another.
 */
export function scopeFingerprint(organizationId: string, inventory: Inventory): string {
  const canonical = Object.keys(inventory)
    .filter((t) => !FINGERPRINT_EXCLUDED_TABLES.has(t))
    .sort()
    .map((t) => `${t}=${inventory[t]}`)
    .join(";");
  return crypto.createHash("sha256").update(`${organizationId}|${canonical}`).digest("hex");
}

/** SHA-256 of an organization name — verifiable later, never readable. */
export function organizationNameDigest(name: string): string {
  return crypto.createHash("sha256").update(name).digest("hex");
}

export interface InventoryDiff {
  changed: boolean;
  added: string[];
  removed: string[];
  countChanged: Array<{ table: string; from: number; to: number }>;
  totalBefore: number;
  totalAfter: number;
}

/** What changed between the approved inventory and the one seen at execution. */
export function diffInventory(before: Inventory, after: Inventory): InventoryDiff {
  // Same exclusions as the fingerprint, so an explanation of WHY a run refused
  // never points at a table the refusal did not consider.
  const keys = (i: Inventory) =>
    new Set(Object.keys(i).filter((t) => !FINGERPRINT_EXCLUDED_TABLES.has(t)));
  const beforeKeys = keys(before);
  const afterKeys = keys(after);
  const added = [...afterKeys].filter((k) => !beforeKeys.has(k)).sort();
  const removed = [...beforeKeys].filter((k) => !afterKeys.has(k)).sort();
  const countChanged: InventoryDiff["countChanged"] = [];
  for (const k of [...beforeKeys].filter((x) => afterKeys.has(x)).sort()) {
    const from = before[k] ?? 0;
    const to = after[k] ?? 0;
    if (Math.abs(to - from) > MATERIAL_CHANGE_TOLERANCE) countChanged.push({ table: k, from, to });
  }
  const sum = (i: Inventory) => Object.values(i).reduce((a, b) => a + b, 0);
  return {
    changed: added.length > 0 || removed.length > 0 || countChanged.length > 0,
    added,
    removed,
    countChanged,
    totalBefore: sum(before),
    totalAfter: sum(after),
  };
}

/* ─────────────────────────── authorization ───────────────────────────────── */

export type ErasureAuthorityReason =
  | "requires_user"
  | "admin_role_required"
  | "reason_required"
  | "self_approval"
  | "already_approved";

export interface ErasureAuthorityDecision {
  allowed: boolean;
  reason?: ErasureAuthorityReason;
}

const ALLOWED: ErasureAuthorityDecision = { allowed: true };

/** Only an admin, and only a named human, may request an erasure. */
export function canRequestErasure(input: {
  actorUserId: string | null;
  actorRole: string | null;
  reason: string | null | undefined;
}): ErasureAuthorityDecision {
  if (!input.actorUserId) return { allowed: false, reason: "requires_user" };
  if (input.actorRole !== "admin") return { allowed: false, reason: "admin_role_required" };
  if (typeof input.reason !== "string" || input.reason.trim() === "") {
    return { allowed: false, reason: "reason_required" };
  }
  return ALLOWED;
}

/**
 * Two-person rule. The approver must be an admin, must be a named human, and
 * must NOT be the requester.
 *
 * This is the control the operator singled out: a single compromised account
 * must not be able to erase an organization's entire governance history. It is
 * checked here, again at the route/CLI, again immediately before execution, and
 * once more by a database CHECK. Four times, because the cost of a redundant
 * check is nothing and the cost of a missing one is unrecoverable.
 */
export function canApproveErasure(input: {
  actorUserId: string | null;
  actorRole: string | null;
  requestedByUserId: string;
  currentStatus: string;
}): ErasureAuthorityDecision {
  if (!input.actorUserId) return { allowed: false, reason: "requires_user" };
  if (input.actorRole !== "admin") return { allowed: false, reason: "admin_role_required" };
  if (input.actorUserId === input.requestedByUserId) {
    return { allowed: false, reason: "self_approval" };
  }
  if (input.currentStatus !== "draft") return { allowed: false, reason: "already_approved" };
  return ALLOWED;
}

/* ───────────────────────── execution preconditions ───────────────────────── */

export type ExecutionRefusal =
  | "certificate_not_found"
  | "not_approved"
  | "approval_expired"
  | "dry_run_certificate"
  | "self_approved"
  | "missing_scope_binding"
  | "scope_changed"
  | "legal_hold_active"
  | "organization_missing"
  | "requester_unauthorized"
  | "approver_unauthorized"
  | "terminal_state";

export interface ExecutionGateInput {
  status: string;
  dryRun: boolean;
  requestedByUserId: string;
  approvedByUserId: string | null;
  approvalExpiresAt: Date | null;
  scopeFingerprint: string | null;
  /** Recomputed at execution time, moments before destruction. */
  observedFingerprint: string | null;
  organizationExists: boolean;
  activeLegalHolds: number;
  /**
   * Re-derived immediately before execution, per the 2026-08-16 ruling. A
   * two-person control whose second person has since been deprovisioned is a
   * one-person control with a historical footnote.
   */
  requesterStillAuthorized: boolean;
  approverStillAuthorized: boolean;
  now: Date;
}

export interface ExecutionGateDecision {
  proceed: boolean;
  refusal?: ExecutionRefusal;
}

/**
 * The gate immediately before destruction. EVERY condition is re-evaluated here
 * even though most were checked at approval — that is the entire point.
 *
 * "We checked the legal hold ten minutes ago" is not a safety property. Between
 * approval and execution a hold can be placed, a tenant can grow, an approver
 * can be deprovisioned, the organization can be renamed or already gone. This
 * function is deliberately a pure re-derivation from freshly-read facts, so
 * there is no path where a cached answer is trusted.
 */
export function evaluateExecutionGate(input: ExecutionGateInput): ExecutionGateDecision {
  if (input.status === "completed" || input.status === "failed" || input.status === "abandoned") {
    return { proceed: false, refusal: "terminal_state" };
  }
  // 'executing' is permitted: a previous attempt died after claiming the
  // certificate, and a retry must re-pass every check below rather than
  // resuming on trust.
  if (input.status !== "approved" && input.status !== "executing") {
    return { proceed: false, refusal: "not_approved" };
  }
  if (input.dryRun) return { proceed: false, refusal: "dry_run_certificate" };
  if (!input.approvedByUserId) return { proceed: false, refusal: "not_approved" };
  if (input.approvedByUserId === input.requestedByUserId) {
    return { proceed: false, refusal: "self_approved" };
  }
  if (!input.approvalExpiresAt || input.now.getTime() > input.approvalExpiresAt.getTime()) {
    return { proceed: false, refusal: "approval_expired" };
  }
  if (!input.scopeFingerprint) return { proceed: false, refusal: "missing_scope_binding" };
  if (!input.organizationExists) return { proceed: false, refusal: "organization_missing" };
  // Re-checked HERE, not at approval. This is the TOCTOU boundary.
  if (input.activeLegalHolds > 0) return { proceed: false, refusal: "legal_hold_active" };
  // Authorization is a fact about NOW, not about the moment of approval.
  // Refusal requires fresh authorization; there is no retry that skips this.
  if (!input.requesterStillAuthorized) {
    return { proceed: false, refusal: "requester_unauthorized" };
  }
  if (!input.approverStillAuthorized) {
    return { proceed: false, refusal: "approver_unauthorized" };
  }
  if (input.observedFingerprint !== input.scopeFingerprint) {
    return { proceed: false, refusal: "scope_changed" };
  }
  return { proceed: true };
}

/** Approval deadline from the moment of approval. */
export function approvalExpiry(approvedAt: Date, ttlHours: number = APPROVAL_TTL_HOURS): Date {
  return new Date(approvedAt.getTime() + ttlHours * 3600_000);
}

/** Seven years, per the operator retention ruling. */
export function certificateRetainUntil(completedAt: Date): Date {
  const d = new Date(completedAt.getTime());
  d.setUTCFullYear(d.getUTCFullYear() + 7);
  return d;
}
