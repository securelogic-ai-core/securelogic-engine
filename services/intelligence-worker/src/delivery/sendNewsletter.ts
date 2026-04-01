import { Resend } from "resend";
import { getSubscribers } from "../storage/subscriberStore.js";
import { pg } from "../../../../src/api/infra/postgres.js";

const resend = new Resend(process.env.RESEND_API_KEY);

type Subscriber = {
  email: string;
};

async function recordDelivery(issueId: string, email: string, status: string) {
  await pg.query(
    `
    INSERT INTO newsletter_deliveries
    (issue_id, subscriber_email, delivered_at, status)
    VALUES ($1, $2, NOW(), $3)
    `,
    [issueId, email, status]
  );
}

export async function sendNewsletter(issue: {
  id: string | number;
  title: string;
  content_html?: string;
  contentHtml?: string;
}) {
  const subscribers = (await getSubscribers()) as Subscriber[];

  for (const sub of subscribers) {
    try {
      await resend.emails.send({
        from: process.env.NEWSLETTER_FROM_EMAIL!,
        to: sub.email,
        subject: issue.title,
        html: issue.content_html ?? issue.contentHtml ?? ""
      });

      await recordDelivery(String(issue.id), sub.email, "sent");
    } catch {
      await recordDelivery(String(issue.id), sub.email, "failed");
    }
  }
}