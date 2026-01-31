import { ScoredSignal } from "../contract/ScoredSignal";
import { TimeBucket } from "./TimeBucket";

export function applyBucket(
  signals: ScoredSignal[],
  bucket: TimeBucket
): ScoredSignal[] {
  const now = Date.now();

  const windowMs =
    bucket === "REALTIME" ? 60 * 60 * 1000 :       // 1 hour
    bucket === "DAILY"    ? 24 * 60 * 60 * 1000 :  // 24 hours
                            7 * 24 * 60 * 60 * 1000; // 7 days

  return signals.filter(s => {
    const published = new Date(s.publishedAt).getTime();
    return now - published <= windowMs;
  });
}
