import { pg } from "./postgres.js"

export async function withAdvisoryLock<T>(
  lockKey: number,
  fn: () => Promise<T>
): Promise<{ acquired: boolean; result: T | null }> {
  const client = await pg.connect()

  try {
    const lockResult = await client.query(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [lockKey]
    )

    const acquired = Boolean(lockResult.rows[0]?.acquired)

    if (!acquired) {
      return {
        acquired: false,
        result: null
      }
    }

    try {
      const result = await fn()
      return {
        acquired: true,
        result
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [lockKey])
    }
  } finally {
    client.release()
  }
}
