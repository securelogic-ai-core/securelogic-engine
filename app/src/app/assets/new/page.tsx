/**
 * /assets/new — the canonical Asset Registry create / onboarding surface.
 *
 * It exposes the THREE canonical onboarding methods (EAR P15) as co-equal,
 * first-class options — each REUSES an existing flow, nothing is re-implemented:
 *   1. Create manually  — the federated per-type create picker (EAR-AD-1): the
 *      four detail-backed types render the native AssetForm inline; vendors / AI
 *      systems / applications / data stores / other open their authoritative
 *      screens (ECL ones only when the ECL flag is on, so we never point at a
 *      dark page).
 *   2. Bulk upload      — the existing CSV/XLSX importers (assetImportSurfaces):
 *      preview, validation, de-duplication, row-level errors and plan caps live
 *      in those surfaces; this is entry points, not a new importer.
 *   3. Connect systems  — the existing /assets/connect connector catalog
 *      (EAR Phase 3b). Not "coming soon" — the route exists.
 * SOC upload is deliberately absent — it stays under Vendor Management.
 *
 * Dark: unchanged. Non-platform users redirect to /dashboard; the whole surface
 * gates on SECURELOGIC_ASSET_REGISTRY_ENABLED (neutral panel when off), and the
 * ECL-backed sub-options (applications/data-store import, connectors) are
 * additionally fenced on SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED. A submit still
 * 404s/403s at the engine when the flag/capability is off.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  DETAIL_BACKED_TYPES,
  isDetailBackedType,
  assetTypeLabel,
  assetCreateTarget,
  assetCreateHref,
  assetOnboardingMethods,
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

const sectionHeading = "text-xs font-semibold uppercase tracking-wide mb-3";

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

  // A detail-backed type was chosen → render the native create form directly.
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

  // Otherwise: the onboarding surface — the three canonical methods.
  const externalTargets = ASSET_TYPES.filter((t) => !isDetailBackedType(t))
    .map((t) => ({ type: t, target: assetCreateTarget(t) }))
    .filter((x) => x.target.kind === "external" && (!x.target.requiresEcl || eclEnabled));

  const methods = assetOnboardingMethods();
  const method = (key: string) => methods.find((m) => m.key === key)!;

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
        Add assets
      </h1>
      <p className="text-sm mb-10" style={{ color: "#94a3b8" }}>
        Three ways to add assets to your registry — create one manually, bulk upload a spreadsheet,
        or connect an enterprise system to auto-discover them.
      </p>

      {/* ── 1 · Create manually ─────────────────────────────────────────── */}
      <section className="mb-12">
        <h2 className={sectionHeading} style={{ color: "#00c4b4" }}>
          1 · {method("create").title}
        </h2>
        <p className="text-sm mb-4" style={{ color: "#94a3b8" }}>
          {method("create").description}
        </p>

        {/* Native (unified-surface) types */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          {DETAIL_BACKED_TYPES.map((t) => (
            <Link
              key={t}
              href={assetCreateHref(t)}
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

        {/* Federated types (managed on their own screens) */}
        <div className="rounded-xl border divide-y" style={{ borderColor: "#1e293b" }}>
          {externalTargets.map(({ type }) => (
            <Link
              key={type}
              href={assetCreateHref(type)}
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
      </section>

      {/* ── 2 · Bulk upload ─────────────────────────────────────────────── */}
      <section className="mb-12">
        <h2 className={sectionHeading} style={{ color: "#00c4b4" }}>
          2 · {method("import").title}
        </h2>
        <p className="text-sm mb-4" style={{ color: "#94a3b8" }}>
          {method("import").description}
        </p>
        <Link
          href="/assets/import"
          className="block rounded-xl border p-4 transition-colors hover:opacity-90"
          style={{ borderColor: "#1e293b", background: "#0f172a" }}
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold" style={{ color: "#f1f5f9" }}>
                Upload a spreadsheet
              </div>
              <div className="text-xs mt-1" style={{ color: "#94a3b8" }}>
                One import flow for every asset type — pick a type, preview the plan, then commit.
                Validation, de-duplication, and plan caps are applied for you.
              </div>
            </div>
            <span className="flex-shrink-0 text-xs" style={{ color: "#64748b" }}>
              Upload CSV / XLSX →
            </span>
          </div>
        </Link>
      </section>

      {/* ── 3 · Connect enterprise systems ──────────────────────────────── */}
      <section className="mb-4">
        <h2 className={sectionHeading} style={{ color: "#00c4b4" }}>
          3 · {method("connect").title}
        </h2>
        <p className="text-sm mb-4" style={{ color: "#94a3b8" }}>
          {method("connect").description}
        </p>
        <Link
          href={method("connect").href ?? "/assets/connect"}
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
      </section>
    </div>
  );
}
