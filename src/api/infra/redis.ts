import { createClient } from "redis";
import { logger } from "./logger.js";

const REDIS_URL = process.env.REDIS_URL;

export let redisReady = false;

if (!REDIS_URL) {
  logger.error("REDIS_URL is not set — Redis disabled");
} else {
  export const redis = createClient({
    url: REDIS_URL,
    socket: {
      reconnectStrategy: retries => {
        logger.warn({ retries }, "Redis reconnect attempt");
        return Math.min(retries * 100, 2000);
      }
    }
  });

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

  (async () => {
    try {
      await redis.connect();
    } catch (err) {
      logger.error({ err }, "Initial Redis connection failed");
    }
  })();
}