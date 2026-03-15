import { db } from "../storage/db";

export function publishIssue(issueId:number){

  db.prepare(`
    UPDATE newsletter_issues
    SET status='sent'
    WHERE id=?
  `).run(issueId);

  console.log("Issue published:", issueId);

}
