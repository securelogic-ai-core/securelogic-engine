import type { BreakGlassAccessV1 } from "./BreakGlassAccessV1";

export function assertBreakGlass(access: BreakGlassAccessV1): void {
  if (Date.now() > Date.parse(access.expiresAt)) {
    throw new Error("BREAK_GLASS_EXPIRED");
  }
}
