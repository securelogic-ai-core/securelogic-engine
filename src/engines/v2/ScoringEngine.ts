import { ControlsArraySchema } from "../../schema/ControlSchema";

export class ScoringEngine {
  static score(rawControls: any[] = [], intake: any = {}) {

    // Validate controls
    const parsed = ControlsArraySchema.safeParse(rawControls);

    if (!parsed.success) {
      return {
        scored: [],
        highestRisk: null,
        averageRisk: 0,
        narrative: [
          "Control validation failed.",
          JSON.stringify(parsed.error.format(), null, 2)
        ]
      };
    }

    const controls = parsed.data;

    if (controls.length === 0) {
      return {
        scored: [],
        highestRisk: null,
        averageRisk: 0,
        narrative: [
          "No controls were provided. Risk cannot be assessed. Returning baseline result."
        ]
      };
    }

    // Score controls
    const scored = controls.map(ctrl => {
      const risk = ctrl.impact * ctrl.likelihood;
      return {
        ...ctrl,
        domain: ctrl.domain ?? "UNKNOWN",
        title: ctrl.title ?? "Untitled Control",
        risk
      };
    });

    const highestRisk = scored.reduce(
      (a, b) => (b.risk > a.risk ? b : a),
      scored[0]
    );

    const averageRisk =
      scored.reduce((sum, c) => sum + c.risk, 0) / scored.length;

    const narrative: string[] = [];

    if (intake?.signals?.missingPolicies?.length) {
      narrative.push(
        "Likelihood increased due to missing policies: " +
          intake.signals.missingPolicies.join(", ")
      );
    }

    return {
      scored,
      highestRisk,
      averageRisk,
      narrative
    };
  }
}
