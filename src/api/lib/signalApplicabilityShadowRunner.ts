/**
 * signalApplicabilityShadowRunner.ts — Enterprise Risk Graph convergence (C3).
 *
 * The shadow runner: given a signal and the LEGACY matcher's asset ids, run the
 * NEW product→tenant-asset resolution (C1 → C2b), compare, and emit counts-only
 * convergence telemetry. Writes NOTHING to customer tables and returns nothing
 * the caller acts on — it only measures. The caller invokes it behind
 * SECURELOGIC_SIGNAL_APPLICABILITY_ENABLED, inside try/catch, so the legacy path
 * stays authoritative and byte-identical when the flag is off or the shadow throws.
 */

import type { PoolClient } from "pg";
import { logger } from "../infra/logger.js";
import { canonicalProductIdentity } from "./canonicalProduct.js";
import { resolveTenantAssets } from "./tenantAssetResolver.js";
import {
  compareApplicabilityShadow,
  shadowTelemetry,
  type ShadowComparison,
  type ShadowGrain,
} from "./signalApplicabilityShadow.js";

export interface ShadowGrainInput {
  /**
   * The name to treat as a product-name HYPOTHESIS. Intelligence feeds conflate
   * vendor and product (KEV "Microsoft", but also "Exchange Server"), and a
   * legacy vendor/ai_system match resolves to that entity's own name — so for
   * MEASUREMENT we resolve product→asset from this hint. R2 is NOT violated: the
   * resolver only produces CANDIDATES; establishing `affected` remains an engine
   * decision the shadow never makes (see CONVERGENCE-REPORT.md).
   */
  productHint: string | null;
  cve: string | null;
  /** Which legacy grain `legacyAssetIds` came from (asset / vendor / ai_system). */
  grain: ShadowGrain;
}

/**
 * Run one shadow comparison for a (signal, org) at a given grain. Returns the
 * comparison (for tests); the durable output is the emitted telemetry log. Never
 * writes to customer tables. Read-only against the org's assets.
 */
export async function runSignalApplicabilityShadow(
  client: PoolClient,
  organizationId: string,
  input: ShadowGrainInput,
  legacyAssetIds: string[]
): Promise<ShadowComparison> {
  const identity = canonicalProductIdentity({
    vendor: input.productHint,
    product: input.productHint,
    cve: input.cve,
  });
  const resolution = await resolveTenantAssets(client, organizationId, identity);
  const cmp = compareApplicabilityShadow(legacyAssetIds, resolution);
  logger.info(
    { ...shadowTelemetry(cmp, input.grain), organizationId },
    "signal applicability shadow comparison"
  );
  return cmp;
}

/**
 * The Tier-0 asset id(s) backing a legacy vendor/ai_system match — the legacy
 * side of the vendor/ai_system-grain comparison. Org-scoped; read-only. Returns
 * `[]` when the entity is not registered as an asset (→ honest no_match/both_empty).
 */
export async function backingAssetIds(
  client: PoolClient,
  organizationId: string,
  backingKind: "vendors" | "ai_systems",
  backingId: string
): Promise<string[]> {
  const r = await client.query<{ id: string }>(
    `SELECT id FROM assets WHERE organization_id = $1 AND backing_kind = $2 AND backing_id = $3`,
    [organizationId, backingKind, backingId]
  );
  return r.rows.map((x) => x.id);
}
