/**
 * sourceDisplayNames.ts — Map internal source slugs to human-readable labels.
 *
 * No I/O. Pure functions. Fully unit-testable.
 *
 * BACKGROUND
 * ----------
 * `cyber_signals.source` is a free-text TEXT column populated by adapters and
 * the worker bridge with internal slugs (`cisa_kev`, `regulatory_cisa`,
 * `security_news_bleepingcomputer`, etc.). Customer-facing surfaces should
 * not render these raw — see `docs/brief-content-audit.md` §4 (bug 4).
 *
 * This module is the single source of truth for slug → display name. The
 * mapping is intentionally derived at API-response time rather than persisted
 * on `intelligence_brief_items` so that future renames are a code change
 * + deploy, not a migration + backfill.
 *
 * SLUG UNIVERSE
 * -------------
 * The 26 slugs below cover every source string written into `cyber_signals`
 * by the engine and worker today (re-enumerated against current code on
 * 2026-05-02; see audit §4 inventory). Worker prefixes (`security_news_`,
 * `vendor_risk_`, `regulatory_`, `ai_governance_`) and engine canonical
 * slugs (`bleepingcomputer`, `nist_news`, …) coexist deliberately — see the
 * dedup-audit deferred Issue B for the harmonisation backlog.
 *
 * UNKNOWN SLUGS
 * -------------
 * `getSourceDisplayName` falls back to `prettifyUnknownSlug` rather than
 * crashing. The fallback strips known namespace prefixes, replaces
 * underscores with spaces, applies an acronym/word-casing pass, and
 * preserves any acronym tokens via `KNOWN_ACRONYMS`. This keeps newly
 * added slugs from displaying as raw underscores in the UI even before
 * anyone updates `SOURCE_DISPLAY_NAMES`.
 */

/**
 * Explicit slug → display name mapping.
 *
 * Keep alphabetically sorted within each group. To add a slug: append to the
 * relevant group, run `npm test -- sourceDisplayNames`. No migration.
 */
export const SOURCE_DISPLAY_NAMES: Record<string, string> = {
  // ── Engine direct adapters (cyberSignalProcessingService callers) ──
  cisa_alerts: "CISA Cybersecurity Advisories",
  cisa_kev: "CISA KEV",
  mitre_atlas: "MITRE ATLAS",
  mitre_attack: "MITRE ATT&CK",
  nvd: "NVD",

  // ── Engine FeedAdapter registry (src/api/lib/feedAdapter/registry.ts) ──
  bleepingcomputer: "BleepingComputer",
  ftc_news: "FTC",
  krebsonsecurity: "Krebs on Security",
  nist_news: "NIST",
  sans_isc: "SANS ISC",

  // ── Worker security-news feeds (services/intelligence-worker/.../securityNewsFeed.ts) ──
  security_news_bleepingcomputer: "BleepingComputer",
  security_news_krebs: "Krebs on Security",
  security_news_thehackernews: "The Hacker News",
  security_news_theregister: "The Register",

  // ── Worker vendor-risk feeds (.../vendorRiskFeed.ts) ──
  vendor_risk_darkreading: "Dark Reading",
  vendor_risk_securityweek: "SecurityWeek",

  // ── Worker regulatory feeds (.../regulatoryFeed.ts, regulatoryEnforcementFeed.ts) ──
  regulatory_cisa: "CISA",
  regulatory_enisa: "ENISA",
  regulatory_fsb: "FSB",
  regulatory_ftc: "FTC",
  regulatory_ico: "ICO",
  regulatory_nist: "NIST",
  regulatory_nydfs: "NYDFS",
  regulatory_sec_8k: "SEC (Form 8-K)",

  // ── Worker AI-governance feeds (.../aiGovernanceFeed.ts) ──
  ai_governance_mit_techreview: "MIT Technology Review",
  ai_governance_venturebeat: "VentureBeat"
};

/**
 * Namespace prefixes stripped by the prettify fallback. Order doesn't matter
 * — the longest matching prefix is chosen below.
 */
const KNOWN_PREFIXES: ReadonlyArray<string> = [
  "ai_governance_",
  "regulatory_",
  "security_news_",
  "threat_intel_",
  "vendor_risk_"
];

/**
 * Tokens that must be uppercased verbatim when they appear in the prettified
 * output. Lookup is case-insensitive on the input slug; the canonical case
 * here is what we render. Multi-letter acronyms only — single letters are
 * left to standard title-case.
 */
const KNOWN_ACRONYMS: ReadonlyArray<string> = [
  "AI",
  "API",
  "CISA",
  "CVE",
  "ENISA",
  "EU",
  "FBI",
  "FSB",
  "FTC",
  "GHSA",
  "ICO",
  "IT",
  "MITRE",
  "MSRC",
  "NCSC",
  "NIST",
  "NSA",
  "NVD",
  "NYDFS",
  "RHEL",
  "SEC",
  "UK",
  "US"
];

const ACRONYM_SET = new Set(KNOWN_ACRONYMS.map((a) => a.toLowerCase()));

function stripLongestPrefix(slug: string): string {
  let best = "";
  for (const prefix of KNOWN_PREFIXES) {
    if (slug.startsWith(prefix) && prefix.length > best.length) {
      best = prefix;
    }
  }
  return best.length > 0 ? slug.slice(best.length) : slug;
}

function casifyToken(token: string): string {
  if (token.length === 0) return token;
  if (ACRONYM_SET.has(token.toLowerCase())) {
    // Render via the canonical case in KNOWN_ACRONYMS.
    return KNOWN_ACRONYMS[KNOWN_ACRONYMS.findIndex((a) => a.toLowerCase() === token.toLowerCase())]!;
  }
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

/**
 * Best-effort prettify for slugs not in `SOURCE_DISPLAY_NAMES`. Intended as a
 * graceful fallback only — every known slug should be added to the explicit
 * map. Behaviour:
 *
 *   1. Strip the longest known namespace prefix
 *      (`security_news_`, `regulatory_`, `vendor_risk_`, `ai_governance_`,
 *      `threat_intel_`).
 *   2. Split on `_` into tokens.
 *   3. For each token: render as the canonical KNOWN_ACRONYMS entry if it
 *      matches case-insensitively; otherwise title-case (first letter upper,
 *      rest lower).
 *   4. Join with spaces.
 *
 * Empty input returns empty string (caller decides what to render). Never
 * throws.
 *
 * @example
 *   prettifyUnknownSlug("security_news_zdnet")  // "Zdnet"
 *   prettifyUnknownSlug("regulatory_cisa")      // "CISA"  (acronym preserved)
 *   prettifyUnknownSlug("ghsa")                 // "GHSA"
 *   prettifyUnknownSlug("foo_bar_baz")          // "Foo Bar Baz"
 *   prettifyUnknownSlug("")                     // ""
 */
export function prettifyUnknownSlug(slug: string): string {
  if (slug.length === 0) return "";
  const stripped = stripLongestPrefix(slug);
  return stripped
    .split("_")
    .filter((t) => t.length > 0)
    .map(casifyToken)
    .join(" ");
}

/**
 * Resolve a `cyber_signals.source` slug to its user-visible display name.
 *
 * Returns the explicit `SOURCE_DISPLAY_NAMES` entry when one exists.
 * Otherwise returns the result of `prettifyUnknownSlug` so the UI never
 * surfaces raw snake_case.
 *
 * Empty / null-ish input returns empty string — callers passing through a
 * nullable column can default to "" before calling without a guard.
 */
export function getSourceDisplayName(slug: string | null | undefined): string {
  if (typeof slug !== "string" || slug.length === 0) return "";
  const explicit = SOURCE_DISPLAY_NAMES[slug];
  if (typeof explicit === "string") return explicit;
  return prettifyUnknownSlug(slug);
}
