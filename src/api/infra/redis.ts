import { createClient } from "redis";
import { logger } from "./logger.js";

const RAW_REDIS_URL = process.env.REDIS_URL ?? "";
const REDIS_URL = RAW_REDIS_URL.trim();

/**
 * redisReady means:
 * - configuration exists
 * - NOT that Redis is reachable
 */
export const redisReady = REDIS_URL.length > 0;

export type RedisClient = ReturnType<typeof createClient>;

let redisClient: RedisClient | null = null;
let connectPromise: Promise<RedisClient> | null = null;

const CONNECT_TIMEOUT_MS = 1500;

function buildRedisClient(): RedisClient {
  if (!redisReady) {
    throw new Error("Redis is not configured (missing REDIS_URL)");
  }

  const client = createClient({
    url: REDIS_URL,
    socket: {
      /**
       * Enterprise:
       * - bounded backoff
       * - no infinite tight reconnect loops
       */
      reconnectStrategy: (retries: number) => {
        if (retries <= 0) return 100;
        if (retries >= 25) return 2000;
        return Math.min(100 * retries, 2000);
      }
    }
  });

  client.on("error", (err: unknown) => {
    logger.error({ err }, "Redis client error");
  });

  client.on("connect", () => {
    logger.info("Redis socket connected");
  });

  client.on("ready", () => {
    logger.info("Redis client ready");
  });

  client.on("end", () => {
    logger.warn("Redis connection ended");
  });

  return client;
}

export function getRedis(): RedisClient {
  if (!redisClient) {
    redisClient = buildRedisClient();
  }
  return redisClient;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new Error("Redis connect timeout"));
      }, timeoutMs).unref();
    })
  ]);
}

/**
 * Enterprise-grade:
 * - single connect promise (prevents stampede)
 * - bounded retries controlled by reconnectStrategy
 * - hard timeout prevents request hangs / 504s
 * - connect errors reset connectPromise so future attempts can retry
 */
export async function ensureRedisConnected(): Promise<RedisClient> {
  if (!redisReady) {
    throw new Error("Redis not configured (missing REDIS_URL)");
  }

  const client = getRedis();

  if (client.isOpen) return client;

  if (!connectPromise) {
    connectPromise = withTimeout(client.connect().then(() => client), CONNECT_TIMEOUT_MS)
      .catch((err) => {
        connectPromise = null;
        logger.error({ err }, "Redis connect failed");
        throw err;
      });
  }

  return connectPromise;
}