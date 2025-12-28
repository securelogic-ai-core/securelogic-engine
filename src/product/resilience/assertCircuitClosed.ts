import type { CircuitBreakerV1 } from "./CircuitBreakerV1";

export function assertCircuitClosed(cb: CircuitBreakerV1): void {
  if (cb.open || cb.failures >= cb.threshold) {
    throw new Error("CIRCUIT_OPEN");
  }
}
