/**
 * /assets/connect — the canonical "Connect Enterprise Systems" surface.
 *
 * The single source of truth for enterprise-connector onboarding: it lists the
 * registry's connector catalog (GET /api/connectors) grouped by category with
 * each connector's live state (Connected / Configured / Not connected), so the
 * Asset Registry AND the Setup Wizard launch the SAME flow — no duplicated
 * onboarding logic. Connectors discover assets INTO the registry.
 *
 * Read-only v1: connector credentials are operator-owned (registry.ts header —
 * ledger L-5.*), so configuration is administered by an org admin via the
 * connectors API rather than a self-serve credential form here. This is NOT a
 * "coming soon" placeholder — the config + sync backend exists and live status
 * is shown; only the credential-entry UI is intentionally out of scope.
 *
 * Dark: gated on SECURELOGIC_ASSET_REGISTRY_ENABLED (app half, same as
 * /assets/new) → neutral panel while off. The engine additionally double-fences
 * /api/connectors behind the ECL flag + `enterprise_context` capability, so an
 * ECL-off / ungranted org gets the disabled / capability panel from the read.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getConnectors } from "@/lib/api";
import {
  groupConnectorsByCategory,
  connectorStatusLabel,
  connectorsReadFailure,
  type OrgConnector,
  type ConnectorStatusTone,
} from "@/lib/connectors";
import { MetaChip, ReadFailurePanel } from "@/components/assetKit";

const TONE_STYLE: Record<ConnectorStatusTone, React.CSSProperties> = {
  active: { background: "rgba(0,196,180,0.15)", color: "#00c4b4" },
  configured: { background: "rgba(59,130,246,0.15)", color: "#93c5fd" },
  idle: { background: "rgba(148,163,184,0.12)", color: "#64748b" },
};

export default async function ConnectAssetsPage() {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" || entitlementLevel === "platform" || entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  // Dark-launch parity: gate on the same app-side flag as the rest of the
  // registry so a direct hit while dark shows the neutral panel, not the catalog.
  const registryEnabled = process.env.SECURELOGIC_ASSET_REGISTRY_ENABLED === "true";
  if (!registryEnabled) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <ReadFailurePanel
          kind="disabled"
          message="The Asset Registry isn't available for your organization yet."
          capabilityNote="The Asset Registry is part of the Platform plans."
        />
      </div>
    );
  }

  const result = await getConnectors(token);

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <div className="mb-6">
        <Link href="/assets/new" className="text-xs underline hover:opacity-80" style={{ color: "#94a3b8" }}>
          ← Add an asset
        </Link>
      </div>

      <div className="mb-8">
        <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>
          Connect enterprise systems
        </h1>
        <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
          Connect a source of truth — CMDB, cloud, vulnerability, identity, or endpoint — to
          automatically discover assets into your registry. Select a connector to add credentials,
          enable syncing, and run a discovery sync. Configuration is available to administrators.
        </p>
      </div>

      {!result.ok ? (
        <ReadFailurePanel
          {...connectorsReadFailure(result)}
          capabilityNote="Enterprise connectors are part of the Platform plans and require Enterprise Context."
        />
      ) : result.connectors.length === 0 ? (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
          <p className="text-sm" style={{ color: "#94a3b8" }}>
            No connector types are available.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {groupConnectorsByCategory(result.connectors).map((group) => (
            <section key={group.category}>
              <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "#94a3b8" }}>
                {group.label}
              </h2>
              <div className="bg-brand-surface border border-brand-line rounded-xl divide-y" style={{ borderColor: "#1e293b" }}>
                {group.connectors.map((c) => (
                  <ConnectorRow key={c.connector_id} connector={c} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function ConnectorRow({ connector }: { connector: OrgConnector }) {
  const status = connectorStatusLabel(connector);
  const lastSync = connector.last_sync_at
    ? new Date(connector.last_sync_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
    : null;
  return (
    <Link
      href={`/assets/connect/${encodeURIComponent(connector.connector_id)}`}
      className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:opacity-80"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold" style={{ color: "#f1f5f9" }}>
            {connector.display_name}
          </span>
          <span
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
            style={TONE_STYLE[status.tone]}
          >
            {status.text}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          {connector.enabled && <MetaChip label="Last sync" value={lastSync ?? "pending"} />}
          {connector.configured && !connector.enabled && (
            <MetaChip label="State" value="awaiting activation" />
          )}
          {!connector.configured && (
            <span className="text-xs" style={{ color: "#64748b" }}>
              Not connected — an administrator adds credentials to connect.
            </span>
          )}
        </div>
      </div>
      <span className="flex-shrink-0 text-xs" style={{ color: "#64748b" }}>
        {connector.configured ? "Manage →" : "Configure →"}
      </span>
    </Link>
  );
}
