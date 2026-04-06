import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";

export async function connectDatabase(): Promise<void> {
  const client = await pg.connect();

  try {
    await client.query("SELECT 1");
    logger.info({ event: "db_connected" }, "Postgres connectivity confirmed");
  } catch (err) {
    logger.error({ event: "db_connect_failed", err }, "Postgres connection failed");
    throw err;
  } finally {
    client.release();
  }
}
