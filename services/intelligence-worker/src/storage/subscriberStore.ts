import { db } from "./db";

export function addSubscriber(email: string, tier: string = "free") {

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO subscribers
    (email, tier, status, created_at)
    VALUES (?, ?, ?, ?)
  `);

  stmt.run(
    email,
    tier,
    "active",
    new Date().toISOString()
  );
}

export function getSubscribers() {

  return db.prepare(`
    SELECT *
    FROM subscribers
    WHERE status='active'
  `).all();

}
