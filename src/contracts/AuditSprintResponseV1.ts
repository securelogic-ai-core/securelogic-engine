import type { RunnerEngine } from "../engine/RunnerEngine.js";

export type AuditSprintResponseV1 = {
  version: "v1";
} & ReturnType<typeof RunnerEngine.run>;
