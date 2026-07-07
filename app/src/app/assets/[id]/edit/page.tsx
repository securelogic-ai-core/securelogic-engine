/**
 * /assets/[id]/edit — edit a detail-backed registry asset (EAR P6).
 *
 * Loads the canonical header + typed detail (GET /api/assets/:id), guards that
 * the asset is one of the four detail-backed types (EAR-AD-1 — everything else
 * is edited on its own screen; we redirect back to the read page rather than
 * offer a form the engine would 409), and renders AssetForm in edit mode.
 *
 * Dark: the engine 404s while SECURELOGIC_ASSET_REGISTRY_ENABLED is off →
 * neutral panel; 403 without the capability → entitlement affordance.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getAsset } from "@/lib/api";
import {
  isDetailBackedType,
  assetTypeLabel,
  assetsReadFailure,
  DETAIL_TYPE_FIELDS,
} from "@/lib/assetRegistry";
import { ReadFailurePanel } from "@/components/assetKit";
import AssetForm, { type AssetInitial } from "../../AssetForm";

export default async function EditAssetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" || entitlementLevel === "platform" || entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  const { id } = await params;
  const result = await getAsset(token, id);

  if (!result.ok) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12">
        <ReadFailurePanel
          {...assetsReadFailure(result)}
          capabilityNote="The Asset Registry is part of the Platform plans."
        />
      </div>
    );
  }

  const assetType = result.asset.asset_type;
  // EAR-AD-1: only detail-backed types are edited on the unified surface.
  if (!isDetailBackedType(assetType)) {
    redirect(`/assets/${id}`);
  }

  const detail = result.detail ?? {};
  const asStr = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
  const typed: Record<string, string | null> = {};
  for (const f of DETAIL_TYPE_FIELDS[assetType]) typed[f.field] = asStr(detail[f.field]);

  const initial: AssetInitial = {
    name: result.asset.name,
    criticality: result.asset.criticality,
    status: result.asset.status,
    external_ref: asStr(detail.external_ref),
    typed,
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <Link
        href={`/assets/${id}`}
        className="inline-flex items-center gap-1.5 text-xs font-medium mb-6 transition-colors hover:opacity-80"
        style={{ color: "#94a3b8" }}
      >
        ← {result.asset.name}
      </Link>
      <h1 className="text-2xl font-bold mb-2" style={{ color: "#f1f5f9" }}>
        Edit {assetTypeLabel(assetType)}
      </h1>
      <p className="text-sm mb-8" style={{ color: "#94a3b8" }}>
        Update this asset&apos;s attributes, criticality, or lifecycle status.
      </p>
      <AssetForm mode="edit" assetId={id} assetType={assetType} initial={initial} />
    </div>
  );
}
