import { pg } from "../../../../src/api/infra/postgres.js";

type QueuedIssue = {
  id: string;
  organization_id: string;
  title: string;
};

type Subscriber = {
  email: string;
};

export type NewsletterDeliveryResult = {
  issuesScanned: number;
  subscribersScanned: number;
  deliveriesCreated: number;
  deliveriesSkippedExisting: number;
  deliveriesSkippedSuppressed: number;
  deliveriesSkippedInactive: number;
};

export async function generateNewsletterDeliveries(): Promise<NewsletterDeliveryResult> {
  let issuesScanned = 0;
  let subscribersScanned = 0;
  let deliveriesCreated = 0;
  let deliveriesSkippedExisting = 0;
  let deliveriesSkippedSuppressed = 0;
  let deliveriesSkippedInactive = 0;

  const issuesResult = await pg.query(`
    SELECT id, organization_id, title
    FROM newsletter_issues
    WHERE status = 'queued'
  `);

  const issues: QueuedIssue[] = issuesResult.rows;
  issuesScanned = issues.length;

  for (const issue of issues) {
    const activeSubscribersResult = await pg.query(
      `
      SELECT s.email
      FROM subscribers s
      LEFT JOIN email_suppressions es
        ON LOWER(es.email) = LOWER(s.email)
      WHERE s.organization_id = $1
        AND s.status = 'active'
        AND es.id IS NULL
      `,
      [issue.organization_id]
    );

    const suppressedCountResult = await pg.query(
      `
      SELECT COUNT(*)::int AS count
      FROM subscribers s
      JOIN email_suppressions es
        ON LOWER(es.email) = LOWER(s.email)
      WHERE s.organization_id = $1
        AND s.status = 'active'
      `,
      [issue.organization_id]
    );

    const inactiveCountResult = await pg.query(
      `
      SELECT COUNT(*)::int AS count
      FROM subscribers s
      WHERE s.organization_id = $1
        AND s.status <> 'active'
      `,
      [issue.organization_id]
    );

    const subscribers: Subscriber[] = activeSubscribersResult.rows;
    subscribersScanned += subscribers.length;
    deliveriesSkippedSuppressed += Number(suppressedCountResult.rows[0]?.count ?? 0);
    deliveriesSkippedInactive += Number(inactiveCountResult.rows[0]?.count ?? 0);

    for (const sub of subscribers) {
      const email = String(sub.email).trim().toLowerCase();

      const result = await pg.query(
        `
        INSERT INTO newsletter_deliveries (
          organization_id,
          issue_id,
          subscriber_email,
          status,
          created_at
        )
        VALUES ($1, $2, $3, 'queued', NOW())
        ON CONFLICT (issue_id, subscriber_email) DO NOTHING
        RETURNING id
        `,
        [issue.organization_id, issue.id, email]
      );

      if ((result.rowCount ?? 0) > 0) {
        deliveriesCreated++;
      } else {
        deliveriesSkippedExisting++;
      }
    }
  }

  console.log("Newsletter delivery generation complete");
  console.log("issues_scanned:", issuesScanned);
  console.log("subscribers_scanned:", subscribersScanned);
  console.log("deliveries_created:", deliveriesCreated);
  console.log("deliveries_skipped_existing:", deliveriesSkippedExisting);
  console.log("deliveries_skipped_suppressed:", deliveriesSkippedSuppressed);
  console.log("deliveries_skipped_inactive:", deliveriesSkippedInactive);

  return {
    issuesScanned,
    subscribersScanned,
    deliveriesCreated,
    deliveriesSkippedExisting,
    deliveriesSkippedSuppressed,
    deliveriesSkippedInactive
  };
}
