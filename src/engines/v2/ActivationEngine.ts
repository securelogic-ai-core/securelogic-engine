import { RawFrameworkControl } from "../../types/v2/Control";
import { NormalizedIntake } from "../../types/v2/Intake";

export class ActivationEngine {
  /**
   * Control is activated if ANY intake trigger matches ANY control triggerTag.
   */
  static activate(intake: NormalizedIntake, catalog: RawFrameworkControl[]): RawFrameworkControl[] {
    const triggers = intake.triggers ?? [];

    return catalog.filter(ctrl => {
      if (!ctrl.triggerTags || ctrl.triggerTags.length === 0) {
        return false; // no triggerTags = cannot activate
      }

      return ctrl.triggerTags.some(tag =>
        triggers.includes(tag.toLowerCase())
      );
    });
  }
}
