import { createClient, type RedisClientType } from "redis";

const REDIS_URL = process.env.REDIS_URL;

// Render/build-safe: export flags immediately
export const redisReady = Boolean(REDIS_URL);

// Always export `redis` so imports don’t explode at compile time.
// If REDIS_URL is missing, we create a “dead” client that should never be used
// because requireRedis should block requests when redisReady=false.
export const redis: RedisClientType = createClient({
  url: REDIS_URL ?? "redis://invalid",
  socket: {
    reconnectStrategy: (retries: number) => {
      // backoff up to 2s
      return Math.min(retries * 100, 2000);
    }
  }
});

if (redisReady) {
  redis.on("error", (err: unknown) => {
    // eslint-disable-next-line no-console
    console.error("Redis error", err);
  });

  // Connect at boot; requireRedis will also guard
  redis.connect().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error("Redis connect failed", err);
  });
}