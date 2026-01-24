import { ControlRegistry } from "../registry/ControlRegistry.js";
import type { DeepPartial } from "../types/DeepPartial.js";
import type { ControlState } from "../contracts/ControlState.js";

type AnyObject = Record<string, unknown>;

function setPath(obj: AnyObject, path: string, value: unknown) {
  const parts = path.split(".");
  let current: AnyObject = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!key) continue;

    const existing = current[key];

    if (typeof existing !== "object" || existing === null) {
      const next: AnyObject = {};
      current[key] = next;
      current = next;
    } else {
      current = existing as AnyObject;
    }
  }

  const lastKey = parts[parts.length - 1];
  if (!lastKey) return;

  current[lastKey] = value;
}

export class ControlStateFactory {
  static create(
    overrides: DeepPartial<ControlState> = {}
  ): ControlState {
    const base: AnyObject = {};

    for (const path of Object.keys(ControlRegistry.controls)) {
      setPath(base, path, false);
    }

    return deepMerge(base, overrides) as unknown as ControlState;
  }
}

function deepMerge<T extends AnyObject>(target: T, source: DeepPartial<T>): T {
  for (const key in source) {
    const value = source[key];

    if (value && typeof value === "object" && !Array.isArray(value)) {
      const existing =
        typeof target[key] === "object" && target[key] !== null
          ? (target[key] as AnyObject)
          : {};

      target[key] = deepMerge(existing, value as AnyObject) as T[typeof key];
    } else if (value !== undefined) {
      target[key] = value as T[typeof key];
    }
  }

  return target;
}
