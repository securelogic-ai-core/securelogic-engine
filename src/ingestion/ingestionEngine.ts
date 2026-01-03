import { PolicyExtractor } from "./policyExtractor.js";
import { ControlDetector } from "./controlDetector.js";
import { RiskIndicatorMapper } from "./riskIndicatorMapper.js";

export class IngestionEngine {
  static processDocument(text: string) {
    const { found, missing } = PolicyExtractor.extract(text);
    const controls = ControlDetector.detect(text);
    const risks = RiskIndicatorMapper.map(text);

    return {
      missingPolicies: missing,
      foundControls: controls,
      riskIndicators: risks
    };
  }

  static processAll(documents: { extractedText?: string | null }[]) {
    const aggregate = {
      missingPolicies: new Set<string>(),
      foundControls: new Set<string>(),
      riskIndicators: new Set<string>()
    };

    for (const doc of documents) {
      if (!doc.extractedText) continue;

      const signals = this.processDocument(doc.extractedText);

      signals.missingPolicies.forEach(p => aggregate.missingPolicies.add(p));
      signals.foundControls.forEach(c => aggregate.foundControls.add(c));
      signals.riskIndicators.forEach(r => aggregate.riskIndicators.add(r));
    }

    return {
      missingPolicies: Array.from(aggregate.missingPolicies),
      foundControls: Array.from(aggregate.foundControls),
      riskIndicators: Array.from(aggregate.riskIndicators)
    };
  }
}
