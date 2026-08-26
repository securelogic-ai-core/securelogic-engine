/**
 * severityNormalization.ts — external severity vocabularies → SecureLogic's.
 *
 * PURE. No I/O, no database, no clock, so the mapping is unit-testable and can
 * be re-run by a reader against a stored source_severity to check our work.
 *
 * ── THE RULE THAT MATTERS ──────────────────────────────────────────────────
 * SecureLogic's canonical severity is SLA-BEARING: Critical, High, Moderate and
 * Low each acquire a due date under a configured policy, enter the overdue
 * population, and appear on an executive report as unremediated work.
 *
 * So a mapping is not a naming exercise. Turning a tester's "Informational"
 * into "Low" would manufacture a remediation obligation that nobody asserted
 * and nobody accepted — an invented deadline against an observation that was
 * explicitly NOT a vulnerability. `Medium → Moderate` is a synonym;
 * `Informational → Low` is a fabrication. They are not the same operation and
 * this module never treats them as one.
 *
 * ── THREE OUTCOMES, NOT TWO ────────────────────────────────────────────────
 *   mapped        the source stated a severity we recognise as one of ours
 *   no_severity   the source stated, in its own words, that there is no
 *                 material severity (Informational, None, Note, Observational)
 *   unmapped      we do not recognise the value at all
 *
 * The last two both yield `severity: null` — no canonical severity, therefore
 * no SLA — but they are DIFFERENT FACTS and are reported separately, because
 * "the tester said this is informational" and "we could not read this value"
 * call for different human follow-up.
 *
 * ── FAIL TOWARD UNMAPPED ───────────────────────────────────────────────────
 * Ambiguity resolves to `unmapped`, never to a guess. A wrong canonical
 * severity is worse than an absent one: absent is visible and asks a question,
 * wrong is invisible and answers it incorrectly.
 */

/** SecureLogic's canonical, SLA-bearing severities. */
export const CANONICAL_SEVERITIES = ["Critical", "High", "Moderate", "Low"] as const;
export type CanonicalSeverity = (typeof CANONICAL_SEVERITIES)[number];

export type SeverityOutcome = "mapped" | "no_severity" | "unmapped";

export interface NormalizedSeverity {
  /** The canonical value, or null when the source asserts none / cannot be read. */
  severity: CanonicalSeverity | null;
  /** Always the caller's input, verbatim and untouched. */
  sourceSeverity: string;
  outcome: SeverityOutcome;
  /** Why, in one line, for the import report a human reads. */
  reason: string;
}

/**
 * Direct synonyms. Compared case-insensitively after trimming and collapsing
 * separators, so "very high", "Very-High" and "VERY_HIGH" are one entry.
 *
 * Sources covered: CVSS v3.1 and v4.0 qualitative ratings (identical
 * vocabularies), and the severity scales common to penetration-test reports —
 * OWASP-style Critical..Info, the P1..P4 priority scale used by bug-bounty and
 * boutique testing firms, and the Sev1..Sev4 incident-style scale.
 */
const SYNONYMS: Record<string, CanonicalSeverity> = {
  // ── Direct ────────────────────────────────────────────────────────────────
  critical: "Critical",
  high: "High",
  moderate: "Moderate",
  low: "Low",

  // ── CVSS v3.1 / v4.0 qualitative. The only divergence from ours is
  //    "Medium", which is the same band under a different name. ─────────────
  medium: "Moderate",

  // ── Emphasis variants seen in pen-test reports ───────────────────────────
  "very high": "Critical",
  severe: "Critical",
  "very low": "Low",
  minor: "Low",
  major: "High",

  // ── P-scale (bug bounty / boutique firms). P1 is exploitable-now. ────────
  p1: "Critical",
  p2: "High",
  p3: "Moderate",
  p4: "Low",

  // ── Sev-scale (incident-style numbering; Sev1 is most severe) ────────────
  sev1: "Critical",
  sev2: "High",
  sev3: "Moderate",
  sev4: "Low",
};

/**
 * Values that mean "there is no material severity here".
 *
 * These are NOT unmapped — the source spoke clearly and said there is nothing
 * to remediate. Recording that faithfully is the whole point: an informational
 * observation belongs in the report, and does not belong in the overdue queue.
 */
const NO_SEVERITY = new Set([
  "informational",
  "info",
  "information",
  "none",
  "note",
  "notice",
  "observation",
  "observational",
  "n/a",
  "na",
]);

function canonicalKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

/**
 * CVSS numeric → qualitative. v3.1 and v4.0 publish the SAME bands, so one
 * table serves both:
 *   0.0        None
 *   0.1 – 3.9  Low
 *   4.0 – 6.9  Medium      → Moderate
 *   7.0 – 8.9  High
 *   9.0 – 10.0 Critical
 *
 * 0.0 is `no_severity`, not Low: the standard's own word for it is "None".
 */
export function severityFromCvssScore(score: number): NormalizedSeverity {
  const src = String(score);
  if (!Number.isFinite(score) || score < 0 || score > 10) {
    return {
      severity: null, sourceSeverity: src, outcome: "unmapped",
      reason: "CVSS score outside the 0.0–10.0 range",
    };
  }
  if (score === 0) {
    return {
      severity: null, sourceSeverity: src, outcome: "no_severity",
      reason: "CVSS 0.0 is 'None' — no remediation SLA applies",
    };
  }
  const severity: CanonicalSeverity =
    score >= 9.0 ? "Critical" : score >= 7.0 ? "High" : score >= 4.0 ? "Moderate" : "Low";
  return {
    severity, sourceSeverity: src, outcome: "mapped",
    reason: `CVSS ${src} falls in the ${severity === "Moderate" ? "Medium" : severity} band`,
  };
}

/**
 * Normalise one source severity.
 *
 * A bare numeric string is read as a CVSS score, because that is what a number
 * in a severity column means in every report format we have seen. Anything
 * else goes through the synonym table, then the no-severity set, then fails to
 * `unmapped`.
 */
export function normalizeSeverity(raw: string | null | undefined): NormalizedSeverity {
  const source = typeof raw === "string" ? raw.trim() : "";

  if (!source) {
    return {
      severity: null, sourceSeverity: "", outcome: "unmapped",
      reason: "No severity supplied",
    };
  }

  if (/^\d+(\.\d+)?$/.test(source)) {
    return severityFromCvssScore(Number(source));
  }

  const key = canonicalKey(source);

  const synonym = SYNONYMS[key];
  if (synonym) {
    return {
      severity: synonym, sourceSeverity: source, outcome: "mapped",
      reason: key === synonym.toLowerCase()
        ? "Matches a SecureLogic severity"
        : `"${source}" maps to ${synonym}`,
    };
  }

  if (NO_SEVERITY.has(key)) {
    return {
      severity: null, sourceSeverity: source, outcome: "no_severity",
      reason: `"${source}" states no material severity — no remediation SLA applies`,
    };
  }

  return {
    severity: null, sourceSeverity: source, outcome: "unmapped",
    // Deliberately does NOT suggest a value. A suggestion in an error message
    // is the first step toward someone accepting it without checking.
    reason: `"${source}" is not a severity SecureLogic recognises — no canonical severity assigned`,
  };
}

/** The published table, for the import UI and the docs. Order is presentation order. */
export const SEVERITY_NORMALIZATION_TABLE: ReadonlyArray<{
  source: string;
  canonical: CanonicalSeverity | null;
  note: string;
}> = [
  { source: "Critical · Very High · Severe · P1 · Sev1 · CVSS 9.0–10.0", canonical: "Critical", note: "SLA-bearing" },
  { source: "High · Major · P2 · Sev2 · CVSS 7.0–8.9", canonical: "High", note: "SLA-bearing" },
  { source: "Medium · Moderate · P3 · Sev3 · CVSS 4.0–6.9", canonical: "Moderate", note: "SLA-bearing; Medium is the same band under another name" },
  { source: "Low · Minor · Very Low · P4 · Sev4 · CVSS 0.1–3.9", canonical: "Low", note: "SLA-bearing" },
  { source: "Informational · Info · None · Note · Observation · N/A · CVSS 0.0", canonical: null, note: "Ingested and preserved. NO canonical severity and NO remediation SLA — never coerced to Low" },
  { source: "anything else", canonical: null, note: "Unmapped. Ingested with the source value preserved; no canonical severity is guessed" },
];
