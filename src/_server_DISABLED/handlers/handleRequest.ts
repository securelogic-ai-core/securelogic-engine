import { RunnerEngine } from "../../engine/RunnerEngine";
import type { AuditSprintInput } from "../../engine/contracts/AuditSprintInput";

export function handleRequest(input: AuditSprintInput) {
  return RunnerEngine.run(input);
}
