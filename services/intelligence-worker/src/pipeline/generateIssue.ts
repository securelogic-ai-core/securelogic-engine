import { db } from "../storage/db";

export function generateIssue(insights:any[]) {

  const title = "SecureLogic Weekly Intelligence #" + Date.now();

  const content = insights.map(i => `
  <h3>${i.title}</h3>
  <p>${i.summary}</p>
  <hr/>
  `).join("");

  const result = db.prepare(`
    INSERT INTO newsletter_issues
    (title,content_html,created_at,status)
    VALUES (?,?,?,?)
  `).run(
    title,
    content,
    new Date().toISOString(),
    "draft"
  );

  return result.lastInsertRowid;
}
