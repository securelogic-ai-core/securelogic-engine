import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getWebhooks, getWebhookEventTypes } from "@/lib/api";
import { WebhooksClient } from "./WebhooksClient";

export default async function WebhooksSettingsPage() {
  const session = await getSession();
  const token = session.jwtToken ?? null;
  if (!token) redirect("/login");

  const isAdmin = (session.userRole ?? "viewer") === "admin";

  const [data, catalog] = await Promise.all([
    getWebhooks(token),
    getWebhookEventTypes(token),
  ]);
  const endpoints = data?.endpoints ?? [];
  // The engine owns the vocabulary; an unreachable catalog degrades to an
  // empty picker rather than offering event types the engine may reject.
  const eventTypes = catalog ?? [];

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
          {eventTypes.length === 0 && (
            <p style={{ margin: 0, fontSize: "12px", color: "#64748b" }}>
              Event catalog unavailable right now — reload to try again.
            </p>
          )}
          {eventTypes.map(({ event_type, description }) => (
            <div key={event_type} style={{ display: "flex", gap: "16px", padding: "4px 0", borderBottom: "1px solid #1e2d45", fontSize: "12px" }}>
              <code style={{ color: "#00c4b4", minWidth: "220px", fontFamily: "monospace" }}>{event_type}</code>
              <span style={{ color: "#64748b" }}>{description}</span>
            </div>
          ))}
        </div>
      </details>

      {/* Payload format & delivery semantics — the envelope the dispatcher
          actually builds (id/event_type/version/created_at/data) and the
          retry contract the retry worker enforces. */}
      <details style={{ marginBottom: "28px" }}>
        <summary style={{ fontSize: "12px", fontWeight: 600, color: "#94a3b8", cursor: "pointer", userSelect: "none" }}>
          Payload format &amp; delivery
        </summary>
        <div style={{ marginTop: "10px", background: "#0a0f1a", border: "1px solid #1e2d45", borderRadius: "8px", padding: "16px" }}>
          <p style={{ margin: "0 0 10px", fontSize: "12px", color: "#94a3b8" }}>
            Every delivery is a JSON envelope. <code style={{ color: "#00c4b4" }}>data</code> carries the
            event-specific fields; its schema is keyed by{" "}
            <code style={{ color: "#00c4b4" }}>(event_type, version)</code>.
          </p>
          <pre style={{ margin: 0, fontSize: "11px", color: "#64748b", overflow: "auto" }}>
{`{
  "id": "9f4b1c2e-…",            // unique per delivery — use for idempotency
  "event_type": "finding.created",
  "version": 1,                   // present once versioned payloads are enabled
  "created_at": "2026-07-30T00:00:00.000Z",
  "data": { … }                   // event-specific fields
}`}
          </pre>
          <p style={{ margin: "12px 0 4px", fontSize: "12px", fontWeight: 600, color: "#94a3b8" }}>
            Delivery &amp; retries
          </p>
          <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "12px", color: "#64748b", lineHeight: 1.7 }}>
            <li>Any <code style={{ color: "#00c4b4" }}>2xx</code> response marks the delivery successful. Respond quickly; do your processing asynchronously.</li>
            <li>Failures are retried after 1 minute, then 5 minutes; after 3 attempts the delivery is marked failed.</li>
            <li>Redelivery stops 24 hours after the event — treat webhooks as at-least-once and deduplicate on <code style={{ color: "#00c4b4" }}>id</code>.</li>
            <li>Retries sign with the endpoint&apos;s <em>current</em> secret — after a rotation, verify against the new secret only.</li>
            <li>Disabled endpoints are never retried.</li>
          </ul>
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

      <WebhooksClient initialEndpoints={endpoints} isAdmin={isAdmin} eventTypes={eventTypes} />
    </div>
  );
}
