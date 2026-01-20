import type { EngineResult } from "./EngineResult.js";

export interface SecureLogicResult {
  version: string;
  producedAt: string;
  result: EngineResult;
}
