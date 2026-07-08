/**
 * /assets/import — the unified Asset Registry bulk-import surface (EAR P16).
 *
 * ONE import UI for the 10 real canonical asset types, with real server-side
 * preview / dedup / caps / row-level errors. It reuses EXISTING engine bulk
 * endpoints (EAR-AD-1 federation, mirrored from /assets/new):
 *   - the 4 detail-backed types → POST /api/assets/import (the thin P16 route);
 *   - the other 6 → POST /api/enterprise-context/import (the ECL bulk endpoint).
 * Nothing is re-implemented here. SOC upload stays under Vendor Management; the
 * legacy /vendors/import and /ai-systems/import surfaces are preserved, unchanged.
 *
 * Dark: gated on SECURELOGIC_ASSET_REGISTRY_ENABLED (neutral panel when off),
 * identical to /assets/new. The ECL-backed types are additionally fenced on
 * SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED — off → only the detail-backed types are
 * offered (the ECL endpoint would 404). Non-platform users redirect to /dashboard.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { assetImportOptions } from "@/lib/assetRegistry";
import { ReadFailurePanel } from "@/components/assetKit";
import AssetImportClient from "./AssetImportClient";

export default async function AssetImportPage() {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" || entitlementLevel === "platform" || entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  const registryEnabled = process.env.SECURELOGIC_ASSET_REGISTRY_ENABLED === "true";
  if (!registryEnabled) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12">
        <ReadFailurePanel
          kind="disabled"
          message="The Asset Registry isn't available for your organization yet."
          capabilityNote="The Asset Registry is part of the Platform plans."
        />
      </div>
    );
  }

  const eclEnabled = process.env.SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED === "true";
  // Detail-backed types always; ECL-backed only when the ECL flag is on (same
  // rule /assets/new applies to the federated create + import options).
  const options = assetImportOptions().filter((o) => !o.requiresEcl || eclEnabled);

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <Link
        href="/assets/new"
        className="inline-flex items-center gap-1.5 text-xs font-medium mb-6 transition-colors hover:opacity-80"
        style={{ color: "#94a3b8" }}
      >
        ← Add assets
      </Link>
      <h1 className="text-2xl font-bold mb-2" style={{ color: "#f1f5f9" }}>
        Bulk upload assets
      </h1>
      <p className="text-sm mb-8" style={{ color: "#94a3b8" }}>
        Import many assets at once from a CSV or XLSX file. Choose the asset type, preview the plan
        (nothing is written until you commit), then import — validation, de-duplication, and plan
        caps are all applied for you. Up to 5,000 data rows per file.
      </p>

      <AssetImportClient options={options} />
    </div>
  );
}
