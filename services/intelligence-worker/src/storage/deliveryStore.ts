import { db } from "./db";

export function recordDelivery(issueId: number, email: string, status: string) {

  const stmt = db.prepare(`
    INSERT INTO newsletter_deliveries
    (issue_id, subscriber_email, delivered_at, status)
    VALUES (?, ?, ?, ?)
  `);

  stmt.run(
    issueId,
    email,
    new Date().toISOString(),
    status
  );
}
