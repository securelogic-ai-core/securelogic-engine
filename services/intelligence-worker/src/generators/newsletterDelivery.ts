import { pg } from "../../../../src/api/infra/postgres.js";

type Issue = {
  id: string
  organization_id: string
}

type Subscriber = {
  email: string
}

async function getDefaultOrganizationId(): Promise<string> {
  const result = await pg.query(`
    SELECT id
    FROM organizations
    ORDER BY created_at ASC
    LIMIT 1
  `)

  const organizationId = result.rows[0]?.id as string | undefined

  if (!organizationId) {
    throw new Error("No organization found for newsletter delivery")
  }

  return organizationId
}

export async function deliverNewsletter(): Promise<number> {
  const organizationId = await getDefaultOrganizationId()

  const issueResult = await pg.query(
    `
    SELECT id, organization_id
    FROM newsletter_issues
    WHERE organization_id = $1
      AND status = 'draft'
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [organizationId]
  )

  const issue = issueResult.rows[0] as Issue | undefined

  if (!issue) {
    return 0
  }

  const subscriberResult = await pg.query(
    `
    SELECT email
    FROM subscribers
    WHERE organization_id = $1
      AND status = 'active'
    ORDER BY created_at ASC
    `,
    [organizationId]
  )

  const subscribers = subscriberResult.rows as Subscriber[]
  let deliveries = 0

  for (const subscriber of subscribers) {
    const existing = await pg.query(
      `
      SELECT id
      FROM newsletter_deliveries
      WHERE issue_id = $1
        AND subscriber_email = $2
      LIMIT 1
      `,
      [issue.id, subscriber.email]
    )

    if (existing.rows.length === 0) {
      await pg.query(
        `
        INSERT INTO newsletter_deliveries (
          organization_id,
          issue_id,
          subscriber_email,
          status,
          created_at
        )
        VALUES ($1,$2,$3,$4,NOW())
        `,
        [organizationId, issue.id, subscriber.email, "queued"]
      )

      deliveries++
    }
  }

  await pg.query(
    `
    UPDATE newsletter_issues
    SET status = 'queued', updated_at = NOW()
    WHERE id = $1
    `,
    [issue.id]
  )

  return deliveries
}
