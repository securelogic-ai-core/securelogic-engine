import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { getIntelligenceBrief } from "@/lib/api";
import type {
  IntelligenceBriefDetailResponse,
  IntelligenceBriefItem,
  IntelligenceBriefUrgency,
} from "@/lib/api";

interface Props {
  params: Promise<{ id: string; index: string }>;
}

// ---------------------------------------------------------------------------
// Visual mappings — kept in lockstep with IntelligenceBriefSignalCard.tsx
// ---------------------------------------------------------------------------

const URGENCY_BAND_BG: Record<IntelligenceBriefUrgency, string> = {
  immediate: "bg-red-600",
  near_term: "bg-orange-500",
  far_term: "bg-slate-700",
};

const URGENCY_BAND_LABEL: Record<IntelligenceBriefUrgency, string> = {
  immediate: "IMMEDIATE",
  near_term: "NEAR TERM",
  far_term: "FAR TERM",
};

function urgencyBg(urgency: IntelligenceBriefUrgency | null): string {
  if (urgency === null) return "bg-slate-700";
  return URGENCY_BAND_BG[urgency];
}

function urgencyLabel(urgency: IntelligenceBriefUrgency | null): string {
  if (urgency === null) return "UNCLASSIFIED";
  return URGENCY_BAND_LABEL[urgency];
}

const CATEGORY_LABELS: Record<string, string> = {
  vulnerability: "Vulnerability",
  threat_actor: "Threat Actor",
  vendor_incident: "Vendor Incident",
  regulatory: "Regulatory",
  general: "General",
};

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

function severityPillClass(relevance: string | null): string {
  const r = (relevance ?? "").toLowerCase();
  if (r === "high") return "bg-orange-100 text-orange-700 border border-orange-200";
  if (r === "medium") return "bg-yellow-100 text-yellow-700 border border-yellow-200";
  if (r === "low") return "bg-green-100 text-green-700 border border-green-200";
  return "bg-slate-100 text-slate-700 border border-slate-200";
}

function severityLabel(relevance: string | null): string {
  return (relevance ?? "").toUpperCase() || "—";
}

function relevanceBorderClass(relevance: string | null): string {
  const r = (relevance ?? "").toLowerCase();
  if (r === "high") return "border-l-orange-400";
  if (r === "medium") return "border-l-yellow-400";
  if (r === "low") return "border-l-green-400";
  return "border-l-slate-600";
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// recommended_actions parsing — full list, preserve original numbering by
// stripping any leading "N. " then re-rendering in <ol>. Splits on newline,
// drops empties.
// ---------------------------------------------------------------------------

function parseActions(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^\d+\.\s*/, ""));
}

// ---------------------------------------------------------------------------
// Source block — render only when at least one source-bearing field exists
// ---------------------------------------------------------------------------

function hasAnySource(item: IntelligenceBriefItem): boolean {
  return Boolean(
    item.affected_cve ||
      item.affected_vendor ||
      item.source_slug ||
      item.ingestion_timestamp
  );
}

// ---------------------------------------------------------------------------
// Walk content_json.categories[*].items[*] to find the engine-side BriefItem
// matching this row, and return its `analysis` string.
//
// Why: the engine's GET /api/intelligence-briefs/:id returns a flat items[]
// array sourced from the intelligence_brief_items DB table, which doesn't
// persist `analysis` — that field lives only inside content_json (the
// pre-personalisation snapshot the engine stamped at generation time).
// Surfacing analysis on the per-signal page therefore requires walking the
// content_json tree.
//
// Match strategy: cyber_signal_id (shared across both shapes) is the strict
// key. Title equality is the fallback when the wire-shape carries null
// cyber_signal_id (which can happen when the parent cyber_signals row was
// deleted after the brief was generated — ON DELETE SET NULL on the FK).
//
// All access is defensive: any structural mismatch returns null rather than
// throwing, since content_json is loosely typed on the wire.
// ---------------------------------------------------------------------------

function findAnalysisInContentJson(
  contentJson: IntelligenceBriefDetailResponse["content_json"],
  item: IntelligenceBriefItem
): string | null {
  if (!contentJson || typeof contentJson !== "object") return null;
  const categories = (contentJson as { categories?: unknown }).categories;
  if (!Array.isArray(categories)) return null;

  type Candidate = {
    cyber_signal_id?: unknown;
    title?: unknown;
    analysis?: unknown;
  };

  const candidates: Candidate[] = [];
  for (const cat of categories) {
    if (!cat || typeof cat !== "object") continue;
    const items = (cat as { items?: unknown }).items;
    if (!Array.isArray(items)) continue;
    for (const c of items) {
      if (c && typeof c === "object") candidates.push(c as Candidate);
    }
  }

  const extractAnalysis = (c: Candidate): string | null =>
    typeof c.analysis === "string" && c.analysis.trim().length > 0
      ? c.analysis.trim()
      : null;

  // Primary: cyber_signal_id strict equality
  if (item.cyber_signal_id) {
    for (const c of candidates) {
      if (
        typeof c.cyber_signal_id === "string" &&
        c.cyber_signal_id === item.cyber_signal_id
      ) {
        return extractAnalysis(c);
      }
    }
  }

  // Fallback: title equality (used when wire-shape cyber_signal_id is null)
  for (const c of candidates) {
    if (typeof c.title === "string" && c.title === item.title) {
      return extractAnalysis(c);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function SignalDetailPage({ params }: Props) {
  const { id, index: indexStr } = await params;
  const session = await getSession();

  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    redirect("/login");
  }

  const index = parseInt(indexStr, 10);
  if (!Number.isInteger(index) || index < 0 || String(index) !== indexStr) {
    notFound();
  }

  const brief = await getIntelligenceBrief(token, id);
  if (!brief) {
    notFound();
  }

  const item = brief.items[index];
  if (!item) {
    notFound();
  }

  const actions = parseActions(item.recommended_actions);
  const bandBg = urgencyBg(item.urgency ?? null);
  const bandLabel = urgencyLabel(item.urgency ?? null);
  const showSource = hasAnySource(item);
  const analysis = findAnalysisInContentJson(brief.content_json, item);

  return (
    <div className="min-h-screen bg-brand-bg">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* Back link */}
        <div className="mb-6">
          <Link
            href={`/briefs/${id}`}
            className="text-brand-teal hover:text-teal-300 text-sm font-medium transition-colors"
          >
            ← Back to brief
          </Link>
        </div>

        {/* Card surface — same outer shape as the signal card on the brief page */}
        <article
          className={`border border-slate-700 border-l-4 ${relevanceBorderClass(item.relevance)} rounded-xl overflow-hidden shadow-sm`}
        >
          {/* Priority band */}
          <div className={`${bandBg} px-5 py-2.5 flex items-center justify-between gap-3`}>
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-xs font-bold text-white uppercase tracking-widest flex-shrink-0">
                {bandLabel}
              </span>
              <span className="text-white/30 select-none flex-shrink-0">·</span>
              <span className="text-xs font-semibold text-white/60 uppercase tracking-wide truncate">
                {categoryLabel(item.category)}
              </span>
            </div>
            <span className="text-xs font-semibold text-white/50 uppercase tracking-widest flex-shrink-0">
              #{index + 1}
            </span>
          </div>

          {/* Body */}
          <div className="bg-slate-800 p-6 sm:p-8">
            <div className="flex items-start justify-between gap-3 mb-6">
              <h1 className="font-bold text-xl sm:text-2xl leading-snug flex-1 text-slate-100">
                {item.title}
              </h1>
              <span
                className={`text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide flex-shrink-0 ${severityPillClass(item.relevance)}`}
              >
                {severityLabel(item.relevance)}
              </span>
            </div>

            {actions.length > 0 && (
              <section className="mb-6 bg-teal-50 rounded-lg p-5 border border-teal-100">
                <p className="text-xs font-bold text-teal-700 uppercase tracking-wide mb-3">
                  Action
                </p>
                <ol className="list-decimal list-outside ml-5 space-y-2 marker:text-teal-700">
                  {actions.map((line, i) => (
                    <li
                      key={i}
                      className="text-sm text-slate-800 leading-relaxed pl-1"
                    >
                      {line}
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {item.why_it_matters && (
              <section className="mb-6">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
                  Context
                </p>
                <p className="text-sm text-slate-300 leading-relaxed max-w-prose">
                  {item.why_it_matters}
                </p>
              </section>
            )}

            {analysis && (
              <section className="mb-6">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
                  Analysis
                </p>
                <p className="text-sm text-slate-300 leading-relaxed max-w-prose whitespace-pre-line">
                  {analysis}
                </p>
              </section>
            )}

            {showSource && (
              <section className="pt-6 border-t border-slate-700">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
                  Source
                </p>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  {item.affected_cve && (
                    <div>
                      <dt className="text-xs text-slate-500 uppercase tracking-wide mb-0.5">CVE</dt>
                      <dd className="font-mono text-slate-300">{item.affected_cve}</dd>
                    </div>
                  )}
                  {item.affected_vendor && (
                    <div>
                      <dt className="text-xs text-slate-500 uppercase tracking-wide mb-0.5">Vendor</dt>
                      <dd className="text-slate-300">{item.affected_vendor}</dd>
                    </div>
                  )}
                  {item.source_slug && (
                    <div>
                      <dt className="text-xs text-slate-500 uppercase tracking-wide mb-0.5">Feed</dt>
                      <dd className="text-slate-300">{item.source_slug}</dd>
                    </div>
                  )}
                  {item.ingestion_timestamp && (
                    <div>
                      <dt className="text-xs text-slate-500 uppercase tracking-wide mb-0.5">Ingested</dt>
                      <dd className="text-slate-300">{formatDate(item.ingestion_timestamp)}</dd>
                    </div>
                  )}
                </dl>
              </section>
            )}
          </div>
        </article>
      </div>
    </div>
  );
}
