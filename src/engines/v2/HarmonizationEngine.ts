import { CanonicalControl } from "../../types/v2/Control";

export class HarmonizationEngine {

  static harmonize(canonicalControls: CanonicalControl[]): CanonicalControl[] {
    // v2 Harmonization is intentionally simple:
    // 1. Remove duplicates by canonicalId
    // 2. Return stable list

    const seen = new Set<string>();
    const output: CanonicalControl[] = [];

    for (const c of canonicalControls) {
      if (!seen.has(c.canonicalId)) {
        seen.add(c.canonicalId);
        output.push(c);
      }
    }

    return output;
  }

}
