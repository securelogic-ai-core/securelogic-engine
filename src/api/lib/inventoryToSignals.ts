/**
 * inventoryToSignals.ts — Pure synthesis of inventory state into the
 * shape the posture engine consumes (DbFindingForPosture).
 *
 * Why
 * ---
 * The posture engine (DomainRiskAggregationEngineV2 via computePosture)
 * reads only `findings` and `risks`. Inventory state — like a vendor
 * flagged with criticality='critical' — does not influence domain
 * scores by itself. An org with six high-criticality vendors and zero
 * open vendor findings sees a Vendor Risk score of 0, which
 * underrepresents real risk.
 *
 * This module produces synthetic DbFindingForPosture entries from
 * inventory state. They ride into the engine alongside real findings
 * and real risks; the engine doesn't know or care which entries are
 * synthetic. Existing accumulation logic
 * (max severity weight + log2(N+1)*15 boost, capped at 100) handles
 * repeated severity correctly, so emitting one synthetic per active
 * vendor produces the right curve.
 *
 * Scope (v1)
 * ----------
 * Vendor inventory only. AI Governance, Cyber Risk, and Compliance
 * domain synthesis are separate packages. This file is the pattern;
 * those follow it.
 *
 * Synthetic shape decision
 * ------------------------
 * DbFindingForPosture has four fields: id, title, domain, severity.
 * The engine reads only domain and severity. Synthetic objects do NOT
 * set source_type or status — those fields aren't on the type, and no
 * current consumer reads them on the synthesized array.
 * (`postureSnapshot.ts:113-117`'s source_type COUNT runs against the
 * `findings` TABLE directly, not against the synthesized array, so
 * synthetic findings never reach that code path.)
 *
 * Vendor criticality scale
 * ------------------------
 * vendors.criticality is stored lowercase (CHECK
 * 'critical'/'high'/'medium'/'low') per
 * 20260412_vendor_risk_primitives.sql:46-47. Engine severity is
 * TitleCase ('Critical'/'High'/'Moderate'/'Low'). Note: vendors uses
 * 'medium' but engine uses 'Moderate' — the mapping below handles the
 * rename.
 *
 * Defensive handling
 * ------------------
 * Inputs with criticality outside the four-value map (null included
 * via the SQL filter, but defensively handled here too) are skipped
 * with a warning. This matches the spec's "skip, don't default."
 */

import type { DbFindingForPosture } from "./postureComputation.js";
import { logger } from "../infra/logger.js";

/**
 * vendors.criticality (lowercase, with 'medium') → engine severity
 * (TitleCase, with 'Moderate'). Closed map; values outside it are
 * skipped, not defaulted.
 */
export const VENDOR_CRITICALITY_TO_SEVERITY: Record<string, "Critical" | "High" | "Moderate" | "Low"> = {
  critical: "Critical",
  high:     "High",
  medium:   "Moderate",
  low:      "Low",
};

/** Stable string literal for the synthesized domain. Matches the
 *  convention used by vendor-review and vendor-cycle-review writers. */
export const VENDOR_RISK_DOMAIN = "Vendor Risk";

export type VendorCriticalityRow = {
  id: string;
  criticality: string | null;
};

/**
 * Convert active-vendor rows to synthetic posture-engine signals.
 *
 * One synthetic finding per vendor with a known criticality. Same vendor
 * appearing twice in input would produce two synthetic findings with
 * the same id — callers should dedupe upstream if that matters
 * (the SQL fetch already does, since vendors.id is the PK).
 *
 * Pure function. No I/O. Deterministic.
 */
export function vendorCriticalityToSignals(
  vendors: ReadonlyArray<VendorCriticalityRow>
): DbFindingForPosture[] {
  const signals: DbFindingForPosture[] = [];

  for (const v of vendors) {
    if (v.criticality === null || v.criticality === undefined) {
      // Defensive — the SQL filter excludes nulls, but if an input
      // arrives with one anyway, skip silently. No warning: nullable
      // criticality is a schema-supported state, not a data bug.
      continue;
    }

    const severity = VENDOR_CRITICALITY_TO_SEVERITY[v.criticality];
    if (severity === undefined) {
      // Unknown criticality string. CHECK constraint should make this
      // impossible, but if a future migration loosens the column or a
      // direct DB write bypasses validation, skip + warn rather than
      // default to a severity (which would silently misrepresent risk).
      logger.warn(
        {
          event: "vendor_criticality_unknown_skipped",
          vendorId: v.id,
          criticality: v.criticality,
        },
        `vendorCriticalityToSignals skipped vendor ${v.id} with unknown criticality '${v.criticality}'`
      );
      continue;
    }

    signals.push({
      id: `vendor-criticality:${v.id}`,
      title: `Active vendor with ${v.criticality} criticality`,
      domain: VENDOR_RISK_DOMAIN,
      severity,
    });
  }

  return signals;
}
