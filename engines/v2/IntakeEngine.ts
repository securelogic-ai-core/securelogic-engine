import { RawIntakeSubmission, NormalizedIntake } from "../../types/v2/Intake";

export class IntakeEngine {
  static normalize(input: RawIntakeSubmission): NormalizedIntake {
    return {
      size: input.size ?? "small",
      industry: input.industry?.toLowerCase() ?? undefined,
      triggers: (input.triggers ?? []).map(t => t.trim().toLowerCase()),

      // REQUIRED BY NormalizedIntake
      frameworks: input.frameworks ?? [],
      domains: input.domains ?? [],
      controlIds: input.controlIds ?? [],
    };
  }
}
