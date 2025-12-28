import type { PolicyContextV1 } from "./PolicyContextV1";
import type { PolicyDecision } from "./PolicyDecision";

export function evaluatePolicy(
  ctx: PolicyContextV1,
  action: string
): PolicyDecision {
  if (!ctx.tenantId || !ctx.actorId) return "deny";
  if (ctx.roles.includes("admin")) return "allow";
  return "deny";
}
