import type { EvidenceItem, Finding, ConfidenceLevel } from "../../reporting/ReportSchema.js";

export type EvidenceSummary = {
  totalEvidenceItems: number;
  bySource: Record<string, number>;
  averageConfidenceScore: number;
  confidenceDistribution: Record<ConfidenceLevel, number>;
  narrative: string;
};

export class EvidenceCollector {
  static summarize(findings: Finding[]): EvidenceSummary {
    const bySource: Record<string, number> = {};
    const confidenceDistribution: Record<ConfidenceLevel, number> = {
      Low: 0,
      Medium: 0,
      High: 0,
      "Very High": 0
    };

    let totalEvidenceItems = 0;
    let totalConfidenceScore = 0;
    let confidenceCount = 0;

    for (const f of findings) {
      confidenceDistribution[f.confidence] = (confidenceDistribution[f.confidence] ?? 0) + 1;

      totalConfidenceScore += f.confidenceScore ?? 0;
      confidenceCount += 1;

      const items: EvidenceItem[] = f.evidenceItems ?? [];
      totalEvidenceItems += items.length;

      for (const e of items) {
        const src = (e.source ?? "Unknown").trim() || "Unknown";
        bySource[src] = (bySource[src] ?? 0) + 1;
      }
    }

    const averageConfidenceScore = (function(){ const __v = confidenceCount > 0 ? Math.round(totalConfidenceScore / confidenceCount) : undefined; return (__v ?? 0); })();

    const narrative = EvidenceCollector.buildNarrative(totalEvidenceItems, bySource, averageConfidenceScore);

    return {
      totalEvidenceItems,
      bySource,
      averageConfidenceScore,
      confidenceDistribution,
      narrative
    };
  }

  static buildNarrative(total: number, bySource: Record<string, number>, avg?: number): string {
    const top = Object.entries(bySource)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");

    if (total === 0) {
      return "No evidence items were attached to findings; confidence is necessarily low.";
    }

    const avgTxt = typeof avg === "number" ? ` Average confidence score: ${avg}.` : "";
    const topTxt = top ? ` Top evidence sources: ${top}.` : "";

    // Enterprise honesty: self-attestation should be called out explicitly
    const hasQuestionnaire = (bySource["Questionnaire"] ?? 0) > 0;
    const warning = hasQuestionnaire
      ? " Evidence is primarily self-attested questionnaire responses; confidence will remain low until validated with artifacts (policies, configs, logs, tickets)."
      : "";

    return `Total evidence items attached: ${total}.${avgTxt}${topTxt}${warning}`;
  }
}
