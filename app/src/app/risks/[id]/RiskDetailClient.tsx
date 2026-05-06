"use client";

/**
 * RiskDetailClient — read-only detail view for a single risk.
 *
 * Sections (in order):
 *   1. Header — title + rating + status badges. Edit pencil HIDDEN per
 *      spec (edit page is a future package).
 *   2. Description block (if present).
 *   3. Metadata grid — Owner, Domain, Likelihood, Impact, Risk Rating,
 *      Status, Due Date, Created, Last Updated.
 *   4. Treatment Approach prose (risks.treatment free-form).
 *   5. Active Treatments — list of risk_treatments rows, read-only.
 *   6. Linked Findings — open findings with source_type='risk' and
 *      source_id=this risk's id. Title + severity per row.
 *
 * Treatment management UI (creating/editing/approving treatments) and
 * the edit risk form are explicitly out of scope for this package and
 * tracked as future work.
 */

import Link from "next/link";
import type { Risk, RiskScaleLevel, RiskTreatment, Finding } from "@/lib/api";

const FALLBACK_RATING_STYLES: Record<string, React.CSSProperties> = {
  Critical: { background: "rgba(239,68,68,0.15)",   color: "#fca5a5" },
  High:     { background: "rgba(249,115,22,0.15)",  color: "#fdba74" },
  Moderate: { background: "rgba(245,158,11,0.15)",  color: "#fcd34d" },
  Low:      { background: "rgba(34,197,94,0.15)",   color: "#86efac" },
};

const STATUS_STYLES: Record<string, React.CSSProperties> = {
  open:        { background: "rgba(239,68,68,0.12)",  color: "#fca5a5" },
  accepted:    { background: "rgba(245,158,11,0.12)", color: "#fcd34d" },
  mitigated:   { background: "rgba(34,197,94,0.12)",  color: "#86efac" },
  closed:      { background: "rgba(148,163,184,0.12)", color: "#94a3b8" },
  transferred: { background: "rgba(148,163,184,0.12)", color: "#94a3b8" },
};

const TREATMENT_STATUS_STYLES: Record<string, React.CSSProperties> = {
  not_started: { background: "rgba(148,163,184,0.12)", color: "#94a3b8" },
  in_progress: { background: "rgba(245,158,11,0.12)",  color: "#fcd34d" },
  mitigated:   { background: "rgba(34,197,94,0.12)",   color: "#86efac" },
  accepted:    { background: "rgba(245,158,11,0.12)",  color: "#fcd34d" },
  transferred: { background: "rgba(148,163,184,0.12)", color: "#94a3b8" },
};

function ratingStyleFromScale(value: string | null, scaleLevels: RiskScaleLevel[]): React.CSSProperties {
  if (!value) return { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  const v = value.toLowerCase();
  const level = scaleLevels.find((l) => l.value.toLowerCase() === v);
  if (level) return { background: `${level.color}26`, color: level.color };
  return FALLBACK_RATING_STYLES[value] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
}

function ratingLabel(value: string | null, scaleLevels: RiskScaleLevel[]): string {
  if (!value) return "—";
  const v = value.toLowerCase();
  const level = scaleLevels.find((l) => l.value.toLowerCase() === v);
  return level?.label ?? value;
}

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const CARD_STYLE: React.CSSProperties = {
  background: "var(--color-brand-surface, #111827)",
  border: "1px solid #1e293b",
  borderRadius: 12,
};

const SECTION_LABEL: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const PILL = "inline-flex items-center px-2 py-0.5 rounded text-xs";

export function RiskDetailClient({
  risk,
  treatments,
  findings,
  scaleLevels,
}: {
  risk: Risk;
  treatments: RiskTreatment[];
  findings: Finding[];
  scaleLevels: RiskScaleLevel[];
}) {
  const ratingStyle = ratingStyleFromScale(risk.risk_rating, scaleLevels);
  const statusStyle = STATUS_STYLES[risk.status] ?? { background: "rgba(148,163,184,0.12)", color: "#94a3b8" };

  const metadata: Array<{ label: string; value: string }> = [
    { label: "Owner",       value: risk.owner ?? "—" },
    { label: "Domain",      value: risk.domain ?? "—" },
    { label: "Likelihood",  value: risk.likelihood ? titleCase(risk.likelihood) : "—" },
    { label: "Impact",      value: risk.impact ? ratingLabel(risk.impact, scaleLevels) : "—" },
    { label: "Risk Rating", value: ratingLabel(risk.risk_rating, scaleLevels) },
    { label: "Status",      value: titleCase(risk.status) },
    { label: "Due Date",    value: fmtDate(risk.due_date) },
    { label: "Created",     value: fmtDate(risk.created_at) },
    { label: "Last Updated", value: fmtDate(risk.updated_at) },
  ];

  return (
    <>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className={`${PILL} font-semibold`} style={ratingStyle}>
              {ratingLabel(risk.risk_rating, scaleLevels)}
            </span>
            <span className={`${PILL} font-medium`} style={statusStyle}>
              {titleCase(risk.status)}
            </span>
            {risk.domain && (
              <span
                className={PILL}
                style={{ background: "rgba(148,163,184,0.1)", color: "#64748b" }}
              >
                {risk.domain}
              </span>
            )}
          </div>
          <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>
            {risk.title}
          </h1>
        </div>
      </div>

      {/* Description */}
      {risk.description && (
        <div className="mb-6 p-5" style={CARD_STYLE}>
          <p style={SECTION_LABEL} className="mb-2">Description</p>
          <p className="text-sm" style={{ color: "#cbd5e1", whiteSpace: "pre-wrap" }}>
            {risk.description}
          </p>
        </div>
      )}

      {/* Metadata grid */}
      <div className="mb-6 p-5" style={CARD_STYLE}>
        <p style={SECTION_LABEL} className="mb-3">Details</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {metadata.map(({ label, value }) => (
            <div key={label}>
              <p className="text-xs" style={{ color: "#64748b" }}>{label}</p>
              <p className="text-sm mt-0.5" style={{ color: "#cbd5e1" }}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Treatment Approach (free-form prose on risks.treatment) */}
      <div className="mb-6 p-5" style={CARD_STYLE}>
        <p style={SECTION_LABEL} className="mb-2">Treatment Approach</p>
        {risk.treatment ? (
          <p className="text-sm" style={{ color: "#cbd5e1", whiteSpace: "pre-wrap" }}>
            {risk.treatment}
          </p>
        ) : (
          <p className="text-sm" style={{ color: "#475569" }}>
            No treatment approach documented yet.
          </p>
        )}
      </div>

      {/* Active Treatments — risk_treatments rows */}
      <div id="treatments" className="mb-6 p-5" style={CARD_STYLE}>
        <div className="flex items-baseline justify-between mb-3">
          <p style={SECTION_LABEL}>Active Treatments</p>
          <span className="text-xs" style={{ color: "#64748b" }}>
            {treatments.length} {treatments.length === 1 ? "treatment" : "treatments"}
          </span>
        </div>
        {treatments.length === 0 ? (
          <p className="text-sm" style={{ color: "#475569" }}>
            No treatment workflow records have been created for this risk yet.
          </p>
        ) : (
          <ul className="space-y-2 list-none p-0 m-0">
            {treatments.map((t) => {
              const tStyle = TREATMENT_STATUS_STYLES[t.status] ?? { background: "rgba(148,163,184,0.12)", color: "#94a3b8" };
              return (
                <li
                  key={t.id}
                  className="rounded-lg p-3"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`${PILL} font-medium`} style={tStyle}>
                      {titleCase(t.status)}
                    </span>
                    {t.treatment_type && (
                      <span
                        className={PILL}
                        style={{ background: "rgba(148,163,184,0.1)", color: "#94a3b8" }}
                      >
                        {titleCase(t.treatment_type)}
                      </span>
                    )}
                    {t.due_date && (
                      <span className="text-xs" style={{ color: "#64748b" }}>
                        Due {fmtDate(t.due_date)}
                      </span>
                    )}
                    {t.owner && (
                      <span className="text-xs" style={{ color: "#64748b" }}>
                        · Owner: {t.owner}
                      </span>
                    )}
                  </div>
                  {t.summary && (
                    <p className="text-sm mt-1" style={{ color: "#cbd5e1" }}>
                      {t.summary}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Linked Findings */}
      <div className="mb-6 p-5" style={CARD_STYLE}>
        <div className="flex items-baseline justify-between mb-3">
          <p style={SECTION_LABEL}>Linked Findings</p>
          {findings.length > 0 && (
            <Link
              href={`/findings?source_type=risk&source_id=${risk.id}`}
              className="text-xs"
              style={{ color: "#00c4b4", textDecoration: "none" }}
            >
              View all →
            </Link>
          )}
        </div>
        {findings.length === 0 ? (
          <p className="text-sm" style={{ color: "#475569" }}>
            No open findings link to this risk.
          </p>
        ) : (
          <ul className="space-y-2 list-none p-0 m-0">
            {findings.map((f) => {
              const sevStyle = ratingStyleFromScale(f.severity ?? null, scaleLevels);
              return (
                <li
                  key={f.id}
                  className="flex items-center gap-3 rounded-lg p-2"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <span className={`${PILL} font-semibold flex-shrink-0`} style={sevStyle}>
                    {ratingLabel(f.severity ?? null, scaleLevels)}
                  </span>
                  <Link
                    href={`/findings/${f.id}`}
                    className="text-sm truncate"
                    style={{ color: "#f1f5f9", textDecoration: "none" }}
                  >
                    {f.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
