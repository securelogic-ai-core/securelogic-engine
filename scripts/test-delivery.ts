import { pg } from "../src/api/infra/postgres.js";
import { sendNewsletter } from "../services/intelligence-worker/src/delivery/sendNewsletter.js";

const ISSUE_ID = "1eedf885-4485-46c0-b710-45904ce9976a";
const EMAIL = "thecrystians@gmail.com";

// 1. Set subscriber tier to 'paid' so it qualifies for standard-tier issues
await pg.query(
  `UPDATE subscribers SET tier = 'paid', status = 'active' WHERE LOWER(email) = LOWER($1)`,
  [EMAIL]
);
console.log("Subscriber tier updated to paid");

// 2. Insert a queued delivery record for this issue + email
const delivery = await pg.query(
  `INSERT INTO newsletter_deliveries (organization_id, issue_id, subscriber_email, status, created_at)
   VALUES (NULL, $1, $2, 'queued', NOW())
   ON CONFLICT (issue_id, subscriber_email) DO UPDATE SET status = 'queued'
   RETURNING id, subscriber_email, status`,
  [ISSUE_ID, EMAIL]
);
console.log("Delivery record:", delivery.rows[0]);

// 3. Send (drains queued deliveries for this issue)
const sendResult = await sendNewsletter(ISSUE_ID);
console.log("Send result:", JSON.stringify(sendResult, null, 2));

await pg.end();
