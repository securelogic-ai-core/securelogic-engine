/**
 * briefRelevance.ts — IQP Q3: INTERIM org-relevance + classification guard for
 * the customer-facing brief (Phase 1 audit defects #5a and #5b).
 *
 * #5a — unmonitored SEC/EDGAR filings reached customers: the org-entity match
 * gate exists only on the findings path (runMatcherForSignal); the brief read
 * raw cyber_signals by time window with NO monitored-entity filter. INTERIM
 * rule: a `third_party_breach` signal is an org-specific claim ("your vendor
 * was breached") — it renders ONLY when its affected_vendor canonically
 * matches one of the org's ACTIVE vendors, using the SAME
 * canonicalizeVendorName comparison the existing matcher uses (one transform
 * truth, cyberSignalProcessingService.ts). Everything else (CVE/KEV/advisory/
 * threat intel) is globally relevant subscribed content and passes through.
 *
 * #5b — a Musk-v-Altman trial article was bucketed COMPLIANCE: category is
 * stamped from the ARRIVAL FEED (FTC feed → regulatory_change) through a broad
 * keyword whitelist; no content check exists. INTERIM rule: an item that would
 * render under "Regulatory & Compliance Updates" must actually READ like a
 * regulatory item (intent keywords: rule/regulation/enforcement/compliance/
 * guidance/framework/…); otherwise it re-buckets to `general` — still
 * rendered, no longer mislabeled COMPLIANCE.
 *
 * This is deliberately NOT the applicability engine (EAR scope — out of
 * bounds for IQP): no new tables, no scoring, no obligations graph. Pure
 * functions; the callers fetch the org vendor set with the matcher's own
 * query shape AND pass the matcher's own canonicalizeVendorName in — this
 * module stays free of I/O imports (cyberSignalProcessingService pulls in
 * the postgres infra at load time) so the pure brief-generation layer can
 * keep importing it without a DB.
 *
 * Both rules are gated on SECURELOGIC_BRIEF_RELEVANCE_ENABLED (default OFF in
 * every environment; OFF = byte-identical brief).
 */

// ---------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------

/** OFF by default. ON only when SECURELOGIC_BRIEF_RELEVANCE_ENABLED === "true". */
export function briefRelevanceEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_BRIEF_RELEVANCE_ENABLED"] === "true";
}

// ---------------------------------------------------------------------------
// #5a — org-relevance gate for vendor-keyed breach claims
// ---------------------------------------------------------------------------

/** The minimal signal shape the relevance filter needs (subset of CyberSignalForBrief). */
export interface RelevanceFilterableSignal {
  signal_type: string;
  affected_vendor: string | null;
}

/** Signal types that are ORG-SPECIFIC claims and therefore require a
 * monitored-vendor match to render. Everything else is globally relevant
 * threat/vuln/regulatory intelligence and passes through (interim ruling —
 * the full applicability engine is EAR scope, not IQP). */
export const VENDOR_GATED_SIGNAL_TYPES: ReadonlySet<string> = new Set([
  "third_party_breach"
]);

/**
 * Split signals into rendered vs suppressed under the interim org-relevance
 * rule. `canonicalVendorSet` holds canonicalize() forms of the org's ACTIVE
 * vendors, and `canonicalize` MUST be the matcher's own canonicalizeVendorName
 * (callers import it from cyberSignalProcessingService) so both sides of the
 * comparison use the one transform truth.
 *
 * A vendor-gated signal with a NULL vendor is suppressed too: an
 * unattributable third-party-breach claim cannot be relevant to any
 * monitored entity.
 */
export function filterSignalsByOrgRelevance<S extends RelevanceFilterableSignal>(
  signals: ReadonlyArray<S>,
  canonicalVendorSet: ReadonlySet<string>,
  canonicalize: (vendorName: string) => string
): { kept: S[]; suppressed: S[] } {
  const kept: S[] = [];
  const suppressed: S[] = [];
  for (const s of signals) {
    if (!VENDOR_GATED_SIGNAL_TYPES.has(s.signal_type)) {
      kept.push(s);
      continue;
    }
    const canonical = s.affected_vendor !== null ? canonicalize(s.affected_vendor) : "";
    if (canonical !== "" && canonicalVendorSet.has(canonical)) {
      kept.push(s);
    } else {
      suppressed.push(s);
    }
  }
  return { kept, suppressed };
}

// ---------------------------------------------------------------------------
// #5b — regulatory-intent guard (classification correction)
// ---------------------------------------------------------------------------

/**
 * Content markers that make an item genuinely regulatory/compliance-shaped.
 * Deliberately intent-specific: the ingestion whitelist's generic terms
 * ("data", "risk", "security") are exactly what let a trial article through,
 * so none of those appear here.
 */
const REGULATORY_INTENT_RE = new RegExp(
  [
    "\\brule(?:making)?s?\\b",
    "\\bregulat(?:ion|ions|ory|or|ors|e|ed)\\b",
    "\\brequirements?\\b",
    "\\bcompliance\\b",
    "\\benforcement\\b",
    "\\bguidance\\b",
    "\\bframeworks?\\b",
    "\\bstandards?\\b",
    "\\bdirectives?\\b",
    "\\bstatutes?\\b",
    "\\blegislat(?:ion|ive)\\b",
    "\\bexecutive order\\b",
    "\\bfinal rule\\b",
    "\\bproposed rule\\b",
    "\\bcomment period\\b",
    "\\bconsent (?:order|decree)\\b",
    "\\bcivil penalt(?:y|ies)\\b",
    "\\bsettlements?\\b",
    "\\bcfr\\b",
    "\\bhipaa\\b",
    "\\bgdpr\\b",
    "\\bccpa\\b",
    "\\bdora\\b",
    "\\bnis2\\b",
    "\\bbreach notification\\b",
    "\\breporting (?:requirement|obligation|deadline)s?\\b"
  ].join("|"),
  "i"
);

/** True when the item's visible text actually reads like regulatory content. */
export function hasRegulatoryIntent(text: string): boolean {
  return REGULATORY_INTENT_RE.test(text);
}

/**
 * Classification correction for one brief item: an item bucketed `regulatory`
 * by its arrival feed re-buckets to `general` unless its title+summary carry
 * regulatory intent. Non-regulatory categories pass through untouched.
 */
export function refineCategory(
  category: string,
  title: string,
  summary: string
): string {
  if (category !== "regulatory") return category;
  return hasRegulatoryIntent(`${title} ${summary}`) ? "regulatory" : "general";
}
