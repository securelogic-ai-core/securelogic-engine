import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getWebhooks } from "@/lib/api";
import { WebhooksClient } from "./WebhooksClient";

export default async function WebhooksSettingsPage() {
  const session = await getSession();
  const token = session.jwtToken ?? null;
  if (!token) redirect("/login");

  const isAdmin = (session.userRole ?? "viewer") === "admin";

  const data = await getWebhooks(token);
  const endpoints = data?.endpoints ?? [];

  return (
    <div style={{ maxWidth: "720px", margin: "0 auto", padding: "48px 24px" }}>
      {/* Back link */}
      <Link
        href="/account/api-keys"
        style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 500, color: "#94a3b8", textDecoration: "none", marginBottom: "32px" }}
      >
        ← API Keys
      </Link>

      {/* Header */}
      <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#f1f5f9", margin: "0 0 8px" }}>
        Webhooks
      </h1>
      <p style={{ margin: "0 0 32px", fontSize: "14px", color: "#64748b" }}>
        Receive real-time events when findings, risks, and vendor assessments change in your environment.
      </p>

      {/* Tab strip — links to related settings */}
      <div style={{ display: "flex", gap: "4px", marginBottom: "32px", borderBottom: "1px solid #1e2d45", paddingBottom: "0" }}>
        {[
          { label: "API Keys", href: "/account/api-keys" },
          { label: "Webhooks", href: "/settings/webhooks" },
          { label: "SSO",      href: "/settings/sso" },
        ].map(({ label, href }) => {
          const active = label === "Webhooks";
          return (
            <Link
              key={label}
              href={href}
              style={{
                padding: "8px 16px",
                fontSize: "13px",
                fontWeight: 600,
                color: active ? "#00c4b4" : "#64748b",
                textDecoration: "none",
                borderBottom: active ? "2px solid #00c4b4" : "2px solid transparent",
                marginBottom: "-1px",
              }}
            >
              {label}
            </Link>
          );
        })}
      </div>

      {/* Event reference */}
      <details style={{ marginBottom: "28px" }}>
        <summary style={{ fontSize: "12px", fontWeight: 600, color: "#94a3b8", cursor: "pointer", userSelect: "none" }}>
          Supported event types
        </summary>
        <div style={{ marginTop: "10px", background: "#0a0f1a", border: "1px solid #1e2d45", borderRadius: "8px", padding: "12px 16px" }}>
          {[
            ["finding.created",          "A new finding is created"],
            ["finding.updated",          "A finding status or priority changes"],
            ["risk.created",             "A new risk is added to the register"],
            ["vendor.assessed",          "A vendor assessment is completed"],
            ["posture.snapshot_created", "A posture snapshot is computed"],
            ["action.created",           "A new action is created"],
            ["action.updated",           "An action status changes"],
          ].map(([evt, desc]) => (
            <div key={evt} style={{ display: "flex", gap: "16px", padding: "4px 0", borderBottom: "1px solid #1e2d45", fontSize: "12px" }}>
              <code style={{ color: "#00c4b4", minWidth: "220px", fontFamily: "monospace" }}>{evt}</code>
              <span style={{ color: "#64748b" }}>{desc}</span>
            </div>
          ))}
        </div>
      </details>

      {/* Signing instructions */}
      <details style={{ marginBottom: "32px" }}>
        <summary style={{ fontSize: "12px", fontWeight: 600, color: "#94a3b8", cursor: "pointer", userSelect: "none" }}>
          Verifying signatures
        </summary>
        <div style={{ marginTop: "10px", background: "#0a0f1a", border: "1px solid #1e2d45", borderRadius: "8px", padding: "16px" }}>
          <p style={{ margin: "0 0 10px", fontSize: "12px", color: "#94a3b8" }}>
            Each request includes these headers:
          </p>
          <pre style={{ margin: 0, fontSize: "11px", color: "#64748b", overflow: "auto" }}>
{`X-SecureLogic-Signature: sha256=<hmac>
X-SecureLogic-Timestamp: <unix seconds>
X-SecureLogic-Event-Version: 1`}
          </pre>
          <p style={{ margin: "10px 0 0", fontSize: "12px", color: "#94a3b8" }}>
            Verify: <code style={{ color: "#00c4b4" }}>HMAC-SHA256(key=secret_without_whsec_, data=&quot;timestamp.body&quot;)</code>
          </p>
        </div>
      </details>

      <WebhooksClient initialEndpoints={endpoints} isAdmin={isAdmin} />
    </div>
  );
}
