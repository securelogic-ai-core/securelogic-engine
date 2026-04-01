import { pool } from "./storage/db.js";
import { redis } from "./infra/redis.js";

export async function checkHealth() {
  try {
    await pool.query("SELECT 1");
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}
