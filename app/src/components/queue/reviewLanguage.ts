/**
 * reviewLanguage.ts — pure helpers that translate matcher internals into plain
 * enterprise language for the "Review Suggested Links" workflow (ERIP Package 1/2,
 * risk_workspace flag). No React, no I/O — unit-tested in reviewLanguage.test.ts.
 *
 * These exist so the queue UI never shows raw pipeline vocabulary (match_reason
 * codes like `vendor_name_ilike`, raw signal UUIDs, or a bare 0–100 score) as
 * primary customer language. See ENTERPRISE-RISK-WORKSPACE-AUDIT.md §4 (L1–L3).
 */

import type { SignalMatchTargetType } from "@/lib/api";

/** Business noun for a match target (never the internal enum value). */
export const TARGET_NOUN: Record<SignalMatchTargetType, string> = {
  vendor: "vendor",
  ai_system: "AI system",
  control: "control",
  obligation: "obligation",
  asset: "asset",
};

/**
 * Turn a raw matcher `match_reason` code into a plain-English explanation of why
 * SecureLogic suggested the link. Unknown/empty codes degrade to a generic but
 * honest sentence — never the raw code.
 */
export function describeMatchReason(
  reason: string | null | undefined,
  targetType: SignalMatchTargetType,
): string {
  const noun = TARGET_NOUN[targetType];
  const r = (reason ?? "").toLowerCase();

  if (!r) return `SecureLogic linked this signal to this ${noun}.`;
  if (r.includes("cve")) return `The signal references a CVE associated with this ${noun}.`;
  if (r.includes("fuzzy")) return `The signal closely matches this ${noun}'s name.`;
  if (r.includes("domain")) return `The signal affects this ${noun}'s regulatory domain.`;
  if (
    r.includes("name_ilike") ||
    r.includes("name_match") ||
    r.includes("name_canonical") || // registry matcher: asset_name_canonical
    r.endsWith("_name")
  ) {
    return `SecureLogic found this ${noun}'s name in the intelligence signal.`;
  }
  return `SecureLogic linked this signal to this ${noun}.`;
}

export type ConfidenceTone = "high" | "medium" | "low";

/**
 * Map a 0–100 match score to a confidence band label + tone. Returns null when
 * the score is unknown so the UI can omit the chip rather than invent a level.
 */
export function confidenceBand(
  score: number | null | undefined,
): { label: string; tone: ConfidenceTone } | null {
  if (score === null || score === undefined || Number.isNaN(score)) return null;
  if (score >= 70) return { label: "High confidence", tone: "high" };
  if (score >= 40) return { label: "Medium confidence", tone: "medium" };
  return { label: "Low confidence", tone: "low" };
}

/**
 * The human headline for the intelligence behind a suggestion: the canonical
 * Intelligence Event title when present, otherwise a neutral label — NEVER the
 * raw signal UUID. (Event enrichment is null when the Intelligence Events layer
 * is dark, so this must degrade cleanly.)
 */
export function signalHeadline(eventTitle: string | null | undefined): string {
  const t = (eventTitle ?? "").trim();
  return t.length > 0 ? t : "External intelligence signal";
}
