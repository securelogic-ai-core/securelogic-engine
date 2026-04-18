import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getMe, getAuditLog } from "@/lib/api";
import type { AuditEvent } from "@/lib/api";

const RESOURCE_TYPE_FILTERS = [
  { label: "All",        value: "" },
  { label: "Vendor",     value: "vendor" },
  { label: "Control",    value: "control" },
  { label: "Finding",    value: "finding" },
  { label: "Policy",     value: "policy" },
  { label: "Framework",  value: "framework" },
  { label: "AI System",  value: "ai_system" },
  { label: "Team",       value: "org_invite" },
  { label: "Auth",       value: "user" },
];

function domainFromEventType(eventType: string): string {
  const prefix = eventType.split(".")[0] ?? "";
  return prefix;
}

const BADGE_STYLES: Record<string, { bg: string; color: string }> = {
  auth:              { bg: "rgba(100,116,139,0.15)", color: "#94a3b8" },
  team:              { bg: "rgba(59,130,246,0.15)",  color: "#93c5fd" },
  vendor:            { bg: "rgba(0,196,180,0.15)",   color: "#00c4b4" },
  control:           { bg: "rgba(139,92,246,0.15)",  color: "#c4b5fd" },
  control_assessment:{ bg: "rgba(139,92,246,0.15)",  color: "#c4b5fd" },
  finding:           { bg: "rgba(239,68,68,0.15)",   color: "#fca5a5" },
  policy:            { bg: "rgba(99,102,241,0.15)",  color: "#a5b4fc" },
  framework:         { bg: "rgba(34,197,94,0.15)",   color: "#86efac" },
  ai_system:         { bg: "rgba(6,182,212,0.15)",   color: "#67e8f9" },
  governance_review: { bg: "rgba(6,182,212,0.15)",   color: "#67e8f9" },
  workflow:          { bg: "rgba(245,158,11,0.15)",  color: "#fcd34d" },
  evidence:          { bg: "rgba(100,116,139,0.15)", color: "#94a3b8" },
  obligation:        { bg: "rgba(99,102,241,0.15)",  color: "#a5b4fc" },
  vendor_assessment: { bg: "rgba(0,196,180,0.15)",   color: "#00c4b4" },
  intelligence_brief:{ bg: "rgba(245,158,11,0.15)",  color: "#fcd34d" },
  cyber_signal:      { bg: "rgba(239,68,68,0.15)",   color: "#fca5a5" },
};

const DEFAULT_BADGE = { bg: "rgba(100,116,139,0.1)", color: "#64748b" };

function EventTypeBadge({ eventType }: { eventType: string }) {
  const domain = domainFromEventType(eventType);
  const style = BADGE_STYLES[domain] ?? DEFAULT_BADGE;
  return (
    <span
      style={{
        background: style.bg,
        color: style.color,
        padding: "2px 8px",
        borderRadius: "4px",
        fontSize: "11px",
        fontWeight: 500,
        fontFamily: "monospace",
        whiteSpace: "nowrap",
      }}
    >
      {eventType}
    </span>
  );
}

function formatTimestamp(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function resourceLabel(event: AuditEvent): string {
  const payload = event.payload;
  if (payload && typeof payload === "object") {
    const name = (payload as Record<string, unknown>)["name"];
    if (typeof name === "string" && name) return name;
    const title = (payload as Record<string, unknown>)["title"];
    if (typeof title === "string" && title) return title;
  }
  if (event.resource_id) return event.resource_id.slice(0, 8);
  return event.resource_type;
}

function actorLabel(event: AuditEvent): string {
  if (event.actor_name) return event.actor_name;
  if (event.actor_email) return event.actor_email;
  return "System";
}

function FilterPill({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium transition-colors"
      style={
        active
          ? { background: "rgba(0,196,180,0.15)", color: "#00c4b4", border: "1px solid rgba(0,196,180,0.4)" }
          : { background: "transparent", color: "#94a3b8", border: "1px solid #1e293b" }
      }
    >
      {label}
    </Link>
  );
}

function filterHref(current: Record<string, string | undefined>, key: string, value: string | null): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    if (v !== undefined && k !== key && k !== "cursor") params.set(k, v);
  }
  if (value) params.set(key, value);
  const qs = params.toString();
  return `/audit-log${qs ? `?${qs}` : ""}`;
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const sp = await searchParams;
  const me = await getMe(token);
  const entitlementLevel = me?.entitlementLevel ?? "starter";
  const isPremiumUser = ["premium", "professional", "platform", "team"].includes(entitlementLevel);

  if (!isPremiumUser) {
    return (
      <main style={{ maxWidth: 800, margin: "0 auto", padding: "48px 24px" }}>
        <h1 style={{ color: "#f1f5f9", fontSize: "24px", fontWeight: 700, marginBottom: "8px" }}>
          Audit Log
        </h1>
        <p style={{ color: "#64748b", marginBottom: "32px" }}>
          Audit Log is available on premium and above plans.
        </p>
        <div
          style={{
            background: "#111827",
            border: "1px solid #1e293b",
            borderRadius: "12px",
            padding: "32px",
            textAlign: "center",
          }}
        >
          <p style={{ color: "#94a3b8", marginBottom: "8px" }}>
            Upgrade to access your full audit trail, including actor attribution and CSV export.
          </p>
          <Link
            href="/dashboard"
            style={{
              display: "inline-block",
              marginTop: "16px",
              background: "rgba(0,196,180,0.15)",
              color: "#00c4b4",
              border: "1px solid rgba(0,196,180,0.4)",
              padding: "8px 20px",
              borderRadius: "8px",
              fontSize: "14px",
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            Return to Dashboard
          </Link>
        </div>
      </main>
    );
  }

  const activeResourceType = sp["resource_type"] ?? "";
  const cursor = sp["cursor"];

  const data = await getAuditLog(token, {
    resource_type: activeResourceType || undefined,
    cursor,
    limit: 100,
  });

  const events = data?.events ?? [];
  const nextCursor = data?.nextCursor ?? null;

  return (
    <main style={{ maxWidth: "64rem", margin: "0 auto", padding: "48px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "32px" }}>
        <div>
          <h1 style={{ color: "#f1f5f9", fontSize: "24px", fontWeight: 700, margin: 0 }}>
            Audit Log
          </h1>
          <p style={{ color: "#64748b", marginTop: "6px", fontSize: "14px" }}>
            A record of all security program activity in your organization.
          </p>
        </div>
        <a
          href="/api/export/audit-log"
          download
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            color: "#00c4b4",
            border: "1px solid rgba(0,196,180,0.4)",
            background: "transparent",
            padding: "8px 16px",
            borderRadius: "8px",
            fontSize: "13px",
            fontWeight: 500,
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          ↓ Export CSV
        </a>
      </div>

      {/* Filter pills */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "24px" }}>
        {RESOURCE_TYPE_FILTERS.map((f) => (
          <FilterPill
            key={f.value}
            label={f.label}
            href={filterHref(sp, "resource_type", f.value || null)}
            active={activeResourceType === f.value}
          />
        ))}
      </div>

      {/* Events list */}
      {events.length === 0 ? (
        <div
          style={{
            background: "#111827",
            border: "1px solid #1e293b",
            borderRadius: "12px",
            padding: "48px 32px",
            textAlign: "center",
          }}
        >
          <p style={{ color: "#94a3b8", fontSize: "15px", marginBottom: "8px" }}>
            No audit events recorded yet.
          </p>
          <p style={{ color: "#64748b", fontSize: "13px" }}>
            Activity will appear here as your team makes changes to the security program.
          </p>
        </div>
      ) : (
        <div style={{ borderTop: "1px solid #1e293b" }}>
          {events.map((event) => (
            <div
              key={event.id}
              style={{
                display: "grid",
                gridTemplateColumns: "140px 1fr 180px 160px",
                alignItems: "center",
                gap: "16px",
                padding: "12px 0",
                borderBottom: "1px solid #1e293b",
              }}
              className="audit-row"
            >
              <span style={{ color: "#64748b", fontSize: "11px", whiteSpace: "nowrap" }}>
                {formatTimestamp(event.created_at)}
              </span>
              <EventTypeBadge eventType={event.event_type} />
              <span style={{ color: "#cbd5e1", fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {resourceLabel(event)}
              </span>
              <span style={{ color: "#64748b", fontSize: "12px", textAlign: "right", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {actorLabel(event)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {nextCursor && (
        <div style={{ textAlign: "center", marginTop: "24px" }}>
          <Link
            href={filterHref(sp, "cursor", JSON.stringify(nextCursor))}
            style={{
              color: "#94a3b8",
              border: "1px solid #1e293b",
              background: "transparent",
              padding: "8px 24px",
              borderRadius: "8px",
              fontSize: "13px",
              textDecoration: "none",
            }}
          >
            Load more
          </Link>
        </div>
      )}
    </main>
  );
}
