export type RiskBand = "critical" | "high" | "medium" | "low"
export type ConfidenceBand = "high" | "medium" | "low"

export function toNumericScore(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function classifySeverity(scoreInput: string | number | null | undefined): RiskBand {
  const score = toNumericScore(scoreInput)

  if (score >= 0.85) return "critical"
  if (score >= 0.70) return "high"
  if (score >= 0.50) return "medium"
  return "low"
}

export function classifyConfidence(
  metadata: Record<string, unknown> | null | undefined
): ConfidenceBand {
  if (!metadata) return "low"

  const hasSignal = typeof metadata.signal_id === "string" && metadata.signal_id.length > 0
  const hasInsight = typeof metadata.insight_id === "string" && metadata.insight_id.length > 0
  const hasSource = typeof metadata.source === "string" && metadata.source.length > 0

  const evidenceCount = [hasSignal, hasInsight, hasSource].filter(Boolean).length

  if (evidenceCount >= 3) return "high"
  if (evidenceCount >= 2) return "medium"
  return "low"
}
