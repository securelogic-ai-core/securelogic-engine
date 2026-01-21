import type { EngineInput } from "../RunnerEngine.js";
import type { FrameworkRunner, FrameworkResult } from "../frameworks/FrameworkRunner.js";
import type { Finding } from "../../reporting/ReportSchema.js";

export class MultiFrameworkOrchestrator {
  constructor(private frameworks: FrameworkRunner[]) {}

  async runAll(input: EngineInput): Promise<FrameworkResult[]> {
    const results = await Promise.all(
      this.frameworks.map(fw => fw.run(input))
    );

    // Global deduplication by control ID
    const seen = new Set<string>();

    const dedupedResults: FrameworkResult[] = results.map(fr => {
      const uniqueFindings: Finding[] = [];

      for (const f of fr.findings) {
        if (!seen.has(f.id)) {
          seen.add(f.id);
          uniqueFindings.push(f);
        }
      }

      return {
        framework: fr.framework,
        findings: uniqueFindings
      };
    });

    return dedupedResults;
  }
}
