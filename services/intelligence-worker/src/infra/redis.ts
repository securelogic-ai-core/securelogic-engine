import { createClient } from "redis";
import { ENV } from "../config/env.js";

export const redis = createClient({
  url: ENV.REDIS_URL
});

redis.on("error", (err) => {
  console.error("Redis error", err);
  process.exit(1);
});

await redis.connect();
