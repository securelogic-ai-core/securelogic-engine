import { pg } from "../../../../src/api/infra/postgres.js";

export async function recordDelivery(
  issueId: number,
  email: string,
  status: string
) {
  await pg.query(
    `
    INSERT INTO newsletter_deliveries
    (issue_id, subscriber_email, delivered_at, status)
    VALUES ($1, $2, $3, $4)
    `,
    [issueId, email, new Date().toISOString(), status]
  );
}
