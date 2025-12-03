import { RawFrameworkControl } from "../../types/v2/Control";
import { CanonicalControl } from "../../types/v2/Control";

/**
 * CanonicalizationEngine (v2)
 *
 * Converts raw framework controls (NIST, ISO, SOC2, CIS, etc.)
 * into a unified CanonicalControl representation.
 *
 * Zero AI. Zero inference. 100% deterministic mapping.
 */
export class CanonicalizationEngine {

  /**
   * Entry point
   */
  static canonicalize(raw: RawFrameworkControl[]): CanonicalControl[] {
    return raw.map(control => this.toCanonical(control));
  }

  /**
   * Converts a raw framework control to CanonicalControl.
   * All fields must map cleanly to the v2 types.
   */
  private static toCanonical(c: RawFrameworkControl): CanonicalControl {
    return {
      canonicalId: c.id,
      canonicalTitle: c.title,
      canonicalDescription: c.description,
      canonicalDomain: c.domain || "General",
      canonicalKeywords: c.keywords || [],
      frameworks: [c.framework],
      baselineImpact: c.baselineImpact ?? 1,
      baselineLikelihood: c.baselineLikelihood ?? 1
    };
  }

}
