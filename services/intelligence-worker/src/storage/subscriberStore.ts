import { pg } from "../../../../src/api/infra/postgres.js";

export async function addSubscriber(email: string, tier: string = "free") {
  await pg.query(
    `
    INSERT INTO subscribers (email, tier, status, created_at)
    VALUES ($1, $2, 'active', NOW())
    ON CONFLICT (email) DO NOTHING
    `,
    [email, tier]
  );
}

export async function getSubscribers() {
  const result = await pg.query(
    `
    SELECT *
    FROM subscribers
    WHERE status = 'active'
    ORDER BY created_at DESC
    `
  );

  return result.rows;
}