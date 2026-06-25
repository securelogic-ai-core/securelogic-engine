# Example: durable async work on the `jobs` queue

Any work that can be retried, must survive a redeploy, or is too slow for the request path
belongs on the generic `jobs` queue — **never** a bare `setImmediate` (that's the
anti-pattern Pillar 1 exists to remove). Reference:
`src/api/workers/dataRightsWorker.ts` + `src/api/workers/vendorExtractionWorker.ts` +
the shared `src/api/lib/dataRightsWorkerPolicy.ts`; runners in
`services/data-rights-worker/` and `services/vendor-extraction-worker/`.

## The architecture (verified)

1. **Enqueue** from a route (instead of doing the work inline):
   ```ts
   await pg.query(
     `INSERT INTO jobs (organization_id, job_type, status, payload, max_attempts)
      VALUES ($1, 'widget_rebuild', 'queued', $2, 5)`,
     [organizationId, JSON.stringify({ widgetId })]
   );
   ```
   (Add `'widget_rebuild'` to the `jobs.job_type` CHECK constraint in a migration first.)

2. **Claim** on `pgElevated` (cross-org) with `FOR UPDATE SKIP LOCKED` + a visibility-timeout
   reclaim of crashed jobs (the shared `LOCK_TIMEOUT_MS` = 15 min):
   ```ts
   const CLAIM_SQL = `
     UPDATE jobs SET status = 'processing', locked_by = $1, locked_at = now()
      WHERE id = (
        SELECT id FROM jobs
         WHERE job_type = $2
           AND (status = 'queued'
                OR (status = 'processing' AND locked_at < now() - ($3 || ' milliseconds')::interval))
           AND (next_attempt_at IS NULL OR next_attempt_at <= now())
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
      RETURNING *`;
   ```

3. **Process inside `withTenant(orgId)`** so all work is org-scoped (and RLS-correct
   post-flip). Resolve any subject identity from the DB inside the scope — **never** trust
   the payload for identity (the self-export poison case).

4. **Decide the terminal state** with the shared policy:
   ```ts
   import { backoffMs, decideFailureState, NonRetryableJobError } from "../lib/dataRightsWorkerPolicy.js";
   // success → status='succeeded', result=JSONB
   // NonRetryableJobError → status='failed'
   // attempts >= max_attempts → status='dead_lettered'
   // else → status='queued', next_attempt_at = now() + backoffMs(attempts)
   ```

5. **Idempotency:** the work must be safe to run twice (a reclaimed job re-runs). Gate on a
   marker (e.g. a unique row, a `succeeded` check, a balance-txn marker) — the spec calls
   this a hard requirement with a "reclaim-after-commit" gating test.

6. **SIGTERM drain** in the runner so a redeploy finishes the in-flight job rather than
   stranding it.

## The runner (`services/widget-worker/src/index.ts`)

A **thin** loop over the testable core in `src/api/workers/widgetWorker.ts`:

```ts
import { claimAndProcessOne } from "../../../src/api/workers/widgetWorker.js";

let draining = false;
process.on("SIGTERM", () => { draining = true; });

async function loop() {
  while (!draining) {
    const did = await claimAndProcessOne();   // returns false when the queue is empty
    if (!did) await sleep(15_000);            // poll interval
  }
  process.exit(0);
}
loop();
```

Keep all logic in `widgetWorker.ts` (unit-testable, mocked `pg`); the runner only wires the
loop, the poll interval, and SIGTERM.

## Deploy
Add prod + staging worker blocks to `render.yaml` (`type: worker`), pin `region:`, build
with its own `tsc -p services/widget-worker/tsconfig.json`, set only the env it needs
(don't add `ANTHROPIC_API_KEY` unless the worker calls the LLM; R2 only if it touches
blobs). Workers do **not** auto-migrate — the engine boot does that.

## Tests
`test/isolation/widgetWorker.test.ts`: claim/reclaim after the visibility timeout,
terminal-vs-retry decision, idempotent re-run, and a cross-org case proving org-A jobs never
touch org-B rows.
