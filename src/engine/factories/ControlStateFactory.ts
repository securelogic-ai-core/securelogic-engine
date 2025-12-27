import { ControlRegistry } from "../registry/ControlRegistry";
import type { DeepPartial } from "../types/DeepPartial";
import type { ControlState } from "../contracts/ControlState";

function setPath(obj: any, path: string, value: any) {
  const parts = path.split(".");
  let current: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    current[parts[i]] ??= {};
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

export class ControlStateFactory {
  static create(
    overrides: DeepPartial<ControlState> = {}
  ): ControlState {
    const base: any = {};

    for (const path of Object.keys(ControlRegistry.controls)) {
      setPath(base, path, false);
    }

    return deepMerge(base, overrides) as ControlState;
  }
}

function deepMerge<T>(target: T, source: DeepPartial<T>): T {
  for (const key in source) {
    const value = source[key];
    if (value && typeof value === "object") {
      target[key] = deepMerge(
        (target as any)[key] ?? {},
        value as any
      );
    } else if (value !== undefined) {
      target[key] = value as any;
    }
  }
  return target;
}
