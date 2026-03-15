import { db } from "./services/intelligence-worker/src/storage/db";

db.prepare(`
INSERT INTO newsletter_issues
(title, content_html, created_at, status)
VALUES (?, ?, ?, ?)
`).run(
  "SecureLogic Weekly Intelligence #1",
  "<p>This is the first SecureLogic intelligence briefing.</p>",
  new Date().toISOString(),
  "sent"
);

console.log("Issue inserted.");
