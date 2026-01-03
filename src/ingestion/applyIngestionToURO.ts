import { IngestionEngine } from "./ingestionEngine.js";
import type { UnifiedRiskObject } from "../types/URO.js";

export function applyIngestionToURO(uro: UnifiedRiskObject): UnifiedRiskObject {
  if (!uro.documents || uro.documents.length === 0) {
    uro.signals = {
      missingPolicies: [],
      foundControls: [],
      riskIndicators: []
    };
    return uro;
  }

  const signals = IngestionEngine.processAll(uro.documents);

  uro.signals = signals;
  return uro;
}
