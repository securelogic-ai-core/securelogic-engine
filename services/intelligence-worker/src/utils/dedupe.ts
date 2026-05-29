import { pgElevated } from "../../../../src/api/infra/postgres.js";

/**
 * Check whether a signal has already been ingested into Postgres.
 *
 * Matching strategy (first match wins):
 * 1. external_id match — stable hash-based signal ID from the source feed
 * 2. source + title match — fallback for signals without a URL
 *
 * Replaces the previous filesystem-based check (data/signals.json) which
 * never worked in production because Render's filesystem is ephemeral.
 */
export async function isDuplicateSignal(event: any): Promise<boolean> {
  const externalId: string | null =
    typeof event.signalId === "string" && event.signalId.trim()
      ? event.signalId.trim()
      : null;

  const source: string | null =
    typeof event.source === "string" && event.source.trim()
      ? event.source.trim()
      : null;

  const title: string | null =
    typeof event.title === "string" && event.title.trim()
      ? event.title.trim()
      : null;

  if (!externalId && !title) return false;

  try {
    const result = await pgElevated.query(
      `
      SELECT 1
      FROM signals
      WHERE
        ($1::text IS NOT NULL AND external_id = $1)
        OR
        ($2::text IS NOT NULL AND $3::text IS NOT NULL AND source = $2 AND title = $3)
      LIMIT 1
      `,
      [externalId, source, title]
    );

    return (result.rowCount ?? 0) > 0;
  } catch {
    // Fail-open: if the DB check fails, treat as non-duplicate so signals
    // aren't silently dropped. The ON CONFLICT in saveSignal is the safety net.
    return false;
  }
}
