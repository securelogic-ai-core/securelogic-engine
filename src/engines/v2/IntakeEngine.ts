import { RawIntakeSubmission, NormalizedIntake } from "../../types/v2/Intake";

export class IntakeEngine {
  static normalize(input: RawIntakeSubmission): NormalizedIntake {
    return {
      size: input.size ?? "small",
      triggers: (input.triggers ?? []).map(x => x.toLowerCase()),
      frameworks: (input.frameworks ?? []).map(x => x.toLowerCase()),
      domains: (input.domains ?? []).map(x => x.toLowerCase()),
      controlIds: (input.controlIds ?? []).map(x => x.toLowerCase())
    };
  }
}
