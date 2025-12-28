export interface RateLimitPolicyV1 {
  subjectId: string;
  maxRequests: number;
  windowSeconds: number;
}
