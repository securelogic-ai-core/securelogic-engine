/**
 * /assets/[id] — detail page for a registry asset (EAR P6).
 *
 * The CRUD home for the four detail-backed types (cloud_resource / endpoint /
 * api / identity_system — EAR-AD-1: the other kinds deep-link out to their
 * authoritative per-type pages from the list). Renders the canonical header
 * plus the typed detail columns the engine returns from GET /api/assets/:id.
 * Read-only v1; mutations are API-first (PATCH/DELETE /api/assets/:id).
 *
 * Dark: engine 404s while SECURELOGIC_ASSET_REGISTRY_ENABLED is off.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getAsset } from "@/lib/api";
import {
  assetTypeLabel,
  assetsReadFailure,
  assetDetailHref,
  assetGraphHref,
  isDetailBackedType,
  type CanonicalAsset,
} from "@/lib/assetRegistry";
import {
  CriticalityBadge,
  StatusChip,
  TypeChip,
  MetaChip,
  ReadFailurePanel,
} from "@/components/assetKit";
import { AssetManageActions } from "./AssetManageActions";

/** Header columns are rendered explicitly; everything else in the detail row is typed payload. */
const NON_TYPED_DETAIL_KEYS = new Set([
  "id",
  "organization_id",
  "name",
  "criticality",
  "owner_user_id",
  "status",
  "external_ref",
  "asset_id",
  "created_at",
  "updated_at",
]);

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
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

  const { id } = await params;
  const result = await getAsset(token, id);
  const eclEnabled = process.env.SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED === "true";

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <div className="mb-6">
        <Link href="/assets" className="text-xs underline hover:opacity-80" style={{ color: "#94a3b8" }}>
          ← All assets
        </Link>
      </div>

      {!result.ok ? (
        <ReadFailurePanel
          {...assetsReadFailure(result)}
          capabilityNote="The Asset Registry is part of the Platform plans."
        />
      ) : (
        <>
          <div className="mb-8">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>
                {result.asset.name}
              </h1>
              <TypeChip label={assetTypeLabel(result.asset.asset_type)} />
              <StatusChip value={result.asset.status} />
            </div>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <CriticalityBadge value={result.asset.criticality} />
              <MetaChip label="Backing" value={result.asset.backing_kind.replaceAll("_", " ")} />
              <MetaChip
                label="Added"
                value={new Date(result.asset.created_at).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              />
            </div>
          </div>

          {/* Management actions (EAR-AD-1): unified-surface CRUD for detail-backed
              types; everything else is edited on its authoritative screen. */}
          {isDetailBackedType(result.asset.asset_type) ? (
            <div className="mb-8">
              <AssetManageActions
                assetId={result.asset.asset_id}
                assetName={result.asset.name}
                status={result.asset.status}
              />
            </div>
          ) : (
            <ManagedElsewhereNote asset={result.asset} />
          )}

          {/* Relationship management entry point — the enterprise graph is the
              shared relationship surface (dark behind the ECL flag). */}
          {eclEnabled && (
            <div className="mb-8">
              <Link
                href={assetGraphHref(result.asset)}
                className="inline-flex items-center gap-1.5 text-sm font-medium transition-colors hover:opacity-80"
                style={{ color: "#00c4b4" }}
              >
                View relationships in the enterprise graph →
              </Link>
            </div>
          )}

          {result.detail && (
            <section>
              <h2 className="text-sm font-semibold mb-3" style={{ color: "#f1f5f9" }}>
                Details
              </h2>
              <div className="bg-brand-surface border border-brand-line rounded-xl p-5 space-y-2.5">
                {typedEntries(result.detail).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between text-sm">
                    <span style={{ color: "#94a3b8" }}>{fieldLabel(k)}</span>
                    <span style={{ color: "#cbd5e1" }}>{v ?? "—"}</span>
                  </div>
                ))}
                {result.detail.external_ref != null && (
                  <div className="flex items-center justify-between text-sm">
                    <span style={{ color: "#94a3b8" }}>External ref</span>
                    <span className="font-mono text-xs" style={{ color: "#cbd5e1" }}>
                      {String(result.detail.external_ref)}
                    </span>
                  </div>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/**
 * EAR-AD-1: vendor / AI-system / enterprise-entity-backed assets are managed on
 * their own screens, not the unified surface. Point the user there instead of
 * offering an Edit/Delete the engine would 409.
 */
function ManagedElsewhereNote({ asset }: { asset: CanonicalAsset }) {
  const href = assetDetailHref(asset, {
    enterpriseContextEnabled: process.env.SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED === "true",
  });
  // With Enterprise Context dark, an entity-backed asset's href falls back to
  // THIS page — no self-link, and "its own screen" would name a surface that
  // doesn't exist here, so the copy degrades to read-only phrasing.
  const isSelf = href === `/assets/${asset.asset_id}`;
  return (
    <div
      className="mb-8 rounded-xl border px-5 py-4 flex flex-wrap items-center justify-between gap-3"
      style={{ borderColor: "#1e293b", background: "#0f172a" }}
    >
      <p className="text-xs" style={{ color: "#94a3b8" }}>
        {isSelf
          ? `This ${assetTypeLabel(asset.asset_type).toLowerCase()} is read-only here.`
          : `This ${assetTypeLabel(asset.asset_type).toLowerCase()} is managed on its own screen.`}
      </p>
      {href && !isSelf && (
        <Link
          href={href}
          className="text-sm font-semibold transition-opacity hover:opacity-80"
          style={{ color: "#00c4b4" }}
        >
          Manage →
        </Link>
      )}
    </div>
  );
}

function typedEntries(detail: Record<string, unknown>): Array<[string, string | null]> {
  return Object.entries(detail)
    .filter(([k]) => !NON_TYPED_DETAIL_KEYS.has(k))
    .map(([k, v]) => [k, v === null || v === undefined ? null : String(v)]);
}

function fieldLabel(key: string): string {
  return key.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}
