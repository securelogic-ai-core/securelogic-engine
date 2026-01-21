import type { Finding, RiskLevel } from "../../reporting/ReportSchema.js";

const severityRank: Record<RiskLevel, number> = {
  Low: 1,
  Moderate: 2,
  High: 3,
  Critical: 4
};

export class FindingNormalizer {
  static normalize(findings: Finding[]): Finding[] {
    const map = new Map<string, Finding>();

    for (const f of findings) {
      const existing = map.get(f.id);

      if (!existing) {
        map.set(f.id, { ...f });
        continue;
      }

      const mergedFrameworks = new Set([
        ...existing.mappedFrameworks,
        ...f.mappedFrameworks
      ]);

      const severity =
        severityRank[f.severity] > severityRank[existing.severity]
          ? f.severity
          : existing.severity;

      map.set(f.id, {
        ...existing,
        severity,
        mappedFrameworks: Array.from(mergedFrameworks)
      });
    }

    return Array.from(map.values());
  }
}
