export interface RateLimitV1 {
  subjectId: string;
  limit: number;
  windowMs: number;
}
