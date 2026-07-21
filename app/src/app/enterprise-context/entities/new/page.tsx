import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ENTITY_TYPES, type EntityType } from "@/lib/enterpriseContext";
import { entityTypeLabel } from "@/lib/enterpriseContextFormat";
import { assetTypeLabel, isAssetType } from "@/lib/assetRegistry";
import EntityForm from "../EntityForm";

/**
 * Add-Entity — the ECL create form, also the canonical landing for the registry's
 * application / database / business_process asset types (EAR-AD-1 federation).
 *
 * When the registry routes here it passes `?entity_type=&asset_type=` (see
 * assetCreateHref): the entity_type is preselected AND locked (the user already
 * chose the type on the registry), and the page title reflects the ASSET type
 * ("Create Database", not "Add Data Store"). Arriving with no params keeps the
 * original generic behavior — the full type picker — which is the one case where
 * a user is explicitly creating a generic/custom entity.
 */
export default async function NewEnterpriseEntityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" ||
    entitlementLevel === "platform" ||
    entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  const sp = await searchParams;
  const presetType = (ENTITY_TYPES as readonly string[]).includes(sp.entity_type ?? "")
    ? (sp.entity_type as EntityType)
    : undefined;
  const assetType = isAssetType(sp.asset_type) ? sp.asset_type : undefined;

  // Framed as a registry asset-type flow when we arrived from /assets.
  const fromRegistry = presetType !== undefined;
  const backHref = fromRegistry ? "/assets" : "/enterprise-context";
  const backLabel = fromRegistry ? "Assets" : "Enterprise Context";

  // Title prefers the asset-type label ("Create Database"); falls back to the
  // entity-type label, then the generic "Add Entity".
  const typeLabel = assetType
    ? assetTypeLabel(assetType)
    : presetType
      ? entityTypeLabel(presetType)
      : undefined;
  const title = typeLabel ? `Create ${typeLabel}` : "Add Entity";

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 text-xs font-medium mb-6 transition-colors hover:opacity-80"
        style={{ color: "#94a3b8" }}
      >
        ← {backLabel}
      </Link>

      <h1 className="text-2xl font-bold mb-2" style={{ color: "#f1f5f9" }}>
        {title}
      </h1>
      <p className="text-sm mb-8" style={{ color: "#94a3b8" }}>
        {typeLabel
          ? `Register a new ${typeLabel.toLowerCase()} in your Asset Registry.`
          : "Register an asset, application, service, data store, or organizational unit."}
      </p>

      <EntityForm presetType={presetType} lockType={fromRegistry} cancelHref={backHref} />
    </div>
  );
}
