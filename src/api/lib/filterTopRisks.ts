type RiskItem = {
  id: string
  name: string
  category: string
  description: string
  score: string | number
  metadata?: Record<string, unknown> | null
  created_at: string
  numeric_score?: number
  severity?: string
  confidence?: string
}

function containsAny(text: string, keywords: string[]): boolean {
  const normalized = text.toLowerCase()
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()))
}

export function filterTopRisksBySector(
  items: RiskItem[],
  sector?: string
): RiskItem[] {
  if (!sector) return items

  const sectorKey = sector.trim().toLowerCase()
  if (!sectorKey) return items

  const sectorKeywords: Record<string, string[]> = {
    energy: ["grid", "utility", "electric", "pipeline", "energy", "power"],
    healthcare: ["hospital", "clinical", "patient", "healthcare", "medical"],
    finance: ["bank", "payment", "financial", "trading", "finance"],
    government: ["federal", "agency", "government", "public sector"],
    infrastructure: ["critical infrastructure", "infrastructure", "ot", "ics"],
    technology: ["cloud", "software", "saas", "platform", "technology"]
  }

  const keywords = sectorKeywords[sectorKey]
  if (!keywords) return items

  return items.filter((item) => {
    const metadataText =
      item.metadata && typeof item.metadata === "object"
        ? JSON.stringify(item.metadata)
        : ""

    const haystack = `${item.name} ${item.description} ${item.category} ${metadataText}`

    return containsAny(haystack, keywords)
  })
}
