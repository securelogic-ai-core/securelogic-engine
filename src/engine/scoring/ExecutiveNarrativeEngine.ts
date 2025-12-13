import { EnterpriseRiskSummary } from "../contracts/EnterpriseRiskSummary";

export class ExecutiveNarrativeEngine {
  static generate(summary: EnterpriseRiskSummary): string {
    const drivers =
      summary.topRiskDrivers && summary.topRiskDrivers.length > 0
        ? summary.topRiskDrivers.join(", ")
        : "no dominant risk drivers identified";

    switch (summary.severity) {
      case "Critical":
        return (
          "Critical AI risk exposure detected. Immediate executive intervention " +
          `is required. Key drivers include: ${drivers}.`
        );

      case "High":
        return (
          "Elevated AI risk requires prioritized remediation and executive " +
          `oversight. Key drivers include: ${drivers}.`
        );

      case "Moderate":
        return (
          "Moderate AI risk exposure identified. Targeted control improvements " +
          `are recommended. Key drivers include: ${drivers}.`
        );

      case "Low":
      default:
        return (
          "The organization demonstrates a generally controlled AI risk posture. " +
          `Key risk drivers include: ${drivers}.`
        );
    }
  }
}