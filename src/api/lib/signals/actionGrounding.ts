/**
 * actionGrounding.ts — PURE CVE-grounding guard for LLM-generated brief text.
 *
 * Extracted verbatim from briefSynthesizer.ts (IQP Q5) so the pure brief
 * generator can wire the guard into the live enrichment call without pulling
 * the synthesizer's postgres import into the no-I/O layer. The synthesizer
 * re-exports these, so its public API and tests are unchanged.
 *
 * Built after the PR #25 CVE-hallucination incident: LLM output may only
 * reference CVEs that actually appear in the source items — anything else is
 * a fabrication and the containing action is dropped.
 */

/** Minimal item shape the allowed-set scan needs (BriefItem-compatible). */
export interface CveBearingItem {
  affected_cve?: string | null;
  title?: string | null;
  summary?: string | null;
  why_it_matters?: string | null;
  analysis?: string | null;
  recommended_actions?: string | null;
}

const CVE_PATTERN = /CVE-\d{4}-\d{4,7}/gi;

/**
 * Build the set of CVE identifiers that appear anywhere in the brief's
 * source items. Used to validate that LLM-generated text only references
 * CVEs that are actually in the input — anything else is a hallucination.
 *
 * Scans every text-bearing field on each item. CVE strings are normalized
 * to uppercase before insertion so lookup is case-insensitive.
 */
export function buildAllowedCveSet(items: ReadonlyArray<CveBearingItem>): Set<string> {
  const cves = new Set<string>();
  for (const item of items) {
    const fields: Array<string | null | undefined> = [
      item.affected_cve,
      item.title,
      item.summary,
      item.why_it_matters,
      item.analysis,
      item.recommended_actions ?? null
    ];
    for (const field of fields) {
      if (typeof field !== "string") continue;
      const matches = field.match(CVE_PATTERN);
      if (matches) {
        for (const m of matches) cves.add(m.toUpperCase());
      }
    }
  }
  return cves;
}

export type GroundingResult = {
  kept: string[];
  dropped: Array<{ action: string; offendingCves: string[] }>;
};

/**
 * Filter LLM-generated action strings against an allowed-CVE set.
 *
 * Decision rules:
 * - Zero CVE citations → kept. Vendor/product-only actions are legitimate.
 * - All cited CVEs in the allowed set → kept.
 * - One or more cited CVEs not in the allowed set → dropped entirely.
 *   Mixed grounding is treated as contaminated; partial fabrication poisons
 *   the surrounding claim.
 *
 * Empty or non-string entries are silently skipped.
 */
export function validateActionGrounding(
  actions: string[],
  allowedCves: Set<string>
): GroundingResult {
  const kept: string[] = [];
  const dropped: Array<{ action: string; offendingCves: string[] }> = [];

  for (const action of actions) {
    if (typeof action !== "string" || action.trim().length === 0) {
      continue;
    }

    const cited = action.match(CVE_PATTERN) ?? [];
    if (cited.length === 0) {
      kept.push(action);
      continue;
    }

    const offending = cited.filter(
      (c) => !allowedCves.has(c.toUpperCase())
    );

    if (offending.length === 0) {
      kept.push(action);
    } else {
      dropped.push({ action, offendingCves: offending });
    }
  }

  return { kept, dropped };
}
