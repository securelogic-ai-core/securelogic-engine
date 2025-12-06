export class RiskNarrativeEngine {
  static generate(
    score: { likelihood: number; impact: number },
    signals: any
  ) {
    const narrative: string[] = [];

    if (signals?.missingPolicies?.length) {
      narrative.push(
        "Likelihood increased due to missing policies: " +
          signals.missingPolicies.join(", ") +
          "."
      );
    }

    if (signals?.riskIndicators?.length) {
      narrative.push(
        "Impact increased due to risk indicators: " +
          signals.riskIndicators.join(", ") +
          "."
      );
    }

    if (signals?.foundControls?.length) {
      narrative.push(
        "Likelihood decreased due to implemented controls: " +
          signals.foundControls.join(", ") +
          "."
      );
    }

    if (narrative.length === 0) {
      narrative.push("No ingestion-based risk adjustments were detected.");
    }

    return narrative;
  }
}
