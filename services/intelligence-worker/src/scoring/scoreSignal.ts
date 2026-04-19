export type SignalForScoring = {
  title: string
  source: string
  summary?: string | null
  tags?: string[]
}

export type SignalScoreResult = {
  impactScore: number
  noveltyScore: number
  relevanceScore: number
  priority: number
}

// Source credibility boosts applied to relevance_score.
// Government / regulatory bodies score highest; journalism tiers below.
const SOURCE_CREDIBILITY: Record<string, number> = {
  // Government / regulatory bodies
  "regulatory_cisa":                0.25,
  "regulatory_nist":                0.20,
  "regulatory_ftc":                 0.20,
  "regulatory_sec_8k":              0.20,
  "regulatory_nydfs":               0.20,
  "regulatory_enisa":               0.18,
  "regulatory_ico":                 0.18,
  "regulatory_fsb":                 0.15,
  // Tier 1 security journalism
  "security_news_krebs":            0.15,
  "vendor_risk_securityweek":       0.12,
  "vendor_risk_darkreading":        0.12,
  "security_news_bleepingcomputer": 0.10,
  "security_news_thehackernews":    0.10,
  "security_news_theregister":      0.10,
  // AI governance
  "ai_governance_venturebeat":      0.08,
  "ai_governance_mit_techreview":   0.08,
};

const CVE_PATTERN = /CVE-\d{4}-\d{4,}/i;

const REGULATORY_AUTHORITY_KEYWORDS =
  /enforcement|penalty|fine|settlement|violation|requirement|mandate|deadline|compliance|breach notification/i;

function clampScore(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return Number(value.toFixed(2))
}

export function scoreSignal(signal: SignalForScoring): SignalScoreResult {
  const title   = signal.title.toLowerCase()
  const summary = (signal.summary ?? "").toLowerCase()
  const text    = `${title} ${summary}`
  const source  = signal.source

  let impact    = 0.4
  let novelty   = 0.4
  let relevance = 0.5

  // Source credibility boost — applied to relevance
  const credibilityBoost = SOURCE_CREDIBILITY[source] ?? 0
  relevance = Math.min(1.0, relevance + credibilityBoost)

  // High-severity signal keywords
  if (
    text.includes("emergency directive") ||
    text.includes("critical") ||
    text.includes("active threat") ||
    text.includes("urgent") ||
    text.includes("exploit")
  ) {
    impact += 0.3
  }

  // Novelty keywords
  if (
    text.includes("new") ||
    text.includes("updated") ||
    text.includes("announces") ||
    text.includes("releases")
  ) {
    novelty += 0.2
  }

  // General relevance keywords
  if (
    text.includes("federal") ||
    text.includes("infrastructure") ||
    text.includes("critical infrastructure") ||
    text.includes("cybersecurity") ||
    text.includes("risk")
  ) {
    relevance = Math.min(1.0, relevance + 0.2)
  }

  if (signal.tags?.includes("cisa")) relevance = Math.min(1.0, relevance + 0.1)

  // CVE presence — signals with specific CVE IDs are higher priority
  if (CVE_PATTERN.test(text)) {
    impact  = Math.min(1.0, impact + 0.15)
    novelty = Math.min(1.0, novelty + 0.10)
  }

  // Regulatory authority boost — enforcement content from credible regulators
  if (REGULATORY_AUTHORITY_KEYWORDS.test(text) && (SOURCE_CREDIBILITY[source] ?? 0) >= 0.15) {
    impact    = Math.min(1.0, impact + 0.20)
    relevance = Math.min(1.0, relevance + 0.10)
  }

  const impactScore     = clampScore(impact)
  const noveltyScore    = clampScore(novelty)
  const relevanceScore  = clampScore(relevance)
  const priority        = clampScore((impactScore + noveltyScore + relevanceScore) / 3)

  return {
    impactScore,
    noveltyScore,
    relevanceScore,
    priority
  }
}
