import type { Finding } from "../../reporting/ReportSchema.js";

export type FrameworkCoverage = {
  framework: string;
  findingCount: number;
};

export class ControlCoverageEngine {
  static summarize(findings: Finding[]): FrameworkCoverage[] {
    const counts: Record<string, number> = {};

    for (const f of findings) {
      for (const fw of f.mappedFrameworks ?? []) {
        counts[fw] = (counts[fw] ?? 0) + 1;
      }
    }

    return Object.entries(counts).map(([framework, findingCount]) => ({
      framework,
      findingCount
    }));
  }
}
