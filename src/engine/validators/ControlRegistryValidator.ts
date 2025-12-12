import { ControlRegistry } from "../registry/ControlRegistry";
import { ControlStateFactory } from "../factories/ControlStateFactory";
import { extractControlPaths } from "../utils/extractControlPaths";

export class ControlRegistryValidator {
  static validate(): void {
    const state = ControlStateFactory.create();
    const statePaths = extractControlPaths(state);
    const registryPaths = Object.keys(ControlRegistry.controls);

    const missingInRegistry = statePaths.filter(
      p => !registryPaths.includes(p)
    );

    const extraInRegistry = registryPaths.filter(
      p => !statePaths.includes(p)
    );

    if (missingInRegistry.length || extraInRegistry.length) {
      throw new Error(
        [
          missingInRegistry.length
            ? `Missing in registry:\n${missingInRegistry.join("\n")}`
            : "",
          extraInRegistry.length
            ? `Extra in registry:\n${extraInRegistry.join("\n")}`
            : ""
        ].filter(Boolean).join("\n\n")
      );
    }
  }
}
