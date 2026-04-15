/**
 * SecureLogic AI — Operator Dashboard
 *
 * Standalone single-file React dashboard. Load via the companion HTML wrapper
 * (dashboard.html) which pulls React 18 from CDN and compiles this file with
 * Babel standalone, or bundle with: esbuild dashboard.jsx --bundle --outfile=dist/dashboard.js
 *
 * Configuration — edit the two fields below before use:
 */

const CONFIG = {
  apiBase: "/api",   // SecureLogic API base URL
  apiKey: "sl_a335d59064a56e79b457c1ee1be67dca",
};

// ─── Brand tokens ────────────────────────────────────────────────────────────
const C = {
  sidebar:       "#0a1628",
  sidebarBorder: "#1a2d4a",
  sidebarHover:  "#1a2d4a",
  accent:        "#00c4b4",
  accentDim:     "#009e91",
  bg:            "#f0f4f8",
  surface:       "#ffffff",
  border:        "#e2e8f0",
  text:          "#1e293b",
  textMuted:     "#64748b",
  textFaint:     "#94a3b8",
  danger:        "#dc2626",
  warn:          "#d97706",
  success:       "#16a34a",
  info:          "#2563eb",
};

const SOURCE_COLORS = {
  cisa_kev:        { bg: "#fef2f2", text: "#991b1b", dot: "#dc2626" },
  nvd:             { bg: "#fff7ed", text: "#92400e", dot: "#d97706" },
  cisa_alerts:     { bg: "#fefce8", text: "#854d0e", dot: "#ca8a04" },
  bleepingcomputer:{ bg: "#eff6ff", text: "#1e40af", dot: "#3b82f6" },
  krebsonsecurity: { bg: "#faf5ff", text: "#6b21a8", dot: "#9333ea" },
  sans_isc:        { bg: "#eef2ff", text: "#3730a3", dot: "#6366f1" },
  nist_news:       { bg: "#f0fdfa", text: "#134e4a", dot: "#14b8a6" },
  ftc_news:        { bg: "#f0fdf4", text: "#14532d", dot: "#22c55e" },
};

const SEV_COLORS = {
  Critical: { bg: "#fef2f2", text: "#991b1b", dot: "#dc2626" },
  High:     { bg: "#fff7ed", text: "#9a3412", dot: "#ea580c" },
  Moderate: { bg: "#fefce8", text: "#92400e", dot: "#d97706" },
  Low:      { bg: "#f0fdf4", text: "#166534", dot: "#22c55e" },
};

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${CONFIG.apiBase}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CONFIG.apiKey,
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || err.message || `HTTP ${res.status}`);
  }
  return res.json();
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ─── Reusable components ──────────────────────────────────────────────────────

function LoadingSpinner({ size = 20, color = C.accent }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: "32px" }}>
      <div style={{
        width: size, height: size,
        border: `2px solid ${color}33`,
        borderTop: `2px solid ${color}`,
        borderRadius: "50%",
        animation: "spin 0.7s linear infinite",
      }} />
    </div>
  );
}

function EmptyState({ icon = "○", title, subtitle }) {
  return (
    <div style={{ textAlign: "center", padding: "48px 24px", color: C.textFaint }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.textMuted, marginBottom: 4 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12 }}>{subtitle}</div>}
    </div>
  );
}

function SeverityBadge({ severity }) {
  const c = SEV_COLORS[severity] || { bg: "#f1f5f9", text: "#475569", dot: "#94a3b8" };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      background: c.bg, color: c.text,
      padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 700,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.dot }} />
      {severity || "—"}
    </span>
  );
}

function SourceBadge({ source }) {
  const c = SOURCE_COLORS[source] || { bg: "#f1f5f9", text: "#475569", dot: "#94a3b8" };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      background: c.bg, color: c.text,
      padding: "2px 8px", borderRadius: 12, fontSize: 10, fontWeight: 700,
      textTransform: "uppercase", letterSpacing: "0.04em",
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: c.dot }} />
      {source?.replace(/_/g, " ") || "—"}
    </span>
  );
}

function StatusBadge({ status }) {
  const map = {
    open:        { bg: "#eff6ff", text: "#1e40af" },
    in_progress: { bg: "#fefce8", text: "#854d0e" },
    resolved:    { bg: "#f0fdf4", text: "#166534" },
    closed:      { bg: "#f1f5f9", text: "#475569" },
    accepted:    { bg: "#faf5ff", text: "#6b21a8" },
    published:   { bg: "#f0fdf4", text: "#166534" },
    draft:       { bg: "#f8fafc", text: "#64748b" },
  };
  const c = map[status] || { bg: "#f1f5f9", text: "#475569" };
  return (
    <span style={{
      background: c.bg, color: c.text,
      padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600,
    }}>
      {status?.replace(/_/g, " ") || "—"}
    </span>
  );
}

function RelevanceBadge({ score }) {
  if (score == null) return null;
  const pct = Math.round(score * 100);
  const color = pct >= 70 ? C.success : pct >= 40 ? C.warn : C.textFaint;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color }}>
      {pct}% relevant
    </span>
  );
}

function Card({ children, style = {} }) {
  return (
    <div style={{
      background: C.surface, borderRadius: 10,
      border: `1px solid ${C.border}`,
      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      ...style,
    }}>
      {children}
    </div>
  );
}

function SectionHeader({ title, action }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
      <h2 style={{ margin: 0, fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted }}>
        {title}
      </h2>
      {action}
    </div>
  );
}

function Btn({ children, onClick, variant = "primary", disabled = false, small = false, style = {} }) {
  const base = {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: small ? "6px 12px" : "8px 16px",
    borderRadius: 7, fontSize: small ? 12 : 13, fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer", border: "none",
    opacity: disabled ? 0.5 : 1, transition: "background 0.15s",
    ...style,
  };
  const styles = {
    primary:  { ...base, background: C.accent, color: "#fff" },
    secondary:{ ...base, background: "#f1f5f9", color: C.text },
    danger:   { ...base, background: "#fef2f2", color: C.danger },
    ghost:    { ...base, background: "transparent", color: C.textMuted, padding: small ? "4px 8px" : "6px 12px" },
  };
  return <button style={styles[variant] || styles.primary} onClick={onClick} disabled={disabled}>{children}</button>;
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function ToastContainer({ toasts, dismiss }) {
  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8 }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          display: "flex", alignItems: "flex-start", gap: 10,
          background: t.type === "error" ? "#1a0000" : t.type === "success" ? "#001a0d" : "#0a1628",
          color: "#fff", borderRadius: 8, padding: "12px 16px", minWidth: 280, maxWidth: 420,
          boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
          borderLeft: `3px solid ${t.type === "error" ? C.danger : t.type === "success" ? C.success : C.accent}`,
          animation: "fadeInUp 0.2s ease",
        }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>
            {t.type === "error" ? "✕" : t.type === "success" ? "✓" : "ℹ"}
          </span>
          <span style={{ flex: 1, fontSize: 13, lineHeight: 1.4 }}>{t.message}</span>
          <button onClick={() => dismiss(t.id)} style={{ background: "none", border: "none", color: "#ffffff88", cursor: "pointer", fontSize: 16, padding: 0 }}>×</button>
        </div>
      ))}
    </div>
  );
}

function useToast() {
  const [toasts, setToasts] = React.useState([]);
  const add = React.useCallback((message, type = "info") => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);
  const dismiss = React.useCallback(id => setToasts(prev => prev.filter(t => t.id !== id)), []);
  return { toasts, toast: add, dismiss };
}

// ─── Sidebar Logo ─────────────────────────────────────────────────────────────

function SidebarLogo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "20px 20px 16px" }}>
      {/* Circuit-S SVG icon */}
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="32" height="32" rx="7" fill={C.accent} fillOpacity="0.15"/>
        <path d="M10 10h4v2h-2v2H10V10zm8 0h4v4h-2v-2h-2V10zM10 20h2v-2h2v-2h-4v4zm10 0v-4h-2v2h-2v2h4z" fill={C.accent}/>
        <path d="M12 14h2v2h-2v-2zm4 0h2v2h-2v-2zm2 2h2v2h-2v-2zm-8 0h2v2H8v-2z" fill={C.accent} fillOpacity="0.6"/>
        <rect x="14" y="14" width="4" height="4" rx="1" fill={C.accent}/>
      </svg>
      {/* Wordmark */}
      <div style={{ lineHeight: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-0.01em" }}>
          <span style={{ color: "#ffffff" }}>Secure</span>
          <span style={{ color: C.accent }}>Logic</span>
          <sup style={{ color: C.accent, fontSize: 9, fontWeight: 900, verticalAlign: "super", marginLeft: 1 }}>AI</sup>
        </div>
        <div style={{ fontSize: 10, color: "#ffffff44", fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 2 }}>
          Security Intelligence
        </div>
      </div>
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { id: "overview",  label: "Overview",          icon: "◉" },
  { id: "briefs",    label: "Intelligence Brief", icon: "◈" },
  { id: "signals",   label: "Risk & Signals",     icon: "◎" },
  { id: "settings",  label: "Settings",           icon: "⚙" },
];

function Sidebar({ active, onNav }) {
  return (
    <nav style={{
      position: "fixed", top: 0, left: 0, bottom: 0, width: 220,
      background: C.sidebar, display: "flex", flexDirection: "column",
      borderRight: `1px solid ${C.sidebarBorder}`, zIndex: 100,
    }}>
      <SidebarLogo />

      <div style={{ height: 1, background: C.sidebarBorder, margin: "0 16px 12px" }} />

      <div style={{ flex: 1, padding: "0 10px" }}>
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            onClick={() => onNav(item.id)}
            style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%",
              padding: "9px 12px", border: "none", borderRadius: 7, cursor: "pointer",
              background: active === item.id ? `${C.accent}20` : "transparent",
              color: active === item.id ? C.accent : "#ffffffaa",
              fontSize: 13, fontWeight: active === item.id ? 700 : 500,
              marginBottom: 2, textAlign: "left", transition: "all 0.15s",
            }}
          >
            <span style={{ fontSize: 14, width: 18, textAlign: "center" }}>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>

      <div style={{ padding: "12px 20px", borderTop: `1px solid ${C.sidebarBorder}` }}>
        <div style={{ fontSize: 10, color: "#ffffff33", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          v2.0 · Platform
        </div>
      </div>
    </nav>
  );
}

// ─── Stat tile ────────────────────────────────────────────────────────────────

function StatTile({ label, value, sub, accent = false }) {
  return (
    <Card style={{ padding: "18px 20px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: accent ? C.accent : C.text, lineHeight: 1 }}>{value ?? "—"}</div>
      {sub && <div style={{ fontSize: 11, color: C.textFaint, marginTop: 6 }}>{sub}</div>}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VIEW: Overview
// ─────────────────────────────────────────────────────────────────────────────

function OverviewView({ toast }) {
  const [summary, setSummary] = React.useState(null);
  const [dashboard, setDashboard] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch("/intelligence/summary", { method: "POST", body: JSON.stringify({}) }).catch(() => null),
      apiFetch("/dashboard/summary").catch(() => null),
    ])
      .then(([s, d]) => { setSummary(s); setDashboard(d); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner />;
  if (error) return <EmptyState icon="⚠" title="Failed to load overview" subtitle={error} />;

  const posture = dashboard?.posture;
  const findings = dashboard?.findings;
  const actions = dashboard?.actions;
  const inventory = dashboard?.inventory;

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.text }}>Security Posture Overview</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: C.textMuted }}>Platform-wide risk and posture snapshot</p>
      </div>

      {/* Intelligence summary callout */}
      {summary && (
        <Card style={{ padding: "20px 24px", marginBottom: 24, borderLeft: `4px solid ${C.accent}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.accent, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
            Intelligence Summary
          </div>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: C.text }}>
            {summary.executive_summary || summary.summary || "No summary available."}
          </p>
          {summary.signal_count != null && (
            <div style={{ marginTop: 10, fontSize: 12, color: C.textMuted }}>
              Based on {summary.signal_count} signals · Generated {fmtDateTime(summary.generated_at)}
            </div>
          )}
        </Card>
      )}

      {/* Posture stats row */}
      {dashboard ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 24 }}>
            <StatTile
              label="Posture Score"
              value={posture?.overall_score ?? "—"}
              sub={posture?.overall_severity ? `Severity: ${posture.overall_severity}` : "No snapshot"}
              accent={!!posture?.overall_score}
            />
            <StatTile label="Open Findings" value={findings?.open ?? "—"} sub={findings?.open > 0 ? `${findings.by_severity?.Critical || 0} Critical` : "None open"} />
            <StatTile label="Open Actions" value={actions?.open ?? "—"} sub={actions?.overdue > 0 ? `${actions.overdue} overdue` : "None overdue"} />
            <StatTile label="Vendors" value={inventory?.vendors ?? "—"} />
            <StatTile label="AI Systems" value={inventory?.ai_systems ?? "—"} />
            <StatTile label="Controls" value={inventory?.controls ?? "—"} />
          </div>

          {/* Domain breakdown */}
          {dashboard.domains?.length > 0 && (
            <Card style={{ padding: "20px 24px" }}>
              <SectionHeader title="Domain Breakdown" />
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {dashboard.domains.map(d => {
                  const sc = SEV_COLORS[d.severity] || { bar: "#cbd5e1" };
                  const score = d.score ?? 0;
                  return (
                    <div key={d.domain}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{d.domain}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {d.severity && <SeverityBadge severity={d.severity} />}
                          <span style={{ fontSize: 12, color: C.textMuted, width: 28, textAlign: "right" }}>{score}</span>
                        </div>
                      </div>
                      <div style={{ height: 6, background: "#f1f5f9", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ height: "100%", borderRadius: 3, background: sc.dot || C.accent, width: `${Math.min(score, 100)}%`, transition: "width 0.5s ease" }} />
                      </div>
                      {(d.finding_count > 0 || d.action_count > 0) && (
                        <div style={{ fontSize: 11, color: C.textFaint, marginTop: 3 }}>
                          {d.finding_count > 0 && `${d.finding_count} finding${d.finding_count !== 1 ? "s" : ""}`}
                          {d.finding_count > 0 && d.action_count > 0 && " · "}
                          {d.action_count > 0 && `${d.action_count} action${d.action_count !== 1 ? "s" : ""}`}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </>
      ) : (
        <EmptyState icon="◎" title="No posture data available" subtitle="Run an assessment or create a posture snapshot to populate this view." />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VIEW: Intelligence Brief
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_LABELS = {
  vulnerability:  "Vulnerabilities",
  threat_actor:   "Threat Actors & Campaigns",
  vendor_incident:"Vendor Incidents",
  regulatory:     "Regulatory & Compliance",
  general:        "General Intelligence",
};

function BriefList({ briefs, selectedId, onSelect }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {briefs.map(b => (
        <button
          key={b.id}
          type="button"
          onClick={() => { console.log("[BriefList] Selected ID:", b.id); onSelect(b.id); }}
          style={{
            background: selectedId === b.id ? `${C.accent}15` : "transparent",
            border: `1px solid ${selectedId === b.id ? C.accent : C.border}`,
            borderRadius: 8, padding: "12px 14px", textAlign: "left", cursor: "pointer", width: "100%",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: selectedId === b.id ? C.accent : C.text, marginBottom: 2 }}>
            {b.title || `Brief — ${fmtDate(b.generated_at || b.created_at)}`}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <StatusBadge status={b.status} />
            <span style={{ fontSize: 11, color: C.textFaint }}>{fmtDate(b.generated_at || b.created_at)}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function BriefDetailSection({ title, items, accentColor, borderColor }) {
  if (!items?.length) return null;
  return (
    <div style={{ marginBottom: 16, borderLeft: `3px solid ${borderColor || "#e2e8f0"}`, paddingLeft: 12, background: `${accentColor}08`, borderRadius: "0 6px 6px 0", padding: "10px 12px" }}>
      <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: accentColor, marginBottom: 8 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 14 }}>
        {items.map((item, i) => (
          <li key={i} style={{ fontSize: 13, color: C.text, marginBottom: 4, lineHeight: 1.5 }}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

// Normalize a field that may be a string, array, or null into string[] | null.
// Strings are split on newlines and stripped of leading "1. " numbering.
function toStringArray(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value.length > 0 ? value.map(String).filter(Boolean) : null;
  if (typeof value === "string" && value.trim().length > 0) {
    const lines = value.split("\n").map(s => s.replace(/^\d+\.\s*/, "").trim()).filter(Boolean);
    return lines.length > 0 ? lines : null;
  }
  return null;
}

function BriefItemCard({ item }) {
  // Normalize relevance: API sends item.relevance (string "High"/"Medium"/"Low")
  // or item.relevance_score (float 0-1). Convert string to approximate float.
  const RELEVANCE_MAP = { critical: 1.0, high: 0.85, medium: 0.55, low: 0.25 };
  const relevanceScore =
    typeof item.relevance_score === "number"
      ? item.relevance_score
      : typeof item.relevance === "string"
        ? (RELEVANCE_MAP[item.relevance.toLowerCase()] ?? null)
        : null;

  const isPersonalized = item.is_personalized || relevanceScore >= 0.7;

  // API sends item.summary; legacy/other sources may send item.body
  const bodyText = item.body || item.summary || null;

  // API sends item.source_slug; legacy may send item.source
  const sourceSlug = item.source_slug || item.source || null;

  // Normalize recommended_actions: may be a string or array
  const recommendedActions =
    toStringArray(item.recommended_actions) ||
    toStringArray(item.recommended_action);

  return (
    <Card style={{ padding: "16px 18px", marginBottom: 10 }}>
      {isPersonalized && (
        <div style={{
          display: "inline-block", fontSize: 9, fontWeight: 800, letterSpacing: "0.1em",
          textTransform: "uppercase", color: "#1e40af", background: "#eff6ff",
          padding: "2px 8px", borderRadius: 10, marginBottom: 8, border: "1px solid #bfdbfe",
        }}>
          Relevant to your org
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text, lineHeight: 1.4 }}>{item.headline || item.title}</h4>
        <div style={{ display: "flex", gap: 5, flexShrink: 0, flexWrap: "wrap" }}>
          {item.severity && <SeverityBadge severity={item.severity} />}
          {relevanceScore != null && <RelevanceBadge score={relevanceScore} />}
        </div>
      </div>
      {bodyText && (
        <p style={{ margin: "0 0 10px", fontSize: 13, color: C.textMuted, lineHeight: 1.6 }}>{bodyText}</p>
      )}
      <BriefDetailSection
        title="Why It Matters"
        items={item.why_it_matters ? [item.why_it_matters] : null}
        accentColor="#d97706"
        borderColor="#fbbf24"
      />
      <BriefDetailSection
        title="Recommended Actions"
        items={recommendedActions}
        accentColor="#15803d"
        borderColor="#22c55e"
      />
      {item.affected_cve && (
        <div style={{ marginTop: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.textFaint }}>CVE: </span>
          <span style={{ fontSize: 11, fontFamily: "monospace", color: C.textMuted }}>{item.affected_cve}</span>
        </div>
      )}
      {sourceSlug && (
        <div style={{ marginTop: 6 }}>
          <SourceBadge source={sourceSlug} />
        </div>
      )}
    </Card>
  );
}

function BriefsView({ toast }) {
  const [briefs, setBriefs] = React.useState([]);
  const [selectedId, setSelectedId] = React.useState(null);
  const [detail, setDetail] = React.useState(null);
  const [loadingList, setLoadingList] = React.useState(true);
  const [loadingDetail, setLoadingDetail] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [errorList, setErrorList] = React.useState(null);

  React.useEffect(() => {
    setLoadingList(true);
    apiFetch("/intelligence-briefs?limit=20")
      .then(data => {
        const list = data.briefs || data.items || data || [];
        setBriefs(Array.isArray(list) ? list : []);
        if (list.length > 0) setSelectedId(list[0].id);
      })
      .catch(e => setErrorList(e.message))
      .finally(() => setLoadingList(false));
  }, []);

  React.useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setLoadingDetail(true);
    setDetail(null);
    console.log("[BriefsView] Fetching detail for ID:", selectedId);
    apiFetch(`/intelligence-briefs/${selectedId}`)
      .then(d => {
        if (cancelled) return;
        console.log("[BriefsView] Detail received for ID:", selectedId, d);
        setDetail(d.brief || d);
      })
      .catch(e => { if (!cancelled) toast(e.message, "error"); })
      .finally(() => { if (!cancelled) setLoadingDetail(false); });
    return () => { cancelled = true; };
  }, [selectedId, toast]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const r = await apiFetch("/intelligence-briefs/generate", { method: "POST", body: JSON.stringify({}) });
      toast("Brief generation started", "success");
      // Refresh list
      const data = await apiFetch("/intelligence-briefs?limit=20");
      const list = data.briefs || data.items || data || [];
      setBriefs(Array.isArray(list) ? list : []);
      if (list.length > 0) setSelectedId(list[0].id);
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setGenerating(false);
    }
  };

  const groupedItems = React.useMemo(() => {
    if (!detail?.items) return {};
    const groups = {};
    for (const item of detail.items) {
      const cat = item.category || "general";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    }
    return groups;
  }, [detail]);

  const CATEGORY_ORDER = ["vulnerability", "threat_actor", "vendor_incident", "regulatory", "general"];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.text }}>Intelligence Briefs</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: C.textMuted }}>Weekly executive threat and regulatory intelligence</p>
        </div>
        <Btn onClick={handleGenerate} disabled={generating}>
          {generating ? "Generating…" : "+ Generate Brief"}
        </Btn>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 20, alignItems: "start" }}>
        {/* Left panel — brief list */}
        <div>
          <Card style={{ padding: "14px 12px" }}>
            {loadingList ? (
              <LoadingSpinner size={16} />
            ) : errorList ? (
              <EmptyState icon="⚠" title="Load error" subtitle={errorList} />
            ) : briefs.length === 0 ? (
              <EmptyState icon="◈" title="No briefs yet" subtitle="Generate your first brief above." />
            ) : (
              <BriefList briefs={briefs} selectedId={selectedId} onSelect={setSelectedId} />
            )}
          </Card>
        </div>

        {/* Right panel — brief detail */}
        <div>
          {loadingDetail ? (
            <LoadingSpinner />
          ) : !detail ? (
            <EmptyState icon="◈" title="Select a brief" subtitle="Choose a brief from the list." />
          ) : (
            <div>
              {/* Brief header */}
              <Card style={{ padding: "20px 24px", marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                      <StatusBadge status={detail.status} />
                      <span style={{ fontSize: 12, color: C.textFaint }}>{fmtDate(detail.generated_at || detail.created_at)}</span>
                    </div>
                    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.text }}>
                      {detail.title || `Intelligence Brief — ${fmtDate(detail.generated_at || detail.created_at)}`}
                    </h2>
                  </div>
                  {detail.items?.filter(i => i.is_personalized || i.relevance_score >= 0.7).length > 0 && (
                    <div style={{ background: "#1e40af", color: "#fff", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 700 }}>
                      {detail.items.filter(i => i.is_personalized || i.relevance_score >= 0.7).length} relevant to your org
                    </div>
                  )}
                </div>
                {detail.executive_summary && (
                  <p style={{ margin: "14px 0 0", fontSize: 14, lineHeight: 1.7, color: C.textMuted, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
                    {detail.executive_summary}
                  </p>
                )}
              </Card>

              {/* Items grouped by category */}
              {!detail.items?.length ? (
                <Card style={{ padding: "40px 24px" }}>
                  <EmptyState icon="◈" title="No items in this brief" subtitle="Items are populated during brief generation. Try regenerating or check the pipeline." />
                </Card>
              ) : (
                CATEGORY_ORDER.map(cat => {
                  const items = groupedItems[cat];
                  if (!items?.length) return null;
                  return (
                    <div key={cat} style={{ marginBottom: 24 }}>
                      <div style={{
                        fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em",
                        color: C.textMuted, marginBottom: 12, paddingBottom: 6,
                        borderBottom: `2px solid ${cat === "vulnerability" ? "#dc2626" : cat === "threat_actor" ? "#9333ea" : cat === "vendor_incident" ? "#2563eb" : cat === "regulatory" ? "#0891b2" : "#94a3b8"}`,
                      }}>
                        {CATEGORY_LABELS[cat] || cat}
                      </div>
                      {items.map((item, i) => <BriefItemCard key={item.id || i} item={item} />)}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VIEW: Risk & Signals
// ─────────────────────────────────────────────────────────────────────────────

const FETCH_SOURCES = [
  { label: "CISA KEV",          action: () => apiFetch("/cyber-signals/fetch/cisa-kev", { method: "POST", body: JSON.stringify({}) }) },
  { label: "NVD CVEs",          action: () => apiFetch("/cyber-signals/fetch/nvd", { method: "POST", body: JSON.stringify({}) }) },
  { label: "CISA Alerts",       action: () => apiFetch("/cyber-signals/fetch/cisa-alerts", { method: "POST", body: JSON.stringify({}) }) },
  { label: "Threat Intel RSS",  action: () => apiFetch("/cyber-signals/fetch/threat-intel-rss", { method: "POST", body: JSON.stringify({}) }) },
  { label: "Regulatory Feeds",  action: () => apiFetch("/cyber-signals/fetch/regulatory", { method: "POST", body: JSON.stringify({}) }) },
];

function RisksTable({ risks }) {
  if (!risks.length) return <EmptyState icon="◎" title="No risks found" subtitle="Create risks via the API or adjust filters." />;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${C.border}` }}>
            {["Title", "Severity", "Status", "Score", "Domain", "Created"].map(h => (
              <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {risks.map((r, i) => (
            <tr key={r.id} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 === 0 ? "transparent" : "#f8fafc" }}>
              <td style={{ padding: "10px 12px", fontWeight: 600, color: C.text, maxWidth: 280 }}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</div>
                {r.description && <div style={{ fontSize: 11, color: C.textFaint, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.description}</div>}
              </td>
              <td style={{ padding: "10px 12px" }}><SeverityBadge severity={r.severity} /></td>
              <td style={{ padding: "10px 12px" }}><StatusBadge status={r.status} /></td>
              <td style={{ padding: "10px 12px", fontWeight: 700, color: r.risk_score >= 7 ? C.danger : r.risk_score >= 4 ? C.warn : C.success }}>
                {r.risk_score ?? "—"}
              </td>
              <td style={{ padding: "10px 12px", color: C.textMuted }}>{r.domain || "—"}</td>
              <td style={{ padding: "10px 12px", color: C.textFaint, whiteSpace: "nowrap" }}>{fmtDate(r.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SignalsTable({ signals }) {
  if (!signals.length) return <EmptyState icon="◎" title="No signals found" subtitle="Fetch signals from sources above, or adjust filters." />;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${C.border}` }}>
            {["Summary", "Severity", "Source", "Type", "CVE", "Ingested"].map(h => (
              <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {signals.map((s, i) => (
            <tr key={s.id} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 === 0 ? "transparent" : "#f8fafc" }}>
              <td style={{ padding: "10px 12px", maxWidth: 340 }}>
                <div style={{ fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.normalized_summary || s.raw_payload?.title || s.id}
                </div>
                {s.affected_vendor && <div style={{ fontSize: 11, color: C.textFaint, marginTop: 2 }}>{s.affected_vendor}</div>}
              </td>
              <td style={{ padding: "10px 12px" }}><SeverityBadge severity={s.severity} /></td>
              <td style={{ padding: "10px 12px" }}><SourceBadge source={s.source} /></td>
              <td style={{ padding: "10px 12px", color: C.textMuted, fontSize: 11 }}>{s.signal_type?.replace(/_/g, " ") || "—"}</td>
              <td style={{ padding: "10px 12px", fontFamily: "monospace", fontSize: 11, color: C.textMuted }}>{s.affected_cve || "—"}</td>
              <td style={{ padding: "10px 12px", color: C.textFaint, whiteSpace: "nowrap" }}>{fmtDateTime(s.ingested_at || s.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SignalsView({ toast }) {
  const [tab, setTab] = React.useState("signals");
  const [risks, setRisks] = React.useState([]);
  const [signals, setSignals] = React.useState([]);
  const [loadingRisks, setLoadingRisks] = React.useState(false);
  const [loadingSignals, setLoadingSignals] = React.useState(false);
  const [fetchingSource, setFetchingSource] = React.useState(null);
  const [showFetchMenu, setShowFetchMenu] = React.useState(false);
  const [riskPage, setRiskPage] = React.useState(1);
  const [signalPage, setSignalPage] = React.useState(1);
  const [sigFilter, setSigFilter] = React.useState({ severity: "", source: "" });
  const PAGE_SIZE = 25;

  // Load risks
  const loadRisks = React.useCallback(() => {
    setLoadingRisks(true);
    apiFetch(`/risks?limit=${PAGE_SIZE}&offset=${(riskPage - 1) * PAGE_SIZE}`)
      .then(d => setRisks(d.risks || d.items || d || []))
      .catch(e => toast(e.message, "error"))
      .finally(() => setLoadingRisks(false));
  }, [riskPage]);

  // Load signals
  const loadSignals = React.useCallback(() => {
    setLoadingSignals(true);
    const params = new URLSearchParams({ limit: PAGE_SIZE, offset: (signalPage - 1) * PAGE_SIZE });
    if (sigFilter.severity) params.set("severity", sigFilter.severity);
    if (sigFilter.source) params.set("source", sigFilter.source);
    apiFetch(`/cyber-signals?${params}`)
      .then(d => setSignals(d.signals || d.items || d || []))
      .catch(e => toast(e.message, "error"))
      .finally(() => setLoadingSignals(false));
  }, [signalPage, sigFilter]);

  React.useEffect(() => { if (tab === "risks") loadRisks(); }, [tab, loadRisks]);
  React.useEffect(() => { if (tab === "signals") loadSignals(); }, [tab, loadSignals]);

  const handleFetch = async (src) => {
    setFetchingSource(src.label);
    setShowFetchMenu(false);
    try {
      const r = await src.action();
      const inserted = r.inserted ?? r.processed ?? r.count ?? "?";
      const skipped = r.skipped ?? "";
      toast(`${src.label}: ${inserted} signals ingested${skipped ? `, ${skipped} skipped` : ""}`, "success");
      if (tab === "signals") loadSignals();
    } catch (e) {
      toast(`${src.label}: ${e.message}`, "error");
    } finally {
      setFetchingSource(null);
    }
  };

  const tabStyle = (id) => ({
    padding: "8px 16px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, borderRadius: 7,
    background: tab === id ? C.accent : "transparent",
    color: tab === id ? "#fff" : C.textMuted,
    transition: "all 0.15s",
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.text }}>Risk & Signals</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: C.textMuted }}>Enterprise risks and real-time cyber signal feed</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Fetch signals dropdown */}
          <div style={{ position: "relative" }}>
            <Btn
              onClick={() => setShowFetchMenu(m => !m)}
              variant="secondary"
              disabled={!!fetchingSource}
            >
              {fetchingSource ? `Fetching ${fetchingSource}…` : "⬇ Fetch Signals ▾"}
            </Btn>
            {showFetchMenu && (
              <div style={{
                position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 200,
                background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
                boxShadow: "0 8px 24px rgba(0,0,0,0.12)", minWidth: 200, overflow: "hidden",
              }}>
                {FETCH_SOURCES.map(src => (
                  <button key={src.label} onClick={() => handleFetch(src)} style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "10px 16px", background: "none", border: "none",
                    cursor: "pointer", fontSize: 13, color: C.text,
                    borderBottom: `1px solid ${C.border}`,
                  }}
                  onMouseEnter={e => e.target.style.background = "#f8fafc"}
                  onMouseLeave={e => e.target.style.background = "none"}
                  >
                    {src.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Btn onClick={() => tab === "risks" ? loadRisks() : loadSignals()} variant="ghost" small>↻ Refresh</Btn>
        </div>
      </div>

      {/* Tab switcher */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "#f1f5f9", padding: 4, borderRadius: 10, width: "fit-content" }}>
        <button style={tabStyle("signals")} onClick={() => setTab("signals")}>Cyber Signals</button>
        <button style={tabStyle("risks")} onClick={() => setTab("risks")}>Risks</button>
      </div>

      {tab === "signals" && (
        <div>
          {/* Filters */}
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <select
              value={sigFilter.severity}
              onChange={e => { setSigFilter(f => ({ ...f, severity: e.target.value })); setSignalPage(1); }}
              style={{ padding: "7px 12px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, background: C.surface, color: C.text }}
            >
              <option value="">All Severities</option>
              {["Critical", "High", "Moderate", "Low"].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select
              value={sigFilter.source}
              onChange={e => { setSigFilter(f => ({ ...f, source: e.target.value })); setSignalPage(1); }}
              style={{ padding: "7px 12px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, background: C.surface, color: C.text }}
            >
              <option value="">All Sources</option>
              {Object.keys(SOURCE_COLORS).map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
            </select>
          </div>

          <Card>
            {loadingSignals ? <LoadingSpinner /> : <SignalsTable signals={signals} />}
          </Card>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
            <span style={{ fontSize: 12, color: C.textFaint }}>Page {signalPage}</span>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn onClick={() => setSignalPage(p => Math.max(1, p - 1))} disabled={signalPage === 1} variant="secondary" small>← Prev</Btn>
              <Btn onClick={() => setSignalPage(p => p + 1)} disabled={signals.length < PAGE_SIZE} variant="secondary" small>Next →</Btn>
            </div>
          </div>
        </div>
      )}

      {tab === "risks" && (
        <div>
          <Card>
            {loadingRisks ? <LoadingSpinner /> : <RisksTable risks={risks} />}
          </Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
            <span style={{ fontSize: 12, color: C.textFaint }}>Page {riskPage}</span>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn onClick={() => setRiskPage(p => Math.max(1, p - 1))} disabled={riskPage === 1} variant="secondary" small>← Prev</Btn>
              <Btn onClick={() => setRiskPage(p => p + 1)} disabled={risks.length < PAGE_SIZE} variant="secondary" small>Next →</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VIEW: Settings
// ─────────────────────────────────────────────────────────────────────────────

function SettingsSection({ title, children }) {
  return (
    <Card style={{ padding: "20px 24px", marginBottom: 20 }}>
      <h3 style={{ margin: "0 0 16px", fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: C.textMuted }}>{title}</h3>
      {children}
    </Card>
  );
}

function SettingsRow({ label, sub, children }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{label}</div>
        {sub && <div style={{ fontSize: 12, color: C.textFaint, marginTop: 2 }}>{sub}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function SettingsView({ toast }) {
  const [me, setMe] = React.useState(null);
  const [subscribers, setSubscribers] = React.useState([]);
  const [loadingMe, setLoadingMe] = React.useState(true);
  const [loadingSubs, setLoadingSubs] = React.useState(true);
  const [pipelineSecret, setPipelineSecret] = React.useState("");
  const [runningPipeline, setRunningPipeline] = React.useState(false);
  const [configVisible, setConfigVisible] = React.useState(false);

  React.useEffect(() => {
    apiFetch("/account")
      .then(d => setMe(d.account || d))
      .catch(() => {})
      .finally(() => setLoadingMe(false));
    apiFetch("/subscribers?limit=50")
      .then(d => setSubscribers(d.subscribers || d.items || d || []))
      .catch(() => {})
      .finally(() => setLoadingSubs(false));
  }, []);

  const handleRunPipeline = async () => {
    if (!pipelineSecret) { toast("Enter SCHEDULER_SECRET", "error"); return; }
    setRunningPipeline(true);
    try {
      const r = await fetch(`${CONFIG.apiBase}/scheduler/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-scheduler-secret": pipelineSecret },
        body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      toast(`Pipeline complete — ${data.signals_fetched?.total ?? "?"} signals, ${data.briefs_generated ?? "?"} briefs`, "success");
    } catch (e) {
      toast(`Pipeline error: ${e.message}`, "error");
    } finally {
      setRunningPipeline(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.text }}>Settings</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: C.textMuted }}>Platform configuration and pipeline controls</p>
      </div>

      {/* Account */}
      <SettingsSection title="Account">
        {loadingMe ? <LoadingSpinner size={16} /> : me ? (
          <>
            <SettingsRow label="Organization" sub="Registered organization name">
              <span style={{ fontSize: 13, color: C.textMuted }}>{me.organization_name || me.organizationName || "—"}</span>
            </SettingsRow>
            <SettingsRow label="Plan / Entitlement" sub="Current subscription tier">
              <StatusBadge status={me.entitlement_level || me.entitlementLevel || "starter"} />
            </SettingsRow>
            <SettingsRow label="API Key" sub="Used in CONFIG.apiKey at top of this file">
              <span style={{ fontSize: 12, fontFamily: "monospace", color: C.textFaint }}>••••••••{CONFIG.apiKey.slice(-6)}</span>
            </SettingsRow>
          </>
        ) : (
          <EmptyState icon="⚠" title="Account data unavailable" subtitle="Check API key and base URL in CONFIG." />
        )}
      </SettingsSection>

      {/* Subscribers */}
      <SettingsSection title={`Subscribers (${loadingSubs ? "…" : subscribers.length})`}>
        {loadingSubs ? <LoadingSpinner size={16} /> : subscribers.length === 0 ? (
          <EmptyState icon="○" title="No subscribers" subtitle="Add subscribers via POST /api/subscribers" />
        ) : (
          <div style={{ maxHeight: 240, overflowY: "auto" }}>
            {subscribers.map(s => (
              <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{s.email}</div>
                  <div style={{ fontSize: 11, color: C.textFaint }}>{s.organization_name || "—"}</div>
                </div>
                <StatusBadge status={s.status || "active"} />
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      {/* Signal sources */}
      <SettingsSection title="Signal Sources">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
          {Object.entries(SOURCE_COLORS).map(([src, c]) => (
            <div key={src} style={{
              display: "flex", alignItems: "center", gap: 8, padding: "10px 12px",
              background: c.bg, borderRadius: 7, border: `1px solid ${c.dot}33`,
            }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: c.dot, flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: c.text }}>{src.replace(/_/g, " ")}</span>
              <span style={{ marginLeft: "auto", fontSize: 10, color: c.dot, fontWeight: 700 }}>ACTIVE</span>
            </div>
          ))}
        </div>
      </SettingsSection>

      {/* Pipeline controls */}
      <SettingsSection title="Pipeline Controls">
        <div style={{ marginBottom: 16, padding: "12px 14px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 7 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e", marginBottom: 4 }}>Full Pipeline Run</div>
          <div style={{ fontSize: 12, color: "#a16207" }}>
            Runs all 5 signal fetchers, normalizes signals, and generates Intelligence Briefs for all active orgs.
            Requires SCHEDULER_SECRET.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            type="password"
            placeholder="SCHEDULER_SECRET"
            value={pipelineSecret}
            onChange={e => setPipelineSecret(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleRunPipeline()}
            style={{
              flex: 1, padding: "9px 12px", borderRadius: 7, border: `1px solid ${C.border}`,
              fontSize: 13, background: C.surface, color: C.text, maxWidth: 320,
            }}
          />
          <Btn onClick={handleRunPipeline} disabled={runningPipeline || !pipelineSecret}>
            {runningPipeline ? "Running…" : "▶ Run Full Pipeline"}
          </Btn>
        </div>

        <div style={{ marginTop: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Dashboard Config</span>
            <Btn onClick={() => setConfigVisible(v => !v)} variant="ghost" small>
              {configVisible ? "Hide" : "Show"} CONFIG
            </Btn>
          </div>
          {configVisible && (
            <pre style={{
              background: C.sidebar, color: C.accent, borderRadius: 8, padding: "14px 16px",
              fontSize: 12, fontFamily: "monospace", margin: 0, overflowX: "auto",
              border: `1px solid ${C.sidebarBorder}`,
            }}>
{`const CONFIG = {
  apiBase: "${CONFIG.apiBase}",
  apiKey: "sl_a335d59064a56e79b457c1ee1be67dca",
};`}
            </pre>
          )}
        </div>
      </SettingsSection>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root App
// ─────────────────────────────────────────────────────────────────────────────

function App() {
  const [view, setView] = React.useState("overview");
  const { toasts, toast, dismiss } = useToast();

  const renderView = () => {
    switch (view) {
      case "overview": return <OverviewView toast={toast} />;
      case "briefs":   return <BriefsView toast={toast} />;
      case "signals":  return <SignalsView toast={toast} />;
      case "settings": return <SettingsView toast={toast} />;
      default:         return <OverviewView toast={toast} />;
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
        select:focus, input:focus { outline: 2px solid #00c4b4; outline-offset: 1px; }
      `}</style>

      <Sidebar active={view} onNav={setView} />

      <main style={{ marginLeft: 220, minHeight: "100vh", padding: "32px 36px" }}>
        <div style={{ maxWidth: 1100 }}>
          {renderView()}
        </div>
      </main>

      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </div>
  );
}

// ─── Mount ────────────────────────────────────────────────────────────────────

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
