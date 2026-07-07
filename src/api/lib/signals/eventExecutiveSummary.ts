/**
 * eventExecutiveSummary.ts — normalized, citation-preserving executive summaries
 * for canonical Intelligence Events. Intelligence Pipeline Hardening / IE.P5.
 *
 * Goal item 5: "Generate normalized enterprise summaries. Never expose raw feed
 * text as the primary customer experience. Preserve source citations."
 *
 * buildEventSummary() is PURE and always available (no LLM, no I/O): it composes
 * a display-safe, enterprise-framed summary from the STRUCTURED event fields
 * (severity, status, affected entity, contributing sources) — never raw feed
 * text as the primary field. It is the deterministic baseline the projection
 * uses. The optional LLM narrative overlay lives in eventExecutiveSummaryLlm.ts
 * so this module stays free of the Anthropic SDK and safe to import from the
 * pure projection core.
 */

import { assessContent, type ContentStatus } from "./contentQuality.js";
import type { EventStatus } from "./intelligenceEventProjection.js";

export interface EventSummaryInput {
  readonly title: string;
  /** The signal's normalized_summary — raw feed-derived text (quality-gated here). */
  readonly rawSummary: string;
  readonly severity: string;
  readonly status: EventStatus;
  readonly affected_vendor: string | null;
  readonly affected_cve: string | null;
  /** Contributing source slugs (e.g. ["nvd","cisa_kev"]). */
  readonly sources: readonly string[];
}

export interface EventSummary {
  readonly summary: string;
  readonly summary_status: ContentStatus;
}

/** Human-friendly source label from a slug (nvd → NVD, cisa_kev → CISA KEV). */
export function prettifySource(slug: string): string {
  const known: Record<string, string> = {
    nvd: "NVD",
    cisa_kev: "CISA KEV",
    cisa_alerts: "CISA",
    sec_edgar: "SEC EDGAR",
    federal_register: "Federal Register",
    mitre_attack: "MITRE ATT&CK",
    mitre_atlas: "MITRE ATLAS",
    nist_news: "NIST",
    ftc_news: "FTC",
    onc_healthit: "ONC HealthIT",
    bleepingcomputer: "BleepingComputer",
    krebsonsecurity: "KrebsOnSecurity",
    sans_isc: "SANS ISC"
  };
  const key = slug.toLowerCase().trim();
  if (known[key]) return known[key];
  return key
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Distinct, display-ordered source citation list. */
function citation(sources: readonly string[]): string {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const s of sources) {
    const key = s.toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    labels.push(prettifySource(s));
  }
  if (labels.length === 0) return "";
  return `Sources: ${labels.join(", ")}.`;
}

/** One-line status framing for the executive reader. */
function statusFraming(status: EventStatus): string {
  switch (status) {
    case "exploited":
      return "Active exploitation has been reported.";
    case "patched":
      return "A patch or mitigation is available.";
    case "evolving":
      return "Multiple sources are corroborating this event.";
    default:
      return "";
  }
}

/** Ensure a fragment ends on terminal punctuation (adds a period if missing). */
function terminate(text: string): string {
  const t = text.trim();
  if (t === "") return "";
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * Build the deterministic, normalized executive summary. Never returns raw feed
 * text as the sole primary content, always cites contributing sources, and is
 * display-safe (no broken sentences).
 */
export function buildEventSummary(input: EventSummaryInput): EventSummary {
  const assessed = assessContent(input.rawSummary);
  // Lead: the display-safe description, or a structured line when unusable.
  const lead =
    assessed.status !== "degraded" && assessed.displayText !== ""
      ? assessed.displayText
      : structuredLead(input);

  const parts = [terminate(lead), statusFraming(input.status), citation(input.sources)].filter(
    (p) => p.length > 0
  );

  return {
    summary: parts.join(" "),
    // Honestly reflects the underlying description's quality: a degraded raw
    // summary yields a display-safe STRUCTURED line but still reports 'degraded'
    // so downstream can badge it as limited-detail (never a broken sentence).
    summary_status: assessed.status
  };
}

/** Structured fallback line when there is no usable prose. */
function structuredLead(input: EventSummaryInput): string {
  const bits: string[] = [`${input.severity}-severity event`];
  if (input.affected_cve) bits.push(input.affected_cve);
  if (input.affected_vendor) bits.push(`affecting ${input.affected_vendor}`);
  return bits.join(" ");
}

/** Re-exported for the LLM overlay so it can keep the citation attached. */
export function summaryCitation(sources: readonly string[]): string {
  return citation(sources);
}

/** Terminal-punctuation helper, re-exported for the LLM overlay. */
export function ensureTerminated(text: string): string {
  return terminate(text);
}
