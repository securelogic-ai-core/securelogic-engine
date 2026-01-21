import { FrameworkRegistry } from "../registry/FrameworkRegistry.js";

export class FrameworkLabeler {
  static label(keys: string[]): string[] {
    return keys.map(k => FrameworkRegistry[k]?.code ?? k);
  }
}
