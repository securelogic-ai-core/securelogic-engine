/**
 * /assets/connect/[id] — manage a single enterprise connector (EAR P16).
 *
 * The self-serve configuration path the read-only catalog (/assets/connect)
 * previously lacked. Admins add credentials (PUT /api/connectors/:id), enable
 * syncing, run a discovery sync (POST /api/connectors/:id/sync), or disconnect
 * (DELETE) — all through EXISTING engine endpoints (no new connector backend).
 * Non-admins get a clear gated message with the next step, not a dead-end.
 *
 * Dark + tenant: gated on SECURELOGIC_ASSET_REGISTRY_ENABLED (neutral panel when
 * off), platform entitlement, and — for the mutations — admin role enforced on
 * the engine (requireAdminRole). The catalog read is org-scoped; a connector id
 * not in this org's catalog renders "not found".
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getConnectors } from "@/lib/api";
import { connectorStatusLabel, connectorsReadFailure } from "@/lib/connectors";
import { ReadFailurePanel } from "@/components/assetKit";
import ConnectorConfigForm from "./ConnectorConfigForm";

const TONE_STYLE: Record<string, React.CSSProperties> = {
  active: { background: "rgba(0,196,180,0.15)", color: "#00c4b4" },
  configured: { background: "rgba(59,130,246,0.15)", color: "#93c5fd" },
  idle: { background: "rgba(148,163,184,0.12)", color: "#64748b" },
};

export default async function ConnectorManagePage({
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

  const { id } = await params;
  const result = await getConnectors(token);

  const backLink = (
    <div className="mb-6">
      <Link href="/assets/connect" className="text-xs underline hover:opacity-80" style={{ color: "#94a3b8" }}>
        ← All connectors
      </Link>
    </div>
  );

  if (!result.ok) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12">
        {backLink}
        <ReadFailurePanel
          {...connectorsReadFailure(result)}
          capabilityNote="Enterprise connectors are part of the Platform plans and require Enterprise Context."
        />
      </div>
    );
  }

  const connector = result.connectors.find((c) => c.connector_id === id);
  if (!connector) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12">
        {backLink}
        <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
          <p className="text-sm" style={{ color: "#94a3b8" }}>
            That connector isn&apos;t available for your organization.
          </p>
        </div>
      </div>
    );
  }

  const isAdmin = (session.userRole ?? "viewer") === "admin";
  const status = connectorStatusLabel(connector);

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      {backLink}

      <div className="mb-8">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>
            {connector.display_name}
          </h1>
          <span
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
            style={TONE_STYLE[status.tone]}
          >
            {status.text}
          </span>
        </div>
        <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
          Connect this source to auto-discover assets into your registry.
        </p>
      </div>

      {isAdmin ? (
        <ConnectorConfigForm connector={connector} />
      ) : (
        <div
          className="rounded-xl border px-5 py-4"
          style={{ borderColor: "#1e293b", background: "#0f172a" }}
        >
          <p className="text-sm font-semibold mb-1" style={{ color: "#f1f5f9" }}>
            Configuration is available to administrators
          </p>
          <p className="text-xs" style={{ color: "#94a3b8" }}>
            Ask an administrator in your organization to add credentials and enable this connector.
            Once it&apos;s connected, discovered assets appear in your registry automatically — you
            can track its status on the{" "}
            <Link href="/assets/connect" className="underline hover:opacity-80" style={{ color: "#00c4b4" }}>
              connectors list
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}
