import { ControlRegistry } from "../registry/ControlRegistry.js";
import { ControlStateFactory } from "../factories/ControlStateFactory.js";

function extractPaths(obj: any, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object"
      ? extractPaths(v, prefix ? `${prefix}.${k}` : k)
      : [`${prefix}.${k}`]
  );
}

export class SystemInvariantValidator {
  static validate(): void {
    const state = ControlStateFactory.create();
    const statePaths = extractPaths(state);
    const registryPaths = Object.keys(ControlRegistry.controls);

    const missing = registryPaths.filter(p => !statePaths.includes(p));
    const extra = statePaths.filter(p => !registryPaths.includes(p));

    if (missing.length || extra.length) {
      throw new Error(
        [
          "SYSTEM INVARIANT VIOLATION",
          missing.length ? `Missing:\n${missing.join("\n")}` : "",
          extra.length ? `Extra:\n${extra.join("\n")}` : ""
        ].filter(Boolean).join("\n\n")
      );
    }
  }
}
