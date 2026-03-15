import { db } from "../storage/db";

export function createIssue(title: string, md: string, html: string) {
  const stmt = db.prepare(`
    INSERT INTO newsletter_issues
    (title, content_md, content_html, status, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    title,
    md,
    html,
    "draft",
    new Date().toISOString()
  );

  return result.lastInsertRowid;
}

export function getLatestIssue() {
  return db.prepare(`
    SELECT * FROM newsletter_issues
    ORDER BY created_at DESC
    LIMIT 1
  `).get();
}

export function markIssueSent(id: number) {
  db.prepare(`
    UPDATE newsletter_issues
    SET status='sent'
    WHERE id=?
  `).run(id);
}
