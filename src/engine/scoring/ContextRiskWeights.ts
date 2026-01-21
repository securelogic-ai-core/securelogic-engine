import type { EngineInput } from "../RunnerEngine.js";

/**
 * Returns a bounded context factor between -0.3 and +0.3
 * This represents likelihood/exposure modifier, NOT impact.
 */
export function computeContextFactor(context: EngineInput["context"]): number {
  if (!context) return 0;

  let factor = 0;

  if (context.regulated) factor += 0.10;
  if (context.safetyCritical) factor += 0.10;
  if (context.handlesPII) factor += 0.05;

  if (context.scale === "Enterprise") factor += 0.05;
  if (context.scale === "Medium") factor += 0.02;
  if (context.scale === "Small") factor += 0.00;

  // Clamp to [-0.3, +0.3]
  return Math.max(-0.3, Math.min(0.3, factor));
}
