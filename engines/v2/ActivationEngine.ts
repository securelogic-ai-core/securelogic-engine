import {
  RawIntakeSubmission,
  NormalizedIntake
} from "../../types/v2/Intake";

import { CatalogControl } from "../../types/v2/Control";

/**
 * ActivationEngine (v2)
 *
 * - Normalizes intake (clean, deterministic)
 * - Activates catalog controls based on keywords
 * - Zero AI. Zero inference. Fully auditable.
 */
export class ActivationEngine {

  /**
   * Main entry point used by RunnerEngine
   */
  static run(
    intake: RawIntakeSubmission,
    catalog: CatalogControl[]
  ): { intake: NormalizedIntake; activated: CatalogControl[] } {

    const normalized = this.normalize(intake);
    const activated = this.activate(normalized, catalog);

    return { intake: normalized, activated };
  }

  /**
   * Normalize RawIntakeSubmission → NormalizedIntake
   */
  static normalize(input: RawIntakeSubmission): NormalizedIntake {
    const triggers = (input.triggers || [])
      .map(t => t.trim().toLowerCase())
      .filter(t => t.length > 0);

    return {
      triggers,
      frameworks: input.frameworks || [],
      domains: input.domains || [],
      controlIds: input.controlIds || [],
      size: input.size || "medium",
      industry: input.industry
    };
  }

  /**
   * Deterministic activation based strictly on keyword matches.
   */
  static activate(
    intake: NormalizedIntake,
    catalog: CatalogControl[]
  ): CatalogControl[] {

    const activated: CatalogControl[] = [];

    for (const control of catalog) {
      const keywords = control.keywords.map(k => k.toLowerCase());

      // Activate control if ANY keyword matches ANY trigger
      const match = keywords.some(k => intake.triggers.includes(k));

      if (match) {
        activated.push(control);
      }
    }

    return activated;
  }
}
