import { pg } from "../infra/postgres";

export async function connectDatabase(): Promise<void> {
  const client = await pg.connect();

  try {
    await client.query("SELECT 1");
    console.log("Postgres connectivity confirmed");
  } catch (err) {
    console.error("Postgres connection failed");
    throw err;
  } finally {
    client.release();
  }
}
