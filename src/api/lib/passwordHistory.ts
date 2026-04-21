import argon2 from "argon2";
import type { Pool } from "pg";

const HISTORY_CHECK_DEPTH = 5;
const HISTORY_KEEP_DEPTH  = 10;

export async function checkPasswordReuse(
  userId: string,
  newPassword: string,
  pg: Pool
): Promise<boolean> {
  try {
    const result = await pg.query<{ password_hash: string }>(
      `SELECT password_hash
       FROM password_history
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, HISTORY_CHECK_DEPTH]
    );

    for (const row of result.rows) {
      try {
        if (await argon2.verify(row.password_hash, newPassword)) return true;
      } catch {
        // corrupted hash — skip
      }
    }
    return false;
  } catch {
    return false;
  }
}

export async function recordPasswordHash(
  userId: string,
  hashedPassword: string,
  pg: Pool
): Promise<void> {
  try {
    await pg.query(
      `INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)`,
      [userId, hashedPassword]
    );
    await pg.query(
      `DELETE FROM password_history
       WHERE user_id = $1
         AND id NOT IN (
           SELECT id FROM password_history
           WHERE user_id = $1
           ORDER BY created_at DESC
           LIMIT $2
         )`,
      [userId, HISTORY_KEEP_DEPTH]
    );
  } catch {
    // silent — history failure must never block a password change
  }
}
