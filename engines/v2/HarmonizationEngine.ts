import { CanonicalControl } from "../../types/v2/Control";
import { HarmonizedGroup } from "../../types/v2/Harmonization";

/**
 * HarmonizationEngine (v2)
 *
 * Groups canonical controls by domain with deterministic ordering.
 * No mutations. No assumptions. Fully auditable.
 */
export class HarmonizationEngine {

  static harmonize(controls: CanonicalControl[]): HarmonizedGroup[] {

    const domains: Record<string, HarmonizedGroup> = {};

    for (const c of controls) {
      const domain = c.canonicalDomain || "Uncategorized";

      if (!domains[domain]) {
        domains[domain] = {
          domain,
          controls: []
        };
      }

      domains[domain].controls.push(c);
    }

    // Enforce deterministic ordering (important for testing + audit)
    return Object.values(domains)
      .sort((a, b) => a.domain.localeCompare(b.domain))
      .map(group => ({
        ...group,
        controls: group.controls.sort((a, b) =>
          a.canonicalId.localeCompare(b.canonicalId)
        )
      }));
  }

}
