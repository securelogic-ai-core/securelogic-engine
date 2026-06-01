import { pgElevated } from "../../../../src/api/infra/postgres.js";
import { logger } from "../../../../src/api/infra/logger.js";

type QueuedIssue = {
  id: string;
  organization_id: string;
  title: string;
  audience_tier: string;
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

  const issuesResult = await pgElevated.query(`
    SELECT id, organization_id, title, COALESCE(audience_tier, 'free') AS audience_tier
    FROM newsletter_issues
    WHERE status = 'queued'
  `);

  const issues: QueuedIssue[] = issuesResult.rows;
  issuesScanned = issues.length;

  for (const issue of issues) {
    // Determine which subscriber tiers qualify for this issue's audience_tier.
    // premium issues: premium subscribers only.
    // standard issues: standard, paid, and premium subscribers.
    // free issues: all active subscribers.
    const tierFilter =
      issue.audience_tier === "premium"
        ? "AND s.tier IN ('premium')"
        : issue.audience_tier === "standard"
        ? "AND s.tier IN ('standard', 'paid', 'premium')"
        : "";

    // Platform issues (organization_id IS NULL) deliver to all qualifying subscribers.
    // Org-scoped issues deliver only to subscribers belonging to that org.
    const orgFilter = issue.organization_id
      ? "AND s.organization_id = $1"
      : "";
    const orgParam = issue.organization_id ? [issue.organization_id] : [];

    const activeSubscribersResult = await pgElevated.query(
      `
      SELECT s.email
      FROM subscribers s
      LEFT JOIN email_suppressions es
        ON LOWER(es.email) = LOWER(s.email)
      WHERE s.status = 'active'
        AND es.id IS NULL
        ${tierFilter}
        ${orgFilter}
      `,
      orgParam
    );

    const suppressedCountResult = await pgElevated.query(
      `
      SELECT COUNT(*)::int AS count
      FROM subscribers s
      JOIN email_suppressions es
        ON LOWER(es.email) = LOWER(s.email)
      WHERE s.status = 'active'
        ${tierFilter}
        ${orgFilter}
      `,
      orgParam
    );

    const inactiveCountResult = await pgElevated.query(
      `
      SELECT COUNT(*)::int AS count
      FROM subscribers s
      WHERE s.status <> 'active'
        ${tierFilter}
        ${orgFilter}
      `,
      orgParam
    );

    const subscribers: Subscriber[] = activeSubscribersResult.rows;
    subscribersScanned += subscribers.length;
    deliveriesSkippedSuppressed += Number(suppressedCountResult.rows[0]?.count ?? 0);
    deliveriesSkippedInactive += Number(inactiveCountResult.rows[0]?.count ?? 0);

    for (const sub of subscribers) {
      const email = String(sub.email).trim().toLowerCase();

      const result = await pgElevated.query(
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

  logger.info({
    event: "delivery_generation_complete",
    issuesScanned,
    subscribersScanned,
    deliveriesCreated,
    deliveriesSkippedExisting,
    deliveriesSkippedSuppressed,
    deliveriesSkippedInactive
  }, "Newsletter delivery generation complete");

  return {
    issuesScanned,
    subscribersScanned,
    deliveriesCreated,
    deliveriesSkippedExisting,
    deliveriesSkippedSuppressed,
    deliveriesSkippedInactive
  };
}
