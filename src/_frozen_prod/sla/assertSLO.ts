import type { SLOV1 } from "./SLOV1";

export function assertSLO(slo: SLOV1, actual: number): void {
  if (actual < slo.target) {
    throw new Error(`SLO_BREACH:${slo.metric}`);
  }
}
