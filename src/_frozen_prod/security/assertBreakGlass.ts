import type { BreakGlassEventV1 } from "./BreakGlassEventV1";

export function assertBreakGlass(event: BreakGlassEventV1): void {
  if (!event.reason || !event.approvedBy) {
    throw new Error("INVALID_BREAK_GLASS_EVENT");
  }
}
