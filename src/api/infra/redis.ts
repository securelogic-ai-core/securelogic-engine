import { createClient, type RedisClientType } from "redis";

const REDIS_URL = process.env.REDIS_URL;

let redisClient: RedisClientType | null = null;
let connectPromise: Promise<RedisClientType> | null = null;

export const redisReady = Boolean(REDIS_URL);

export function getRedis(): RedisClientType {
  if (!redisClient) {
    if (!REDIS_URL) {
      throw new Error("REDIS_URL is not set");
    }

    redisClient = createClient({
      url: REDIS_URL,
      socket: {
        reconnectStrategy: (retries: number) => Math.min(retries * 100, 2000)
      }
    });

    redisClient.on("error", (err: unknown) => {
      // eslint-disable-next-line no-console
      console.error("Redis error", err);
    });
  }

  return redisClient;
}

export async function ensureRedisConnected(): Promise<RedisClientType> {
  if (!REDIS_URL) {
    throw new Error("REDIS_URL is not set");
  }

  const client = getRedis();

  if (client.isOpen) return client;

  if (!connectPromise) {
    connectPromise = client.connect().then(() => client);
  }

  return connectPromise;
}
