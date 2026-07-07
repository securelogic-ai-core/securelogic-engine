/**
 * /assets/new — the registry's create router (EAR management UI).
 *
 * The unified surface is the CRUD home for the four detail-backed types only
 * (cloud_resource / endpoint / api / identity_system): choosing one renders the
 * native AssetForm and POSTs /api/assets. Every other type is created on its
 * authoritative surface (EAR-AD-1 federation) — vendors / AI systems always,
 * and applications / data stores / other entities on the Enterprise Context
 * surface (only surfaced when the ECL flag is on, so we never point at a dark
 * page). A CSV import section hands off to the existing per-surface importers —
 * there is no unified import API, so this is entry points, not a new endpoint.
 *
 * Dark: unchanged from the read pages — non-platform users redirect to
 * /dashboard, and the nav entry stays hidden until SECURELOGIC_ASSET_REGISTRY_
 * ENABLED is on. A submit still 404s/403s at the engine when the flag/capability
 * is off, surfaced by AssetForm's error copy.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  DETAIL_BACKED_TYPES,
  isDetailBackedType,
  assetTypeLabel,
  assetCreateTarget,
  assetImportSurfaces,
  ASSET_TYPES,
} from "@/lib/assetRegistry";
import { ReadFailurePanel } from "@/components/assetKit";
import AssetForm from "../AssetForm";

const TYPE_BLURB: Record<string, string> = {
  cloud_resource: "AWS / Azure / GCP accounts, buckets, compute, managed services.",
  endpoint: "Hosts, servers, and workstations by hostname, OS, and exposure.",
  api: "Internal or exposed APIs by protocol, auth method, and exposure.",
  identity_system: "IdPs and directories (SAML / OIDC / LDAP).",
};

export default async function NewAssetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" || entitlementLevel === "platform" || entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  // Dark-launch parity: this page has no natural engine read to 404, so gate it
  // on the same flag the nav + read pages honour. Off → the neutral "not
  // available" panel, identical to what /assets shows while dark.
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

  const sp = await searchParams;
  const chosen = sp.type;

  // A detail-backed type was chosen → render the native create form.
  if (isDetailBackedType(chosen)) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12">
        <Link
          href="/assets/new"
          className="inline-flex items-center gap-1.5 text-xs font-medium mb-6 transition-colors hover:opacity-80"
          style={{ color: "#94a3b8" }}
        >
          ← Choose a different type
        </Link>
        <h1 className="text-2xl font-bold mb-2" style={{ color: "#f1f5f9" }}>
          New {assetTypeLabel(chosen)}
        </h1>
        <p className="text-sm mb-8" style={{ color: "#94a3b8" }}>
          {TYPE_BLURB[chosen]}
        </p>
        <AssetForm mode="create" assetType={chosen} />
      </div>
    );
  }

  // Otherwise: the type picker. Native types get in-surface cards; the rest
  // federate to their own create screens (ECL ones only when the flag is on).
  const externalTargets = ASSET_TYPES.filter((t) => !isDetailBackedType(t))
    .map((t) => ({ type: t, target: assetCreateTarget(t) }))
    .filter((x) => x.target.kind === "external" && (!x.target.requiresEcl || eclEnabled));

  const imports = assetImportSurfaces().filter((s) => !s.requiresEcl || eclEnabled);

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <Link
        href="/assets"
        className="inline-flex items-center gap-1.5 text-xs font-medium mb-6 transition-colors hover:opacity-80"
        style={{ color: "#94a3b8" }}
      >
        ← Assets
      </Link>
      <h1 className="text-2xl font-bold mb-2" style={{ color: "#f1f5f9" }}>
        Add an asset
      </h1>
      <p className="text-sm mb-8" style={{ color: "#94a3b8" }}>
        Pick a type. Infrastructure types are created here; vendors, AI systems, and applications are
        managed on their own screens.
      </p>

      {/* Native (unified-surface) types */}
      <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "#94a3b8" }}>
        Infrastructure
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-10">
        {DETAIL_BACKED_TYPES.map((t) => (
          <Link
            key={t}
            href={`/assets/new?type=${t}`}
            className="block rounded-xl border p-4 transition-colors hover:opacity-90"
            style={{ borderColor: "#1e293b", background: "#0f172a" }}
          >
            <div className="text-sm font-semibold" style={{ color: "#f1f5f9" }}>
              {assetTypeLabel(t)}
            </div>
            <div className="text-xs mt-1" style={{ color: "#94a3b8" }}>
              {TYPE_BLURB[t]}
            </div>
          </Link>
        ))}
      </div>

      {/* Federated types (managed elsewhere) */}
      <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "#94a3b8" }}>
        Managed on their own screens
      </h2>
      <div className="rounded-xl border divide-y mb-10" style={{ borderColor: "#1e293b" }}>
        {externalTargets.map(({ type, target }) => (
          <Link
            key={type}
            href={target.kind === "external" ? target.href : "/assets/new"}
            className="flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:opacity-80"
          >
            <span className="text-sm font-medium" style={{ color: "#f1f5f9" }}>
              {assetTypeLabel(type)}
            </span>
            <span className="text-xs" style={{ color: "#64748b" }}>
              Open screen →
            </span>
          </Link>
        ))}
        {externalTargets.length === 0 && (
          <p className="px-5 py-3.5 text-xs" style={{ color: "#64748b" }}>
            Vendors and AI systems are managed on their own screens.
          </p>
        )}
      </div>

      {/* CSV import entry points (existing importers — no unified import API) */}
      <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "#94a3b8" }}>
        Bulk import (CSV)
      </h2>
      <div className="flex flex-wrap gap-2 mb-10">
        {imports.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors hover:opacity-80"
            style={{ borderColor: "#1e293b", color: "#94a3b8" }}
          >
            {s.label} →
          </Link>
        ))}
      </div>

      {/* Connect enterprise systems — the canonical connector catalog. One flow,
          reused by the Setup Wizard; connectors discover assets into the registry. */}
      <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "#94a3b8" }}>
        Connect enterprise systems
      </h2>
      <Link
        href="/assets/connect"
        className="block rounded-xl border p-4 transition-colors hover:opacity-90"
        style={{ borderColor: "#1e293b", background: "#0f172a" }}
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold" style={{ color: "#f1f5f9" }}>
              Connect a source of truth
            </div>
            <div className="text-xs mt-1" style={{ color: "#94a3b8" }}>
              CMDB, cloud, vulnerability, identity, or endpoint systems auto-discover assets into
              your registry.
            </div>
          </div>
          <span className="flex-shrink-0 text-xs" style={{ color: "#64748b" }}>
            Browse connectors →
          </span>
        </div>
      </Link>
    </div>
  );
}
