import type { BreakGlassAccessV1 } from "./BreakGlassAccessV1";

export function assertBreakGlass(bg: BreakGlassAccessV1): void {
  if (new Date(bg.expiresAt).getTime() <= Date.now()) {
    throw new Error("BREAK_GLASS_EXPIRED");
  }
}
