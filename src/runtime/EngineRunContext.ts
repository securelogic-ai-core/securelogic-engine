import { ConfidenceScoringContext } from "../engine/scoring/ConfidenceScoringContext.js";

export class EngineRunContext {
  readonly confidence: ConfidenceScoringContext;

  constructor() {
    this.confidence = new ConfidenceScoringContext();
  }
}
