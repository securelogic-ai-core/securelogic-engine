import { RawFrameworkControl, CanonicalControl } from "../../types/v2/Control";

export class CanonicalizationEngine {

  static canonicalize(controls: RawFrameworkControl[]): CanonicalControl[] {
    return controls.map(c => ({
      canonicalId: c.id,
      canonicalDomain: c.domain ?? "General",
      canonicalTitle: c.title,
      canonicalDescription: c.description,
      canonicalKeywords: c.keywords ?? [],
      baselineImpact: c.baselineImpact ?? 1,
      baselineLikelihood: c.baselineLikelihood ?? 1
    }));
  }

}
