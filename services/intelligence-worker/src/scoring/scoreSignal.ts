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

function clampScore(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return Number(value.toFixed(2))
}

export function scoreSignal(signal: SignalForScoring): SignalScoreResult {
  const title = signal.title.toLowerCase()
  const summary = (signal.summary ?? "").toLowerCase()
  const text = `${title} ${summary}`

  let impact = 0.4
  let novelty = 0.4
  let relevance = 0.5

  if (signal.source.toLowerCase().includes("cisa")) impact += 0.2

  if (
    text.includes("emergency directive") ||
    text.includes("critical") ||
    text.includes("active threat") ||
    text.includes("urgent") ||
    text.includes("exploit")
  ) {
    impact += 0.3
  }

  if (
    text.includes("new") ||
    text.includes("updated") ||
    text.includes("announces") ||
    text.includes("releases")
  ) {
    novelty += 0.2
  }

  if (
    text.includes("federal") ||
    text.includes("infrastructure") ||
    text.includes("critical infrastructure") ||
    text.includes("cybersecurity") ||
    text.includes("risk")
  ) {
    relevance += 0.2
  }

  if (signal.tags?.includes("cisa")) relevance += 0.1

  const impactScore = clampScore(impact)
  const noveltyScore = clampScore(novelty)
  const relevanceScore = clampScore(relevance)
  const priority = clampScore((impactScore + noveltyScore + relevanceScore) / 3)

  return {
    impactScore,
    noveltyScore,
    relevanceScore,
    priority
  }
}
