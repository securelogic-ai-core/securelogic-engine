import { Router } from "express";
import { pg } from "../infra/postgres.js";

const router = Router();

const RECENT_LIMIT = 10;
const QUERY_TIMEOUT_MS = 1500;

type Row = Record<string, unknown>;

async function runQuery(
  text: string,
  values: unknown[] = []
): Promise<Row[]> {
  const result = await pg.query(text, values);
  return result.rows as Row[];
}

async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(label + "_timeout"));
    }, ms);
  });

  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

router.get("/ops/overview", async (_req, res) => {
  try {
    const [
      recentIssuesSettled,
      deliveryTotalsSettled,
      deadLetterCountSettled,
      suppressionCountSettled,
      recentProviderEventsSettled,
      recentWorkerRunsSettled
    ] = await Promise.allSettled([
      withTimeout(
        runQuery(
          `
          SELECT
            id,
            title,
            status,
            created_at
          FROM newsletter_issues
          ORDER BY created_at DESC, id DESC
          LIMIT $1
          `,
          [RECENT_LIMIT]
        ),
        QUERY_TIMEOUT_MS,
        "recent_issues"
      ),
      withTimeout(
        runQuery(
          `
          SELECT
            COUNT(*)::int AS total_deliveries,
            COUNT(*) FILTER (WHERE status = 'queued')::int AS queued_count,
            COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_count,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count,
            COUNT(*) FILTER (WHERE dead_lettered_at IS NOT NULL)::int AS dead_lettered_count,
            COUNT(*) FILTER (WHERE last_error = 'suppressed_email_blocked')::int AS suppressed_blocked_count
          FROM newsletter_deliveries
          `
        ),
        QUERY_TIMEOUT_MS,
        "delivery_totals"
      ),
      withTimeout(
        runQuery(
          `
          SELECT COUNT(*)::int AS dead_letter_count
          FROM newsletter_deliveries
          WHERE dead_lettered_at IS NOT NULL
          `
        ),
        QUERY_TIMEOUT_MS,
        "dead_letter_count"
      ),
      withTimeout(
        runQuery(
          `
          SELECT COUNT(*)::int AS suppression_count
          FROM email_suppressions
          `
        ),
        QUERY_TIMEOUT_MS,
        "suppression_count"
      ),
      withTimeout(
        runQuery(
          `
          SELECT
            id,
            provider,
            provider_event_id,
            event_type,
            email,
            created_at
          FROM email_provider_events
          ORDER BY created_at DESC, id DESC
          LIMIT $1
          `,
          [RECENT_LIMIT]
        ),
        QUERY_TIMEOUT_MS,
        "recent_provider_events"
      ),
      withTimeout(
        runQuery(
          `
          SELECT
            id,
            worker_name,
            status,
            started_at,
            completed_at,
            duration_ms,
            metadata
          FROM worker_runs
          ORDER BY started_at DESC, id DESC
          LIMIT $1
          `,
          [RECENT_LIMIT]
        ),
        QUERY_TIMEOUT_MS,
        "recent_worker_runs"
      )
    ]);

    const warnings: string[] = [];

    const recentIssues =
      recentIssuesSettled.status === "fulfilled" ? recentIssuesSettled.value : [];
    if (recentIssuesSettled.status !== "fulfilled") {
      warnings.push("recent_issues_unavailable");
      console.error("recentIssues failed:", recentIssuesSettled.reason);
    }

    const deliveryTotalsRow =
      deliveryTotalsSettled.status === "fulfilled"
        ? deliveryTotalsSettled.value[0] ?? {}
        : {};
    if (deliveryTotalsSettled.status !== "fulfilled") {
      warnings.push("delivery_totals_unavailable");
      console.error("deliveryTotals failed:", deliveryTotalsSettled.reason);
    }

    const deadLetterCountRow =
      deadLetterCountSettled.status === "fulfilled"
        ? deadLetterCountSettled.value[0] ?? {}
        : {};
    if (deadLetterCountSettled.status !== "fulfilled") {
      warnings.push("dead_letter_count_unavailable");
      console.error("deadLetterCount failed:", deadLetterCountSettled.reason);
    }

    const suppressionCountRow =
      suppressionCountSettled.status === "fulfilled"
        ? suppressionCountSettled.value[0] ?? {}
        : {};
    if (suppressionCountSettled.status !== "fulfilled") {
      warnings.push("suppression_count_unavailable");
      console.error("suppressionCount failed:", suppressionCountSettled.reason);
    }

    const recentProviderEvents =
      recentProviderEventsSettled.status === "fulfilled"
        ? recentProviderEventsSettled.value
        : [];
    if (recentProviderEventsSettled.status !== "fulfilled") {
      warnings.push("recent_provider_events_unavailable");
      console.error(
        "recentProviderEvents failed:",
        recentProviderEventsSettled.reason
      );
    }

    const recentWorkerRuns =
      recentWorkerRunsSettled.status === "fulfilled"
        ? recentWorkerRunsSettled.value
        : [];
    if (recentWorkerRunsSettled.status !== "fulfilled") {
      warnings.push("recent_worker_runs_unavailable");
      console.error("recentWorkerRuns failed:", recentWorkerRunsSettled.reason);
    }

    res.status(200).json({
      ok: true,
      overview: {
        limits: {
          recentIssues: RECENT_LIMIT,
          recentProviderEvents: RECENT_LIMIT,
          recentWorkerRuns: RECENT_LIMIT
        },
        warnings,
        recentIssues,
        deliveryTotals: {
          total_deliveries: Number(deliveryTotalsRow.total_deliveries ?? 0),
          queued_count: Number(deliveryTotalsRow.queued_count ?? 0),
          sent_count: Number(deliveryTotalsRow.sent_count ?? 0),
          failed_count: Number(deliveryTotalsRow.failed_count ?? 0),
          dead_lettered_count: Number(deliveryTotalsRow.dead_lettered_count ?? 0),
          suppressed_blocked_count: Number(
            deliveryTotalsRow.suppressed_blocked_count ?? 0
          )
        },
        deadLetterCount: Number(deadLetterCountRow.dead_letter_count ?? 0),
        suppressionCount: Number(suppressionCountRow.suppression_count ?? 0),
        recentProviderEvents,
        recentWorkerRuns
      }
    });
  } catch (err) {
    console.error("admin_ops_overview_query_failed:", err);
    res.status(500).json({ error: "admin_ops_overview_query_failed" });
  }
});

export default router;