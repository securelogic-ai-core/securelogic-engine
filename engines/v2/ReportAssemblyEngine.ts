import { FinalReport } from "../../types/v2/Report";

export class ReportAssemblyEngine {
  static build(input: any): FinalReport {
    return {
      intakeSummary: input.intake,
      harmonized: input.canonical,
      threats: input.threatModel,

      scoring: input.scoring,
      heatmap: input.heatmap,
      roadmap: input.roadmap
    };
  }
}
