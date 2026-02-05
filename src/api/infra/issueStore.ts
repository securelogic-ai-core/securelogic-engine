import { ensureRedisConnected, redisReady } from "./redis.js";

export async function getLatestIssueNumber(): Promise<number> {
  if (!redisReady) return 0;
  const redis = await ensureRedisConnected();
  const v = await redis.get("issues:latest");
  return v ? Number(v) : 0;
}
