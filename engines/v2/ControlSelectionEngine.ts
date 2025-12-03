import { CanonicalControl } from "../../types/v2/Control";
import { IntakeFilters } from "../../types/v2/Intake";

/**
 * ControlSelectionEngine (v2)
 *
 * Deterministic filtering of canonical controls based on:
 * - selected frameworks
 * - selected domains
 * - selected control IDs
 * - intake-driven business rules
 *
 * Zero AI. Fully auditable.
 */
export class ControlSelectionEngine {

  /**
   * Entry point used by RunnerEngine (v2)
   */
  static select(
    catalog: CanonicalControl[],
    filters: IntakeFilters
  ): CanonicalControl[] {

    let selected = [...catalog];

    // Filter by framework(s)
    if (filters.frameworks && filters.frameworks.length > 0) {
      selected = selected.filter(c =>
        filters.frameworks.some(f => c.frameworks.includes(f))
      );
    }

    // Filter by domain(s)
    if (filters.domains && filters.domains.length > 0) {
      selected = selected.filter(c =>
        filters.domains.includes(c.canonicalDomain)
      );
    }

    // Filter by explicit control IDs
    if (filters.controlIds && filters.controlIds.length > 0) {
      selected = selected.filter(c =>
        filters.controlIds.includes(c.canonicalId)
      );
    }

    return selected;
  }

}
