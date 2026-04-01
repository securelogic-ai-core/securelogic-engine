import { db } from "../infra/db.ts";

export function createSession(sessionId: string, userId: string, expiresAt: string) {
  db.prepare(`
    INSERT INTO admin_sessions (id, user_id, expires_at)
    VALUES (?, ?, ?)
  `).run(sessionId, userId, expiresAt);
}

export function getSession(sessionId: string) {
  return db.prepare(`
    SELECT id, user_id, expires_at
    FROM admin_sessions
    WHERE id = ?
  `).get(sessionId);
}

export function deleteSession(sessionId: string) {
  db.prepare(`
    DELETE FROM admin_sessions WHERE id = ?
  `).run(sessionId);
}
