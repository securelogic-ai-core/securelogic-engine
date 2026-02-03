import { createClient } from "redis";
import type { RedisClientType } from "redis";

if (!process.env.REDIS_URL) {
  console.error("❌ REDIS_URL is not set");
  process.exit(1);
}

export const redis: RedisClientType = createClient({
  url: process.env.REDIS_URL
});

redis.on("error", (err: Error) => {
  console.error("❌ Redis error:", err.message);
});

(async () => {
  try {
    await redis.connect();
    console.log("✅ Redis connected");
  } catch (err) {
    console.error("❌ Failed to connect to Redis");
    process.exit(1);
  }
})();