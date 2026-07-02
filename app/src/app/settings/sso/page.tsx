import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getSsoConfig } from "@/lib/api";
import { SsoConfigForm } from "./SsoConfigForm";
import { DeleteSsoButton } from "./DeleteSsoButton";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export default async function SsoSettingsPage() {
  const session = await getSession();
  const token   = session.jwtToken ?? null;

  if (!token) redirect("/login");

  const entitlement = session.entitlementLevel ?? "starter";
  const orgId       = session.organizationId   ?? "";
  const isPro       = ["professional", "standard", "premium", "platform", "team"].includes(entitlement);

  if (!isPro) {
    return (
      <div style={{ maxWidth: "672px", margin: "0 auto", padding: "48px 24px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#f1f5f9", marginBottom: "8px" }}>
          Single Sign-On (SSO)
        </h1>
        <p style={{ color: "#64748b", marginBottom: "24px" }}>
          Configure SAML 2.0 authentication for your organization.
        </p>
        <div style={{
          background: "#0d1b2e",
          border: "1px solid #1e2d45",
          borderRadius: "12px",
          padding: "32px",
          textAlign: "center",
        }}>
          <p style={{ color: "#94a3b8", marginBottom: "16px" }}>
            SSO requires a <strong style={{ color: "#00c4b4" }}>Brief Pro</strong> plan or above.
          </p>
          <Link
            href="/billing"
            style={{
              display: "inline-block",
              background: "#00c4b4",
              color: "#fff",
              fontWeight: 600,
              padding: "10px 24px",
              borderRadius: "8px",
              textDecoration: "none",
            }}
          >
            Upgrade Plan
          </Link>
        </div>
      </div>
    );
  }

  const ssoData = await getSsoConfig(token);
  const config  = ssoData?.config ?? null;

  return (
    <div style={{ maxWidth: "672px", margin: "0 auto", padding: "48px 24px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "32px" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#f1f5f9", margin: "0 0 6px" }}>
            Single Sign-On (SSO)
          </h1>
          <p style={{ color: "#64748b", margin: 0 }}>
            Configure SAML 2.0 authentication for your organization.
          </p>
        </div>
        {entitlement === "professional" && (
          <span style={{
            background: "rgba(0,196,180,0.12)",
            color: "#00c4b4",
            fontSize: "12px",
            fontWeight: 600,
            padding: "4px 10px",
            borderRadius: "20px",
          }}>
            Brief Pro Plan
          </span>
        )}
      </div>

      {config ? (
        <>
          {/* Read-only summary */}
          <div style={{
            background: "#0d1b2e",
            border: "1px solid #1e2d45",
            borderRadius: "12px",
            padding: "24px",
            marginBottom: "24px",
          }}>
            <h2 style={{ fontSize: "15px", fontWeight: 600, color: "#f1f5f9", margin: "0 0 16px" }}>
              Current Configuration
            </h2>

            <ConfigRow label="IdP Entity ID"   value={config.idp_entity_id} />
            <ConfigRow label="IdP SSO URL"      value={config.idp_sso_url} />
            <ConfigRow label="Certificate"      value={config.idp_certificate} />
            <ConfigRow label="SP Entity ID"     value={config.sp_entity_id} />
            <ConfigRow
              label="Enforcement"
              value={config.is_enforced ? "Enforced — password login disabled" : "Optional — password login allowed"}
            />
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <a
              href={`${ENGINE_URL}/api/sso/${orgId}/metadata`}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "inline-block",
                padding: "9px 18px",
                border: "1px solid #1e2d45",
                borderRadius: "8px",
                fontSize: "13px",
                fontWeight: 600,
                color: "#94a3b8",
                textDecoration: "none",
              }}
            >
              Download SP Metadata
            </a>
            <DeleteSsoButton />
          </div>

          {/* Edit form */}
          <div style={{ marginTop: "32px" }}>
            <h2 style={{ fontSize: "15px", fontWeight: 600, color: "#f1f5f9", marginBottom: "16px" }}>
              Edit Configuration
            </h2>
            <SsoConfigForm existingConfig={config} orgId={orgId} />
          </div>
        </>
      ) : (
        <>
          {/* Empty state */}
          <div style={{
            background: "#0d1b2e",
            border: "1px solid #1e2d45",
            borderRadius: "12px",
            padding: "32px",
            textAlign: "center",
            marginBottom: "32px",
          }}>
            <p style={{ color: "#94a3b8", margin: "0 0 8px", fontWeight: 600 }}>
              SSO is not configured.
            </p>
            <p style={{ color: "#64748b", margin: "0 0 0" }}>
              Connect your identity provider to enable single sign-on for your team.
            </p>
          </div>

          <SsoConfigForm orgId={orgId} />
        </>
      )}
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: "12px", marginBottom: "12px", alignItems: "flex-start" }}>
      <span style={{ minWidth: "130px", fontSize: "12px", fontWeight: 600, color: "#64748b", paddingTop: "2px" }}>
        {label}
      </span>
      <span style={{ fontSize: "13px", color: "#cbd5e1", wordBreak: "break-all" }}>
        {value}
      </span>
    </div>
  );
}
