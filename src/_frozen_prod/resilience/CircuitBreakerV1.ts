export interface CircuitBreakerV1 {
  failures: number;
  threshold: number;
  open: boolean;
}
