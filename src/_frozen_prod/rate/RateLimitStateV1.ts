export interface RateLimitStateV1 {
  key: string;
  windowStart: number;
  count: number;
  limit: number;
}
