/**
 * findingAssetOccurrences.ts — which assets a vulnerability actually affects.
 *
 * THE GAP THIS CLOSES. SL-VULN-1 gave a vulnerability an identity (CVE, CWE,
 * CVSS) but nowhere to say WHERE it is. "CVE-2026-10001 affects 17 hosts, 12
 * still exposed" was unsayable, so the platform could report a vulnerability but
 * never an exposure — and exposure is the thing anyone actually remediates.
 *
 * WHAT IS DELIBERATELY NOT HERE:
 *
 *   - No second Findings system. The finding keeps its severity, its
 *     policy-driven SLA, its decision_state and its operational_status. Nothing
 *     in this file writes any of them.
 *   - No per-asset risk. Risks attach to the FINDING through finding_risks: 500
 *     affected hosts are ONE register entry, not 500. This file never touches
 *     risks.
 *   - No per-asset SLA. The due date is the finding's, under the org policy. No
 *     requirement in the repo asks for per-asset deadlines, so none is invented;
 *     if one ever does, it is a policy change to report, not a column to add here.
 *   - No auto-closure. An occurrence going absent does NOT close the finding —
 *     see occurrenceLifecycle.isClosureEligible, which is report-only by name and
 *     by contract (ERIP-AD-11: drift is reported, never destructive).
 *
 * TENANT ISOLATION, three layers, because a join table is the most attractive
 * place to leak — two ids from another tenant are enough to fabricate a
 * relationship unless every layer refuses:
 *   1. asTenant() opens the request transaction with app.current_org_id set;
 *   2. BOTH endpoints (finding AND asset) are re-verified against the caller's
 *      org before insert, so a cross-tenant id 404s instead of linking;
 *   3. the RLS policy on finding_asset_occurrences carries USING *and* WITH CHECK.
 *
 * SCALE. Occurrences are the first table in this domain that reaches six figures
 * per tenant (DETAIL_ASSET_CAP is 10,000 assets, times many vulnerabilities), so
 * every list here is paginated with the same bounded limit/offset the findings
 * list uses, every query is tenant-first, and the rollup counts are a single
 * grouped aggregate rather than a scan.
 */

import { Router } from "express";

import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { denyContributor } from "../middleware/requireSeat.js";
import { asTenant } from "../middleware/asTenant.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import {
  resolveAsset,
  resolvableClaims,
  type IdentifierClaim,
  type IdentifierMatch,
} from "../lib/assetIdentity.js";
import {
  markAbsent,
  markRemediated,
  observe,
  type OccurrenceState,
  type PresenceStatus,
} from "../lib/occurrenceLifecycle.js";
import { recordOccurrenceObservation } from "../lib/occurrenceStore.js";

const router = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Same bounds as the findings list (findings.ts): one pagination contract across
// the product, and an offset ceiling so a hostile ?offset cannot force a deep scan.
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_OFFSET = 100_000;
const MAX_SOURCE = 120;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

function parseLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

function parseOffset(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(Math.floor(parsed), MAX_OFFSET);
}

function orgOf(req: unknown): string | null {
  return (
    (req as never as { organizationContext?: { organizationId?: string } })
      .organizationContext?.organizationId ?? null
  );
}

function actor(req: unknown): { apiKeyId: string | null; userId: string | null } {
  const r = req as { apiKey?: { id?: string }; userId?: string };
  return { apiKeyId: r.apiKey?.id ?? null, userId: r.userId ?? null };
}

function readSource(body: unknown, key: string): string | null {
  const raw = (body as Record<string, unknown> | null)?.[key];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, MAX_SOURCE) : null;
}

/**
 * Both endpoints, re-verified inside the caller's org.
 *
 * One undifferentiated "not found" for either side is deliberate: telling a
 * caller which of the two ids exists would turn this endpoint into an existence
 * oracle for another tenant's findings and assets.
 */
async function resolveEndpoints(
  organizationId: string,
  findingId: string,
  assetId: string | null,
): Promise<{ ok: true } | { ok: false }> {
  const finding = await pg.query(
    `SELECT 1 FROM findings WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [findingId, organizationId],
  );
  if (finding.rowCount === 0) return { ok: false };

  if (assetId !== null) {
    const asset = await pg.query(
      `SELECT 1 FROM assets WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [assetId, organizationId],
    );
    if (asset.rowCount === 0) return { ok: false };
  }
  return { ok: true };
}

const GUARDS = [
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  // Recording which hosts a vulnerability affects is remediation-bearing work,
  // not read-only queue traffic — same posture as the Risk Register linkage.
  denyContributor(),
] as const;

/* =========================================================
   GET /api/findings/:id/occurrences
   The assets this finding affects. Paginated.
   ========================================================= */

router.get(
  "/findings/:id/occurrences",
  ...GUARDS,
  asTenant(async (req, res) => {
    const organizationId = orgOf(req);
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }
    const findingId = String(req.params.id ?? "").trim();
    if (!isUuid(findingId)) {
      res.status(400).json({ error: "invalid_finding_id" });
      return;
    }
    const endpoints = await resolveEndpoints(organizationId, findingId, null);
    if (!endpoints.ok) {
      res.status(404).json({ error: "finding_not_found" });
      return;
    }

    const limit = parseLimit(req.query.limit);
    const offset = parseOffset(req.query.offset);
    const presence = String(req.query.presence_status ?? "").trim();
    const filtered = ["present", "absent", "remediated"].includes(presence);

    const rows = await pg.query(
      `SELECT o.id, o.finding_id, o.asset_id, o.presence_status,
              o.first_seen_at, o.last_seen_at, o.absent_since, o.remediated_at,
              o.reappeared_count, o.last_reappeared_at, o.source,
              o.source_occurrence_id, o.created_at, o.updated_at,
              a.asset_type, a.lifecycle_status AS asset_lifecycle_status
         FROM finding_asset_occurrences o
         JOIN assets a ON a.id = o.asset_id AND a.organization_id = o.organization_id
        WHERE o.organization_id = $1 AND o.finding_id = $2
          ${filtered ? "AND o.presence_status = $5" : ""}
        ORDER BY o.last_seen_at DESC, o.id
        LIMIT $3 OFFSET $4`,
      filtered
        ? [organizationId, findingId, limit, offset, presence]
        : [organizationId, findingId, limit, offset],
    );

    // One grouped aggregate rather than a second scan — this is the query behind
    // "Affected assets: 17 / Active: 12 / No longer observed: 5", and it is
    // served by idx_occurrences_finding_presence.
    const counts = await pg.query<{ presence_status: PresenceStatus; n: string }>(
      `SELECT presence_status, COUNT(*)::text AS n
         FROM finding_asset_occurrences
        WHERE organization_id = $1 AND finding_id = $2
        GROUP BY presence_status`,
      [organizationId, findingId],
    );
    const recurring = await pg.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM finding_asset_occurrences
        WHERE organization_id = $1 AND finding_id = $2 AND reappeared_count > 0`,
      [organizationId, findingId],
    );

    const by = (s: PresenceStatus) =>
      Number(counts.rows.find((r) => r.presence_status === s)?.n ?? 0);
    const rollup = {
      affected: by("present") + by("absent") + by("remediated"),
      active: by("present"),
      absent: by("absent"),
      remediated: by("remediated"),
      recurring: Number(recurring.rows[0]?.n ?? 0),
    };

    res.json({ occurrences: rows.rows, rollup, limit, offset });
  }),
);

/* =========================================================
   POST /api/findings/:id/occurrences
   Record that this finding affects this asset.
   ========================================================= */

router.post(
  "/findings/:id/occurrences",
  ...GUARDS,
  asTenant(async (req, res) => {
    const organizationId = orgOf(req);
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }
    const findingId = String(req.params.id ?? "").trim();
    const assetId = String((req.body as Record<string, unknown> | null)?.["asset_id"] ?? "").trim();
    if (!isUuid(findingId)) {
      res.status(400).json({ error: "invalid_finding_id" });
      return;
    }
    if (!isUuid(assetId)) {
      res.status(400).json({ error: "asset_id_required" });
      return;
    }

    const endpoints = await resolveEndpoints(organizationId, findingId, assetId);
    if (!endpoints.ok) {
      res.status(404).json({ error: "finding_or_asset_not_found" });
      return;
    }

    const source = readSource(req.body, "source");
    const sourceOccurrenceId = readSource(req.body, "source_occurrence_id");
    const { userId } = actor(req);
    // The convergent upsert lives in occurrenceStore.ts — ONE writer semantics
    // shared with the scanner-ingestion intake (SL-OCC-3). Extracted, not
    // duplicated, the moment a second writer existed; behavior is unchanged
    // and the isolation suite pins it.
    const result = await recordOccurrenceObservation(pg, {
      organizationId,
      findingId,
      assetId,
      source,
      sourceOccurrenceId,
      createdByUserId: userId,
    });

    if (!result.created && result.reappeared) {
      writeAuditEvent({
        organizationId, actorUserId: userId, actorApiKeyId: actor(req).apiKeyId,
        eventType: "finding.occurrence_reappeared",
        resourceType: "finding_asset_occurrence", resourceId: result.occurrenceId,
        payload: { finding_id: findingId, asset_id: assetId,
                   reappeared_count: (result.occurrence as { reappeared_count?: number }).reappeared_count },
        ipAddress: req.ip ?? null,
      });
    }
    if (result.created) {
      writeAuditEvent({
        organizationId, actorUserId: userId, actorApiKeyId: actor(req).apiKeyId,
        eventType: "finding.occurrence_recorded",
        resourceType: "finding_asset_occurrence", resourceId: result.occurrenceId,
        payload: { finding_id: findingId, asset_id: assetId, source },
        ipAddress: req.ip ?? null,
      });
      logger.info(
        { event: "finding_occurrence_recorded", organizationId, findingId, assetId },
        "Vulnerability occurrence recorded",
      );
    }

    res.status(result.created ? 201 : 200).json({
      occurrence: result.occurrence,
      created: result.created,
      reappeared: result.reappeared,
    });
  }),
);

/* =========================================================
   PATCH /api/findings/:id/occurrences/:occurrenceId
   Presence transitions a HUMAN may drive.
   ========================================================= */

router.patch(
  "/findings/:id/occurrences/:occurrenceId",
  ...GUARDS,
  asTenant(async (req, res) => {
    const organizationId = orgOf(req);
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }
    const findingId = String(req.params.id ?? "").trim();
    const occurrenceId = String(req.params.occurrenceId ?? "").trim();
    if (!isUuid(findingId) || !isUuid(occurrenceId)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    const target = String(
      (req.body as Record<string, unknown> | null)?.["presence_status"] ?? "",
    ).trim();

    // 'absent' is NOT settable by hand here. Absence is an OBSERVATION — it means
    // an authoritative later look did not find it — and a person clicking a button
    // is not that. Letting a human assert absence would make the column mean two
    // different things and would let "I think it's gone" masquerade as evidence.
    // Humans remediate; scans observe. SL-OCC-2 gives the reconciler the only
    // authority to mark absent, and only when scope proves the asset was covered.
    if (target !== "remediated" && target !== "present") {
      res.status(400).json({
        error: "invalid_presence_transition",
        detail:
          "presence_status must be 'remediated' or 'present'. Absence is an " +
          "observation established by a scan's scope, not a value a person sets.",
      });
      return;
    }

    const found = await pg.query<OccurrenceState & { id: string }>(
      `SELECT id, presence_status, first_seen_at, last_seen_at, absent_since,
              remediated_at, reappeared_count, last_reappeared_at
         FROM finding_asset_occurrences
        WHERE organization_id = $1 AND id = $2 AND finding_id = $3`,
      [organizationId, occurrenceId, findingId],
    );
    if (found.rowCount === 0 || !found.rows[0]) {
      res.status(404).json({ error: "occurrence_not_found" });
      return;
    }

    const state = found.rows[0];
    const now = new Date().toISOString();
    const { userId } = actor(req);
    const patch = target === "remediated" ? markRemediated(state, now) : observe(state, now);

    const updated = await pg.query(
      `UPDATE finding_asset_occurrences
          SET presence_status = $3,
              last_seen_at = COALESCE($4, last_seen_at),
              absent_since = $5,
              remediated_at = $6,
              remediated_by_user_id = CASE WHEN $3 = 'remediated' THEN $7
                                           ELSE remediated_by_user_id END,
              reappeared_count = COALESCE($8, reappeared_count),
              last_reappeared_at = COALESCE($9, last_reappeared_at),
              updated_at = NOW()
        WHERE organization_id = $1 AND id = $2
        RETURNING *`,
      [
        organizationId, occurrenceId, patch.presence_status,
        patch.last_seen_at ?? null, patch.absent_since ?? null,
        patch.remediated_at ?? null, userId,
        patch.reappeared_count ?? null, patch.last_reappeared_at ?? null,
      ],
    );

    writeAuditEvent({
      organizationId, actorUserId: userId, actorApiKeyId: actor(req).apiKeyId,
      eventType: `finding.occurrence_${target}`,
      resourceType: "finding_asset_occurrence", resourceId: occurrenceId,
      payload: { finding_id: findingId, from: state.presence_status, to: patch.presence_status },
      ipAddress: req.ip ?? null,
    });

    res.json({ occurrence: updated.rows[0] });
  }),
);

/* =========================================================
   DELETE /api/findings/:id/occurrences/:occurrenceId
   Unlink a mis-recorded exposure.
   ========================================================= */

router.delete(
  "/findings/:id/occurrences/:occurrenceId",
  ...GUARDS,
  asTenant(async (req, res) => {
    const organizationId = orgOf(req);
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }
    const findingId = String(req.params.id ?? "").trim();
    const occurrenceId = String(req.params.occurrenceId ?? "").trim();
    if (!isUuid(findingId) || !isUuid(occurrenceId)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }

    // Removing ONE occurrence removes ONE asset's exposure record. The finding,
    // its other occurrences, its risk links and this event in security_audit_log
    // all survive — deleting a row here never erases vulnerability history.
    const deleted = await pg.query<{ id: string; asset_id: string; presence_status: string }>(
      `DELETE FROM finding_asset_occurrences
        WHERE organization_id = $1 AND id = $2 AND finding_id = $3
        RETURNING id, asset_id, presence_status`,
      [organizationId, occurrenceId, findingId],
    );
    if (deleted.rowCount === 0 || !deleted.rows[0]) {
      res.status(404).json({ error: "occurrence_not_found" });
      return;
    }

    writeAuditEvent({
      organizationId, actorUserId: actor(req).userId, actorApiKeyId: actor(req).apiKeyId,
      eventType: "finding.occurrence_removed",
      resourceType: "finding_asset_occurrence", resourceId: occurrenceId,
      payload: {
        finding_id: findingId,
        asset_id: deleted.rows[0].asset_id,
        presence_status_at_removal: deleted.rows[0].presence_status,
      },
      ipAddress: req.ip ?? null,
    });

    res.status(204).send();
  }),
);

/* =========================================================
   GET /api/assets/:id/occurrences
   The inverse: what affects this asset. Paginated.
   ========================================================= */

router.get(
  "/assets/:id/occurrences",
  ...GUARDS,
  asTenant(async (req, res) => {
    const organizationId = orgOf(req);
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }
    const assetId = String(req.params.id ?? "").trim();
    if (!isUuid(assetId)) {
      res.status(400).json({ error: "invalid_asset_id" });
      return;
    }
    const asset = await pg.query(
      `SELECT 1 FROM assets WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [assetId, organizationId],
    );
    if (asset.rowCount === 0) {
      res.status(404).json({ error: "asset_not_found" });
      return;
    }

    const limit = parseLimit(req.query.limit);
    const offset = parseOffset(req.query.offset);

    // Served by idx_occurrences_asset_presence. The finding's severity and due
    // date are joined for display only — this endpoint writes nothing and the
    // SLA remains the finding's.
    const rows = await pg.query(
      `SELECT o.id, o.finding_id, o.asset_id, o.presence_status,
              o.first_seen_at, o.last_seen_at, o.reappeared_count,
              f.title, f.severity, f.due_date, f.cve_id, f.operational_status
         FROM finding_asset_occurrences o
         JOIN findings f ON f.id = o.finding_id AND f.organization_id = o.organization_id
        WHERE o.organization_id = $1 AND o.asset_id = $2
        ORDER BY o.presence_status, o.last_seen_at DESC, o.id
        LIMIT $3 OFFSET $4`,
      [organizationId, assetId, limit, offset],
    );

    res.json({ occurrences: rows.rows, limit, offset });
  }),
);

/* =========================================================
   POST /api/assets/resolve-identifiers
   Which asset do these source identifiers mean?
   ========================================================= */

router.post(
  "/assets/resolve-identifiers",
  ...GUARDS,
  asTenant(async (req, res) => {
    const organizationId = orgOf(req);
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const raw = (req.body as Record<string, unknown> | null)?.["identifiers"];
    if (!Array.isArray(raw) || raw.length === 0) {
      res.status(400).json({ error: "identifiers_required" });
      return;
    }
    // Bounded: this is a lookup helper for an importer, not a bulk search API.
    const claims: IdentifierClaim[] = raw.slice(0, 20).map((c) => {
      const o = (c ?? {}) as Record<string, unknown>;
      return {
        scheme: String(o["scheme"] ?? "").trim(),
        value: String(o["value"] ?? "").trim(),
        source: typeof o["source"] === "string" ? o["source"] : null,
      };
    });

    // Only the schemes that can actually resolve reach the database — an IP is
    // stored as evidence but is never a lookup key, so querying on one would be
    // work done to produce an answer the resolver must discard anyway.
    const usable = resolvableClaims(claims);
    if (usable.length === 0) {
      res.json({
        outcome: "not_found",
        reason:
          "No resolvable identifier supplied — an IP or MAC address alone cannot identify an asset",
      });
      return;
    }

    const found = await pg.query<{ asset_id: string; scheme: string; value: string; source: string }>(
      // Deliberately over-fetches CANDIDATES and lets the pure resolver decide.
      // Case sensitivity differs per scheme — an ARN and a CMDB id are opaque and
      // must match exactly, a hostname must not — so folding case into the SQL
      // would be wrong for half the schemes AND would defeat the
      // (organization_id, scheme, value) index. Matching both the raw and the
      // lowercased form keeps the index usable and leaves the per-scheme rule in
      // assetIdentity.ts, where it is tested.
      `SELECT asset_id, scheme, value, source
         FROM asset_identifiers
        WHERE organization_id = $1
          AND scheme = ANY($2::text[])
          AND (value = ANY($3::text[]) OR lower(value) = ANY($4::text[]))`,
      [
        organizationId,
        usable.map((c) => c.scheme),
        usable.map((c) => c.value.trim()),
        usable.map((c) => c.value.trim().toLowerCase()),
      ],
    );

    const matches: IdentifierMatch[] = found.rows.map((r) => ({
      assetId: r.asset_id,
      scheme: r.scheme,
      value: r.value,
      source: r.source,
    }));

    // NOTHING HERE CREATES AN ASSET. An unresolved identifier returns not_found
    // and the caller records the vulnerability without an occurrence — a
    // vulnerability with no asset is a valid record, and inventing a placeholder
    // host to satisfy the occurrence model would put fiction in the inventory.
    res.json(resolveAsset(claims, matches));
  }),
);

export default router;
