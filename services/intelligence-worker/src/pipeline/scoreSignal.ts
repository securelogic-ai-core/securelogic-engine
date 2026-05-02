import { Signal, ScoredSignal } from "../models/Signal.js";
import { isValidCategory } from "../constants/categories.js";
import type { Category } from "../constants/categories.js";

/**
 * Keyword sets for impact scoring.
 * Evaluated against the full signal text (title + summary + rawContent).
 */
const IMPACT_5 =
  /\b(zero-?day|actively exploited|under active exploitation|critical vulnerability|mass exploitation|ransomware attack|data breach|nation.?state|supply chain attack|backdoor inserted|rce|remote code execution)\b/i;

const IMPACT_4 =
  /\b(exploit|malware|trojan|phishing campaign|credential theft|account takeover|privilege escalation|lateral movement|ransomware|worm|botnet|spyware|keylogger|unauthorized access)\b/i;

const IMPACT_3 =
  /\b(vulnerability|patch|cve|advisory|security update|threat actor|mitre|data leak|misconfiguration|exposure|regulatory enforcement|compliance gap|vendor breach|third.?party risk)\b/i;

const IMPACT_2 =
  /\b(guidance|best practice|recommendation|awareness|informational|update|revision|new release|announcement)\b/i;

/**
 * Keyword sets for novelty scoring.
 * Higher = more novel/unexpected.
 */
const NOVELTY_5 =
  /\b(zero-?day|novel|newly discovered|first.?seen|emerging|unprecedented|new attack|new technique|previously unknown)\b/i;

const NOVELTY_4 =
  /\b(new|latest|recent|newly|just released|this week|today|breaking|fresh|just published|new variant|new campaign)\b/i;

const NOVELTY_3 =
  /\b(updated|revised|modified|expanded|enhanced|improved|new version)\b/i;

const NOVELTY_2 =
  /\b(ongoing|continued|persistent|recurring|known|established|previously reported)\b/i;

/**
 * Base relevance score by category.
 * Reflects how directly each category maps to enterprise risk decisions.
 */
const CATEGORY_RELEVANCE: Record<Category, number> = {
  SECURITY_INCIDENT: 5,
  // VULNERABILITY uses the same control mapping as SECURITY_INCIDENT until tuned per docs/brief-content-audit.md follow-up. Bug 1 (PR #43) added the category.
  VULNERABILITY:     5,
  AI_GOVERNANCE:     4,
  VENDOR_RISK:       4,
  REGULATION:        4,
  COMPLIANCE_UPDATE: 3,
  GENERAL:           2
};

function scoreText(text: string): {
  impactScore: number;
  noveltyScore: number;
} {
  let impactScore: number;

  if (IMPACT_5.test(text)) {
    impactScore = 5;
  } else if (IMPACT_4.test(text)) {
    impactScore = 4;
  } else if (IMPACT_3.test(text)) {
    impactScore = 3;
  } else if (IMPACT_2.test(text)) {
    impactScore = 2;
  } else {
    impactScore = 1;
  }

  let noveltyScore: number;

  if (NOVELTY_5.test(text)) {
    noveltyScore = 5;
  } else if (NOVELTY_4.test(text)) {
    noveltyScore = 4;
  } else if (NOVELTY_3.test(text)) {
    noveltyScore = 3;
  } else if (NOVELTY_2.test(text)) {
    noveltyScore = 2;
  } else {
    noveltyScore = 1;
  }

  return { impactScore, noveltyScore };
}

export function scoreSignal(signal: Signal): ScoredSignal {
  if (!isValidCategory(signal.category)) {
    signal.category = "GENERAL";
  }

  const category = signal.category as Category;
  const text = `${signal.title} ${signal.summary ?? ""} ${signal.rawContent ?? ""}`;

  const { impactScore, noveltyScore } = scoreText(text);
  const relevanceScore = CATEGORY_RELEVANCE[category] ?? 2;

  // Weighted priority: impact is the dominant factor
  const priority = Math.round(
    (impactScore * 0.5 + noveltyScore * 0.2 + relevanceScore * 0.3) * 10
  ) / 10;

  return {
    ...signal,
    impactScore,
    noveltyScore,
    relevanceScore,
    priority
  };
}
