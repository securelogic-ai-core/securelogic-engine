/**
 * assetIdentifierWithdrawal.ts — PLAT-ASSET-1's deliberate-withdrawal arm.
 *
 *   POST /api/assets/:id/identifiers/withdraw   { scheme, value }
 *
 * The review queue's accept documents its own limit: accepting an AMBIGUOUS
 * review does not touch the OTHER assets' claims on the same identifier, so
 * imports keep resolving ambiguous until the wrong claim is deliberately
 * withdrawn. This is that route — the human act that buys the determinism
 * "accepted" could not.
 *
 * WITHDRAWAL IS DELETE, BY RULING. 20261033 grants exactly SELECT, INSERT,
 * DELETE and says why: "an alias is asserted or withdrawn, never edited into
 * a different one". A claim row is one piece of source evidence, not a
 * lifecycle object — no soft-delete column, because a withdrawn-but-present
 * row would have to be excluded by every reader (develop's resolvers
 * included, which a held branch cannot reach), and one missed reader is a
 * withdrawn alias that still resolves. Deleting the row makes "no longer
 * active" true in every resolver by construction.
 *
 * THE DURABLE RECORD IS THE AUDIT ROW, so it is written AWAITED
 * (writeAuditEventAwaited's own criterion: irreversible actions whose only
 * durable record is the audit row). The payload snapshots the full deleted
 * claim — scheme, value, source, first/last seen — and the response carries
 * audit_recorded so a lost audit write is said out loud, never implied away.
 * Prior observations need no rewrite to stay explainable: occurrences and
 * observations reference assets and embed the identifier text they arrived
 * with; none of them FK this table.
 *
 * WHAT WITHDRAWAL NEVER DOES: it never deletes or merges assets (the asset
 * row is untouched — estate population is PLAT-ASSET-1's ruling, not a side
 * effect); it never rewrites completed runs; it never decides pending
 * reviews (a pending question stays asked — the human answers it on the
 * review surface, where accept after a withdrawal now attaches cleanly).
 *
 * ORIGIN IDENTITY IS NON-WITHDRAWABLE. An auto-created asset's asset_origins
 * row records the identity that justified its creation — "asserted once, at
 * creation, forever" (20261048). Withdrawing that alias while the asset
 * stands would make the next import of the same identity auto-create a
 * DUPLICATE asset: estate corruption by side effect, which the operator
 * ruling exists to prevent. So a claim matching the asset's origin row is
 * 409 origin_identity_non_withdrawable — the identity leaves only with the
 * asset itself (the existing, occurrence-guarded DELETE /assets/:id
 * lifecycle action).
 *
 * HONESTY AFTER THE ACT: the response names what resolution of this
 * identifier looks like now — deterministic (one claim left), still
 * ambiguous (several remain — surfaced, never guessed away), unknown (none
 * remain), or not_a_resolution_key (volatile schemes never resolved alone to
 * begin with; withdrawing one is evidence cleanup, not disambiguation).
 *
 * DARK behind SECURELOGIC_ASSET_AUTO_CREATE_ENABLED (404 when off): every
 * product writer of asset_identifiers rides that same lane (auto-creation,
 * the bridge, review accepts), so the withdrawal surface ships and wakes
 * with the claims it withdraws. Entitlement: premium; denyContributor —
 * withdrawing identity evidence is an estate-governance act (the
 * assetResolutionReviews posture).
 */

import { Router, type Request, type Response } from "express";

import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { denyContributor } from "../middleware/requireSeat.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { asTenant } from "../middleware/asTenant.js";
import { writeAuditEventAwaited } from "../lib/auditLog.js";
import { assetAutoCreateFeatureFlag } from "../lib/assetAutoCreateFlag.js";
import { ASSET_IDENTIFIER_SCHEMES, VOLATILE_SCHEMES } from "../lib/assetIdentity.js";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCHEMES = new Set<string>(ASSET_IDENTIFIER_SCHEMES);

export type ResolutionAfterWithdrawal =
  | "deterministic"
  | "still_ambiguous"
  | "unknown_identifier"
  | "not_a_resolution_key";

router.post(
  "/assets/:id/identifiers/withdraw",
  assetAutoCreateFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
  asTenant(async (req: Request, res: Response) => {
    const organizationId =
      (req as { organizationContext?: { organizationId?: string } }).organizationContext
        ?.organizationId ?? null;
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }
    const assetIdRaw = req.params["id"];
    const assetId = typeof assetIdRaw === "string" ? assetIdRaw : "";
    if (!UUID_RE.test(assetId)) {
      res.status(400).json({ error: "invalid_asset_id" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const scheme = typeof body["scheme"] === "string" ? body["scheme"] : "";
    if (!SCHEMES.has(scheme)) {
      res.status(400).json({
        error: "invalid_scheme",
        detail: `scheme must be one of: ${ASSET_IDENTIFIER_SCHEMES.join(", ")}`
      });
      return;
    }
    // The exact stored value — same contract as resolution (resolveAsset
    // matches stored text verbatim), so what the caller sees listed is what
    // they name here. Trim only; no normalization guessing.
    const value = typeof body["value"] === "string" ? body["value"].trim() : "";
    if (value.length === 0) {
      res.status(400).json({ error: "value_required" });
      return;
    }

    try {
      // The asset must belong to the caller's org — a cross-tenant id is 404,
      // indistinguishable from absent, never a hint.
      const asset = await pg.query<{ id: string }>(
        `SELECT id FROM assets WHERE organization_id = $1 AND id = $2`,
        [organizationId, assetId]
      );
      if ((asset.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "asset_not_found" });
        return;
      }

      const claim = await pg.query<{
        id: string;
        source: string;
        first_seen_at: string;
        last_seen_at: string;
      }>(
        `SELECT id, source, first_seen_at, last_seen_at
           FROM asset_identifiers
          WHERE organization_id = $1 AND asset_id = $2 AND scheme = $3 AND value = $4`,
        [organizationId, assetId, scheme, value]
      );
      const row = claim.rows[0];
      if (row == null) {
        res.status(404).json({ error: "alias_not_found" });
        return;
      }

      // Origin identities are stored-to-stored comparable: the creating lane
      // wrote BOTH the origin row and the birth alias with the same
      // normalized value in the same transaction (20261048).
      const origin = await pg.query(
        `SELECT 1 FROM asset_origins
          WHERE organization_id = $1 AND asset_id = $2 AND scheme = $3 AND value = $4`,
        [organizationId, assetId, scheme, value]
      );
      if ((origin.rowCount ?? 0) > 0) {
        res.status(409).json({
          error: "origin_identity_non_withdrawable",
          detail:
            "This identifier is the recorded origin identity that justified the asset's automatic creation; withdrawing it would let the next import re-create a duplicate asset. It can only leave with the asset itself (DELETE /api/assets/:id)."
        });
        return;
      }

      const deleted = await pg.query(
        `DELETE FROM asset_identifiers
          WHERE organization_id = $1 AND id = $2
          RETURNING id`,
        [organizationId, row.id]
      );
      if ((deleted.rowCount ?? 0) === 0) {
        // Raced a concurrent withdrawal inside the window.
        res.status(404).json({ error: "alias_not_found" });
        return;
      }

      // What resolving this identifier means NOW — surfaced, never guessed.
      const remaining = await pg.query<{ n: number }>(
        `SELECT count(DISTINCT asset_id)::int AS n FROM asset_identifiers
          WHERE organization_id = $1 AND scheme = $2 AND value = $3`,
        [organizationId, scheme, value]
      );
      const remainingClaimCount = Number(remaining.rows[0]!.n);
      const resolutionAfterWithdrawal: ResolutionAfterWithdrawal = VOLATILE_SCHEMES.has(scheme)
        ? "not_a_resolution_key"
        : remainingClaimCount === 0
          ? "unknown_identifier"
          : remainingClaimCount === 1
            ? "deterministic"
            : "still_ambiguous";

      const auditRecorded = await writeAuditEventAwaited({
        organizationId,
        actorApiKeyId: (req as { apiKey?: { id?: string } }).apiKey?.id ?? null,
        actorUserId: req.userId ?? null,
        eventType: "asset_identifier.withdrawn",
        resourceType: "asset",
        resourceId: assetId,
        payload: {
          identifier_id: row.id,
          scheme,
          value,
          source: row.source,
          first_seen_at: row.first_seen_at,
          last_seen_at: row.last_seen_at,
          remaining_claim_count: remainingClaimCount,
          resolution_after_withdrawal: resolutionAfterWithdrawal
        },
        ipAddress: req.ip ?? null
      });

      res.json({
        withdrawn: true,
        asset_id: assetId,
        scheme,
        value,
        remaining_claim_count: remainingClaimCount,
        resolution_after_withdrawal: resolutionAfterWithdrawal,
        audit_recorded: auditRecorded
      });
    } catch (err) {
      logger.error({ err }, "asset-identifier withdrawal failed");
      res.status(500).json({ error: "internal_error" });
    }
  })
);

export default router;
