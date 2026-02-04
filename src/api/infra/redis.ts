import { createClient } from "redis";
import { logger } from "./logger.js";

const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  throw new Error("REDIS_URL is not set");
}

export const redis = createClient({
  url: REDIS_URL,
  socket: {
    reconnectStrategy: retries => {
      logger.warn({ retries }, "Redis reconnect attempt");
      return Math.min(retries * 100, 2000);
    }
  }
});

export let redisReady = false;

redis.on("ready", () => {
  redisReady = true;
  logger.info("Redis ready");
});

redis.on("end", () => {
  redisReady = false;
  logger.warn("Redis connection closed");
});

redis.on("error", err => {
  redisReady = false;
  logger.error({ err }, "Redis error");
});

/**
 * Fire-and-forget connection
 * MUST NOT block process startup
 */
(async () => {
  try {
    await redis.connect();
  } catch (err) {
    logger.error({ err }, "Initial Redis connection failed");
  }
})();