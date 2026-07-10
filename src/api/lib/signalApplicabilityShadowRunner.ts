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
import { compareApplicabilityShadow, shadowTelemetry, type ShadowComparison } from "./signalApplicabilityShadow.js";

export interface ShadowSignalInput {
  affected_vendor: string | null;
  affected_cve: string | null;
}

/**
 * Run one shadow comparison for a (signal, org). Returns the comparison (for
 * tests); the durable output is the emitted telemetry log. Never writes to
 * customer tables. Read-only against the org's assets.
 */
export async function runSignalApplicabilityShadow(
  client: PoolClient,
  organizationId: string,
  signal: ShadowSignalInput,
  legacyAssetIds: string[]
): Promise<ShadowComparison> {
  // Intelligence feeds conflate vendor and product in `affected_vendor` (KEV
  // "Microsoft", NVD "microsoft", but also "Exchange Server"). For MEASUREMENT we
  // treat it as a product-name HYPOTHESIS so the resolver can attempt a
  // product→asset match and the shadow yields a real agreement rate. R2 is NOT
  // violated: the resolver only produces CANDIDATES; establishing `affected`
  // remains an engine decision the shadow never makes. The residual
  // needs_review/ambiguous quantifies the genuine gap (see CONVERGENCE-REPORT.md).
  const identity = canonicalProductIdentity({
    vendor: signal.affected_vendor,
    product: signal.affected_vendor,
    cve: signal.affected_cve,
  });
  const resolution = await resolveTenantAssets(client, organizationId, identity);
  const cmp = compareApplicabilityShadow(legacyAssetIds, resolution);
  logger.info(
    { ...shadowTelemetry(cmp), organizationId },
    "signal applicability shadow comparison"
  );
  return cmp;
}
