import type { SlaPolicyV1 } from "./SlaPolicyV1";

export function assertSla(p: SlaPolicyV1): void {
  if (p.uptimePercent < 99.9 || p.maxResponseMs <= 0) {
    throw new Error("SLA_VIOLATION");
  }
}
