import type { RunnerEngine } from "../contracts/EngineInput.js";

export type AuditSprintResponseV1 = {
  version: "v1";
} & ReturnType<typeof RunnerEngine.run>;
