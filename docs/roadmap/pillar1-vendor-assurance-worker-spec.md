# Pillar 1 — Vendor-Assurance Durable Extraction Worker — Build Spec

**Status:** Finalized — decisions locked (operator, 2026-06-20). Spec only; no code written, no
prod changes. Build is a separate, authorized package.
**Roadmap anchor:** `docs/roadmap/four-pillar-build-roadmap.md` — Pillar 1, Option B
(build the durable worker properly *before* prod enablement, rather than a bounded beta on
the in-process runner).
**Date:** 2026-06-20

---

## 0. One-paragraph summary

The vendor SOC-extraction pipeline works, but it runs **in-process via `setImmediate`** and
its own author wrote *"do not promote this runner to production."* An engine redeploy (every
`main` commit) kills any in-flight extraction and strands the document in `extracting` forever —
no retry, no sweep, re-upload is the only recovery. This spec replaces that runner with a
**dedicated durable worker service** that mirrors the existing `securelogic-data-rights-worker`
**almost exactly** — same generic `jobs` queue, same `FOR UPDATE SKIP LOCKED` claim, same
retry/backoff/dead-letter policy, same SIGTERM drain, same R2 env shape. This is a **reuse**
job, not a new design. The route stops calling `setImmediate` and instead **enqueues a job**;
the worker claims and executes it out-of-process so a redeploy leaves the work recoverable. The
same package also **fixes the entitlement gate** (rank 2 → rank 4 / Platform), so the feature is
never live in prod at the wrong tier — the gate is the first instance of the rank-4 precedent
for all four pillars.

---

## A. The problem (with file/line references)

### A.1 The runner is an explicit staging-only compromise

`src/api/lib/vendorAssuranceExtractionRunner.ts:1-20` (header comment, verbatim):

> Phase 1 staging-first compromise. In-process, single-document, bounded-volume execution
> model. Production-grade architecture (durable queue, dedicated worker, retry policy,
> concurrency control) is an explicit follow-on package. **Do not promote this runner to
> production without that work.**
> …
> No re-extraction flow exists. A failed document requires re-upload to retry. The
> status-transition path is one-way.

### A.2 How it is triggered today

- Upload route `POST /api/vendor-assurance/documents` →
  `src/api/routes/vendorAssuranceDocuments.ts:306-311` calls `scheduleExtraction(...)` and
  immediately returns `202`.
- `scheduleExtraction()` (`vendorAssuranceExtractionRunner.ts:313-321`) is just
  `setImmediate(() => void runExtraction(args))` — **fire-and-forget on the web process event
  loop.** No durable record that work is owed.

### A.3 What `runExtraction` does, step by step

`runExtraction()` — `vendorAssuranceExtractionRunner.ts:184-306`:

1. `markExtracting()` — `UPDATE vendor_assurance_documents SET processing_status='extracting'`
   (`:42-48`), audit `vendor_assurance.extraction.started`.
2. Fetch PDF from R2 — `getVendorAssurancePdfStream()`
   (`vendorAssuranceStorage.ts`), key `org/{orgId}/vendor-assurance/{documentId}/original.pdf`.
   Fail → `markFailed(..., "pdf_unparseable")` (`:209`).
3. Extract text — `extractPdfText()` via `pdf-parse` (`vendorAssurancePdfExtractor.ts`),
   `MIN_TEXT_CHARS=200`. Fail → `pdf_image_only` / `pdf_unparseable` (`:216`).
4. Claude SOC extraction — `runSocExtraction()` (`claudeSocExtractor.ts:54-143`), model
   `claude-sonnet-4-6`, prompt `soc-extraction-v2`, **reads `ANTHROPIC_API_KEY` in this
   process** (`:69`). Fail → `llm_unavailable` / `llm_failed` / `llm_invalid_json` (`:227-234`).
5. Persist — `persistExtractionAndMarkExtracted()` (`:93-176`), one `withTenant` txn:
   INSERT `vendor_assurance_extractions` + bulk INSERT `vendor_assurance_extraction_spans`
   + UPDATE doc → `extracted`, COMMIT.
6. CUEC mapping — `refreshCuecMappingsForDocument()` (`vendorAssuranceCuecMatcher.ts`),
   **non-fatal**, fire-and-forget after the extraction commit (`:275-286`). Same Claude model.

### A.4 The state machine and the redeploy-kill failure

Document status column `vendor_assurance_documents.processing_status` (CHECK in
`db/migrations/20260610_vendor_assurance_documents.sql`, extended by `20260612...`):
`pending → extracting → extracted | extraction_failed` (plus downstream review states
`approved` / `manual_review_requested` / `rejected`).

**The hole:** if the process dies while a row is `extracting` (redeploy, OOM, crash before any
`markFailed`), the row stays `extracting` with NULL error columns **permanently**. There is:

- **no durable job record** — `setImmediate` work simply vanishes;
- **no retry** — the transition path is one-way by design (`:19`);
- **no timeout sweep / cron** that moves stale `extracting` rows out;
- **no concurrency control** — N simultaneous uploads = N parallel Claude calls, no cap.

Recovery today is **re-upload only** (creates a new row). On Render, every `main` commit
redeploys the engine web service, so this is not a rare edge — it is the expected outcome of
any deploy that lands during an extraction.

---

## B. Target architecture

### B.1 The decisive finding — the infrastructure already exists

We do **not** need to invent a queue. `src/api/workers/dataRightsWorker.ts` + the generic
`jobs` table (`db/migrations/20260621_gdpr_foundations.sql:116-143`) are a complete,
production-shaped, tenant-isolation-correct blueprint already running as
`securelogic-data-rights-worker` (`render.yaml:505-544`). The vendor-extraction worker should
be a near-copy of it.

The `jobs` table already carries everything we need:

```
id, organization_id, requested_by_user_id,
job_type  CHECK (...),                 -- extend with a vendor-extraction type
status    CHECK ('queued'|'processing'|'succeeded'|'failed'|'dead_lettered'),
scheduled_for, attempts, max_attempts (default 5), next_attempt_at,
payload JSONB, result JSONB, error TEXT,
locked_by, locked_at, created_at, updated_at, completed_at
```

### B.2 The claim — copy verbatim, change only the job-type filter

`dataRightsWorker.ts:105-132` `CLAIM_SQL` does exactly what we need and is the canonical
pattern in this repo:

```sql
UPDATE jobs SET status='processing', locked_by=$1, locked_at=now(),
                attempts=attempts+1, updated_at=now()
 WHERE id = ( SELECT id FROM jobs
               WHERE job_type = ANY($2::text[])
                 AND ( (status='queued'      AND scheduled_for <= now())
                    OR (status='processing'  AND locked_at < now() - ($3 * interval '1 ms')) )
               ORDER BY scheduled_for
               FOR UPDATE SKIP LOCKED LIMIT 1 )
 RETURNING ...
```

- **No double-processing:** `FOR UPDATE SKIP LOCKED` makes two worker instances unable to
  claim the same row.
- **Crash recovery is built in:** the `OR status='processing' AND locked_at < now() - timeout`
  arm **reclaims a job whose worker died** — this is precisely the redeploy-kill recovery the
  in-process runner lacks. `LOCK_TIMEOUT_MS = 15 min` (`dataRightsWorkerPolicy.ts:17`).
- **Claim runs on `pgElevated`** (owner channel) because a context-less poller on the tenant
  channel would see zero rows post-RLS-flip (`dataRightsWorker.ts:12-17`). Everything *after*
  the claim runs inside `withTenant(orgId)` so it is RLS-correct and provably single-org.

### B.3 Retry / backoff / dead-letter — reuse the policy module wholesale

`dataRightsWorkerPolicy.ts` is DB-free and directly reusable:

- `decideFailureState(job, err, now)` → `failed` (NonRetryable, terminal) /
  `dead_lettered` (attempts ≥ max) / `queued` (requeue at `now + backoff`).
- `backoffMs(attempts)` → exponential `1m,2m,4m,…` capped at `MAX_BACKOFF_MS=60m`.
- **Failure semantics (settled):** permanent input faults are **TERMINAL** — `pdf_image_only`
  and `llm_invalid_json` throw `NonRetryableJobError` → status `failed`, surfaced to the user,
  **never retried** (re-running cannot help; retrying only burns attempts + Claude credits).
  Retries exist **only for transient faults** — worker restart / redeploy reclaim, R2 blip,
  network, `llm_failed`/`llm_unavailable` — which requeue with backoff and, if attempts
  exhaust, land in `dead_lettered` for a human. The document's `extraction_failed` row keeps
  its `processing_error_code` so the existing UI failure surface is unchanged.

### B.4 The worker service shape (mirror `data-rights-worker`)

- `services/vendor-extraction-worker/src/index.ts` — poll loop with single-flight guard +
  **SIGTERM/SIGINT drain** (copy `data-rights-worker/src/index.ts`: `POLL_INTERVAL_MS≈15s`,
  `SHUTDOWN_DRAIN_MS≈30s`, `isRunning`/`shuttingDown` flags, `runOneTick({shouldContinue})`).
  On SIGTERM it **stops claiming, drains the in-flight job, then exits** — and anything it
  can't finish in the drain window is reclaimed via the visibility timeout. This is the whole
  point: **a redeploy can no longer strand work.**
- `services/vendor-extraction-worker/tsconfig.json` — compiles to
  `dist-vendor-extraction-worker/...`, includes the shared `src/api/...` paths it imports.
- `src/api/workers/vendorExtractionWorker.ts` — `claimNextJob` / `processClaimedJob` /
  `runOneTick`, structurally identical to `dataRightsWorker.ts`. `processClaimedJob` calls the
  **existing** extraction logic — we keep `runSocExtraction`, `extractPdfText`,
  `persistExtractionAndMarkExtracted`, `refreshCuecMappingsForDocument` and only change *what
  drives them* (a claimed job, not `setImmediate`).

### B.5 What changes in the request path

- `uploadVendorAssuranceDocument` stops calling `scheduleExtraction(...)`
  (`vendorAssuranceDocuments.ts:306-311`) and instead `INSERT`s a `jobs` row
  (`job_type='vendor_assurance_extract'`, `payload={documentId, documentTypeHint}`,
  `organization_id`, `requested_by_user_id`). Still returns `202` immediately.
- The document row is still created `pending`; the **worker** flips it `pending→extracting`
  on claim, so document status stays a faithful mirror of job progress.

### B.6 How a redeploy now leaves work recoverable (before → after)

| Scenario | In-process runner (today) | Durable worker (target) |
|---|---|---|
| Deploy lands mid-extraction | Doc stuck `extracting` forever, no record | Job stays `processing`; reclaimed after 15-min visibility timeout, retried |
| Claude transient error | `extraction_failed`, re-upload only | Requeue with backoff, up to `max_attempts`, then `dead_lettered` |
| Two uploads at once | N parallel Claude calls, uncapped | Serialized by claim; single serial instance → strictly one at a time (natural spend cap) |
| Worker process crash | n/a (no worker) | Lock expires, next poll reclaims the job |

### B.7 Idempotency — HARD REQUIREMENT (must have a test)

`vendor_assurance_extractions.document_id` is **UNIQUE** (one extraction per document). With
retries, a job that **crashes after the persist COMMIT but before marking the job succeeded**
will be reclaimed and re-run — and the re-run's INSERT will hit the unique constraint. The
persist step (`:93-176`) is a single all-or-nothing txn, so a crash *before* COMMIT is clean
(no row, retry fine); the dangerous window is *after* COMMIT.

**Requirement (not optional):** `processClaimedJob` MUST treat an already-existing
`vendor_assurance_extractions` row for the document as an **idempotent success** — mark the job
`succeeded` and return — NOT as a failure and NOT as a duplicate-INSERT error. Concretely: the
persist either uses `ON CONFLICT (document_id) DO NOTHING` (or a pre-check `SELECT`) and, when
the row already exists, the worker still drives the document to `extracted` and the job to
`succeeded`. Terminal state is written in the same `withTenant` txn, mirroring the
`data-rights` `recordSuccess` discipline.

**Test (required, gates the worker-core commit):** a unit test that runs `processClaimedJob`
twice against the same document (simulating a reclaim after a committed persist) and asserts
the second run ends `succeeded` with exactly one extraction row — no unique-violation, no
`failed`/`dead_lettered`. This is the load-bearing proof that the retry machinery cannot
corrupt a completed extraction.

---

## C. Production prerequisites (folded in from the prior flag investigation)

These apply **regardless** of the worker — they are what makes vendor-assurance work in prod
at all. The worker adds a sixth `DATABASE_URL` holder and moves the Claude call off the web
process onto the worker. Source: memory `project_vendor_assurance_prod_flip`.

1. **R2 on the prod worker (and engine web).** Phase 0 shipped R2 to **staging only**
   (`render.yaml` notes prod R2 intentionally unconfigured). The new worker block needs the 5
   `R2_*` vars populated in the dashboard (it streams the PDF *from* R2). Without it, fetch →
   failure. Engine web still needs R2 for the **upload** path.
2. **`ANTHROPIC_API_KEY` — worker-only (settled).** Today the SOC extractor reads the key **in
   the web process** (`claudeSocExtractor.ts:69`); prod engine web has **no**
   `ANTHROPIC_API_KEY` set. Once extraction moves to the worker, **the key lives on the new
   worker service only** (like the intelligence-worker already does) and is **removed from the
   engine web service** — the web process no longer makes the Claude call, so it no longer
   needs the key. This shrinks the key's blast radius to the one service that uses it.
   Precondition before removing from web: confirm no *other* web-path feature reads
   `ANTHROPIC_API_KEY` (grep at build time); vendor-assurance is the only web consumer today.
3. **The feature flag.** `SECURELOGIC_VENDOR_ASSURANCE_ENABLED=true` on the prod **engine web**
   service (staging sets it at `render.yaml:271`; prod omits it →
   `vendorAssuranceFeatureFlag.ts` returns 404). The flag gates the *routes*; flipping it is
   still required for prod even with the worker built.
4. **Migrations.** Engine `startCommand` auto-runs `npm run migrate` on deploy (idempotent).
   The new `jobs.job_type` CHECK extension (settled: reuse the generic `jobs` table, §F.2)
   ships as a migration; confirm it applies on the worker's first deploy and on engine web.
5. **Deps** (`@aws-sdk/client-s3`, `exceljs`, `multer`, `pdf-parse`, `@anthropic-ai/sdk`) are
   already in `package.json` — no new dependency work.

---

## D. Entitlement-gate reconciliation (SETTLED — ships in this package)

The roadmap's cross-cutting rule ("verify the gate before you furnish the room") applies here.
This is a real mismatch, and it is now **decided**.

**Decision: vendor-assurance gates at rank 4 / premium (Platform).** This is the **precedent**:
*all four platform pillars gate at rank 4*, and this is the **first instance of fixing the
documented entitlement inversion** (the $39 Brief-Pro tier accidentally unlocking the platform
at the API level). Vendor / third-party risk is a Platform pillar, not a Brief-Pro feature.

The current state being fixed:

- Every vendor-assurance route is gated `requireEntitlement("standard")`
  (`vendorAssuranceDocuments.ts` header; mirrors `vendors.ts`).
- `requireEntitlement.ts:1-49` ranks: `starter=1`, **`standard`=`professional`=2**,
  `premium`(`platform`/`team`)=4. So vendor-assurance currently unlocks at **rank 2** — the
  **$39 Brief-Pro tier**.

**Required change, and the timing is non-negotiable:** change the gate from
`requireEntitlement("standard")` to `requireEntitlement("premium")` across the ~15
vendor-assurance routes (and `vendors.ts`, so the vendor surface stays consistent), and
reconcile against the app's UI redirect logic. This change **ships AS PART OF this build, in
the same package as the worker — not deferred.** There must be **no window in which the feature
is enabled in production at rank 2.** Sequencing consequence (see §E): the gate change lands
and soaks in staging *before* the prod feature-flag flip, so the very first moment
vendor-assurance is reachable in prod, it is already gated at rank 4.

It remains a **distinct commit** within the package (gate change vs. worker code are reviewable
separately), but they are one coherent, co-shipped unit — the flip step must not run until the
gate commit is in.

---

## E. Build sequence (one coherent package, staged before any prod enablement)

The worker build **and** the entitlement-gate change (§D) are **one package** — they soak
together in staging, and **no prod enablement happens until both are in and proven**. Each step
is its own gated commit (no commits without authorization). Steps 1–7 contain **zero prod
changes**; step 8 is the only prod-touching boundary and requires separate authorization.

**Package part 1 — worker + gate (staging only):**

1. **Migration: queue the job type.** Extend `jobs.job_type` CHECK with
   `vendor_assurance_extract` (reuse the generic `jobs` table — settled, §F.2; no new table).
   *Testable:* migration applies up; a hand-INSERTed job row is visible.
2. **Worker core** `src/api/workers/vendorExtractionWorker.ts` (claim/process/tick), reusing
   `dataRightsWorkerPolicy.ts`. `processClaimedJob` wraps the existing extraction steps and
   **satisfies the §B.7 idempotency requirement**. *Testable:* unit tests with injected seams
   (no R2 / no Claude), exactly like the data-rights policy/executor split — assert claim,
   success terminal write, requeue-with-backoff (transient), **terminal `failed` on
   `pdf_image_only`/`llm_invalid_json` (no retry)**, dead-letter, and **the required
   idempotent-reclaim test (§B.7)**.
3. **Worker service** `services/vendor-extraction-worker/` (`index.ts` + `tsconfig.json`),
   copied from `data-rights-worker`, single serial instance, with SIGTERM drain. *Testable:*
   `tsc -p` builds to `dist-vendor-extraction-worker/`; boots locally against a dev DB and
   drains a queued job.
4. **Route flip to enqueue.** `uploadVendorAssuranceDocument` enqueues a `jobs` row instead of
   `setImmediate(scheduleExtraction)`. Keep `scheduleExtraction` deletable but isolated.
   *Testable:* upload → a `queued` job row exists; web process does **no** Claude work.
5. **Entitlement-gate change (§D), in this package.** `requireEntitlement("standard")` →
   `requireEntitlement("premium")` across the ~15 vendor-assurance routes + `vendors.ts`;
   reconcile the app UI redirect. *Testable:* a rank-2 (Brief-Pro) API key now gets `403
   insufficient_entitlement` on vendor-assurance routes; rank-4 (premium) gets through.
   **Distinct commit, same PR/package** — establishes the rank-4 precedent for all pillars.
6. **render.yaml: two worker blocks** (prod `oregon` + staging `virginia` twin, in lockstep,
   per the repo's worker convention and `feedback_render_region_pin_rule`), env =
   `NODE_ENV`, `DATABASE_URL`, 5×`R2_*`, `ANTHROPIC_API_KEY` (**worker-only**, §C.2),
   `LOG_LEVEL`. Staging tracks `develop`. *Testable:* staging worker auto-deploys, claims a
   real upload end-to-end (upload → extract → CUEC map → export) against staging R2 + Anthropic,
   at the rank-4 gate.
7. **Staging soak + kill test + dead-letter + idempotency.** Upload a real SOC PDF, **redeploy
   the staging worker mid-extraction**, confirm the job is reclaimed and completes (the exact
   scenario that strands the in-process runner). Verify: terminal `failed` on a forced
   image-only/invalid-JSON doc (no retry); `dead_lettered` on a forced-transient-permanent
   failure; idempotent re-run leaves exactly one extraction. Add **queue-depth alerting**
   (settled §F.4) and confirm it fires. This is the gate before any prod step.

**Package part 2 — prod enablement (separate authorization, after part 1 soaks green):**

8. **Prod prerequisites** (Section C) — R2 on prod worker, `ANTHROPIC_API_KEY` on prod worker
   **and removed from engine web**, verify migration applied. Then flip
   `SECURELOGIC_VENDOR_ASSURANCE_ENABLED=true` on prod engine web and smoke-test with a real
   SOC document. Because the rank-4 gate (step 5) is already deployed, the **first moment**
   the feature is reachable in prod it is already gated at Platform — **no rank-2 window**.

Per `BUILD_SEQUENCE.md` discipline: stop after package part 1 (steps 1–7), present exact commit
scope, and do not begin part 2 (the prod flip) without separate explicit authorization.

---

## F. Settled decisions

All decisions below are **locked** (operator, 2026-06-20). They are folded into the relevant
sections above; collected here for reference.

1. **Entitlement tier: rank 4 / premium (Platform).** This sets the **precedent — all four
   platform pillars gate at rank 4** — and is the **first instance of fixing the documented
   entitlement inversion**. The `standard → premium` gate change ships **as part of this
   build** (§D, §E step 5), not deferred; there must be **no window** where the feature is
   enabled in prod at rank 2.

2. **Jobs queue: reuse the generic `jobs` table** with a new `vendor_assurance_extract`
   `job_type` (§B.1, §E step 1). **No new queue table.** The table already has
   attempts/lock/backoff columns, indexes, and the claim SQL; the data-rights worker ignores
   the new type via its type filter.

3. **Concurrency: single serial worker instance to start** (`plan: starter`, §B.4, §E step 3).
   Mirrors every existing worker and gives a natural per-platform Claude-spend cap. Revisit
   only if throughput hurts post-launch.

4. **Volume: no hard per-org cap.** Add **queue-depth alerting** instead (§E step 7) so a
   backlog or runaway is visible without throttling legitimate use.

5. **Failure semantics: `pdf_image_only` and `llm_invalid_json` are TERMINAL** —
   `NonRetryableJobError` → status `failed`, surfaced to the user, **never retried** (§B.3).
   Retries are for **transient** faults only (worker restart / redeploy reclaim, network, R2
   blip, `llm_failed`/`llm_unavailable`), which back off and end in `dead_lettered` at max
   attempts.

6. **`ANTHROPIC_API_KEY`: worker-only.** Set on the new worker service; **removed from the
   engine web service** once the Claude call moves to the worker — web no longer needs it
   (§C.2). Precondition: grep-confirm no other web-path feature reads the key before removal.

### Hard requirement (not a decision — a correctness gate)

- **Idempotency (§B.7):** `processClaimedJob` MUST treat an existing
  `vendor_assurance_extractions` row (UNIQUE `document_id`) as **idempotent success**, not a
  failure or duplicate-INSERT error. **A test for the reclaim-after-commit case gates the
  worker-core commit.**

---

## G. Explicitly NOT in this package

- No pricing finalization (roadmap defers it; only the *gate correctness* is in scope).
- No new vendor features (concentration risk, nth-party cascade — separate Pillar 1 tasks).
- No webhook-retry / outbox work (the dead `scheduleRetry` loop is a separate finding).
- No touching the data-rights worker (only used as a copy source).
- No prod flip until the worker + gate are soaked in staging incl. the redeploy-kill test
  (§E step 7); the prod flip is package part 2 and needs separate authorization.
