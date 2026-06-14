# GDPR data-subject-rights — PR #3 Phase 0 (data-rights worker, EXPORT-ONLY)

Workstream: `gdpr-data-subject-rights` (O-10). This records the locked Phase 0
decisions for the async data-rights worker. Read alongside
`db/migrations/20260621_gdpr_foundations.sql` (the `jobs` + `data_export_files`
schema) and `src/api/services/dataExport/` (the export engine, PR #2a–#2d).

## Scope (locked)

The worker claims and executes **`data_export_self`** and **`data_export_org`**
jobs only. It calls the now-complete `runExport` and streams the bundle to R2.
**Out of scope, left unclaimed (never errored):** `account_deletion_reap`
(deferred until the deletion reaper exists) and `export_file_purge` (the O-11
7-day bundle reaper — a maintenance job, not an export).

## Decisions

- **D-A — Governing doc:** the authorization rides this feature branch (the
  `BUILD_SEQUENCE.md` edit is the first commit), export-only scope.
- **D-1 — Terminal write:** success output is the R2 object + `jobs.result`
  JSONB `{ r2_key, file_size_bytes, scope }` + `status='succeeded'`. The
  `data_export_files` row (download token + expiry + email, O-9) is **deferred
  to the route/intake PR (#5)** — the worker mints no token and writes no
  `data_export_files` row.
- **D-2 — Streaming sink:** `blobStorage.ts` had only a buffered `putObject`. Add
  `@aws-sdk/lib-storage` and a streaming multipart method
  (`createObjectWriteStream`) + a domain wrapper `dataExportStorage.ts` owning
  the key `org/{orgId}/data-exports/{exportId}.zip`. This preserves the export
  engine's bounded-memory streaming all the way to storage.
- **D-3 — Deployment:** two new `render.yaml` worker blocks
  (`securelogic-data-rights-worker` prod=oregon, `-staging`=virginia), `env:
  node`, **NO `npm run migrate`** in startCommand (the engine owns migrations).
  The worker is a **6th `DATABASE_URL` flip-set holder** — recorded in
  `docs/A04-G1-rls-rollout-plan.md` §4a; at the A04-G1 flip it needs the dual
  channel (`DATABASE_URL`→`app_request` for `withTenant` bodies,
  `MIGRATION_DATABASE_URL`→owner for the cross-org claim poll). Prod R2 is not
  yet configured (Phase 0 shipped R2 to staging only), so the prod worker is
  INERT until R2 is populated AND intake (PR #5) enqueues jobs.
- **D-4 — Failure states:** non-retryable → `failed`; retries exhausted →
  `dead_lettered`; transient with attempts left → `queued` with exponential
  backoff.
- **D-5 — Visibility timeout:** a `processing` job whose `locked_at` is older
  than **15 min** is reclaimed by the claim poll (crash recovery).
- **D-6 — Loop:** poll every 15 s, single-flight (`isRunning` guard), SIGTERM/
  SIGINT drain (stop claiming, finish the in-flight job, exit; anything past the
  drain deadline is reclaimed by the visibility timeout).

## Tenant isolation (the A04-G1-adjacent invariant)

- The **claim poll runs on the elevated channel** (`pgElevated`,
  `UPDATE … FOR UPDATE SKIP LOCKED`) — a context-less poller on the tenant
  channel would read zero rows post-flip.
- **Execution, the terminal `jobs` UPDATE, and the `jobs.result` write run inside
  `withTenant(job.organization_id)`** — RLS-correct post-flip, provably
  single-org.
- **`subject.userEmail` for a self-export is read from `users.email` in the DB
  inside `withTenant`, never from `job.payload`** (export trust invariant B).

A cross-org-isolation test (`test/isolation/dataRightsWorker.test.ts`) runs the
real pipeline against Postgres (only the R2 sink is a Buffer seam) and proves:
(a) an org-A job never bundles org-B rows (org_full + self), and (b) a poisoned
payload email never reaches the bundle — the DB email is used.

## Layout

- `src/api/lib/dataRightsWorkerPolicy.ts` — DB-free policy (constants, backoff,
  `decideFailureState`); unit-tested.
- `src/api/workers/dataRightsWorker.ts` — claim / process / record (DB-touching core).
- `src/api/lib/dataExportStorage.ts` + `blobStorage.createObjectWriteStream` —
  the R2 streaming sink.
- `services/data-rights-worker/{tsconfig.json,src/index.ts}` — the thin runner.
