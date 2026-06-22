# Vendor-Extraction Worker — §E Part 1 Staging Soak Runbook

**Date:** 2026-06-22
**Target service:** `securelogic-vendor-extraction-worker-staging` (deployed, polling — 15s tick)
**Queue-depth alert host (Exercise 5 only):** `securelogic-intelligence-worker-staging`
**Branch under test:** `develop` (= `main`, post-#239/#240 promote)
**Operator:** runs all exercises against **staging**. This file is a fill-in-as-you-go checklist.

> This runbook is read-only documentation. It contains **no code changes**. All "actions" are operator-run against staging.

---

## Verified constants (from code, do not re-guess)

| Fact | Value | Source |
|---|---|---|
| Poll interval (worker tick) | 15 s | `services/vendor-extraction-worker/src/index.ts` |
| Visibility timeout (reclaim threshold) | **15 min** (`LOCK_TIMEOUT_MS`) | `dataRightsWorkerPolicy.ts:17` |
| `max_attempts` default | **5** | `jobs` DDL, `20260621_gdpr_foundations.sql` |
| Backoff per attempt (1-based) | 1m, 2m, 4m, 8m, … cap 60m | `backoffMs`, `dataRightsWorkerPolicy.ts:34` |
| Job type | `vendor_assurance_extract` | `vendorExtractionWorkerPolicy.ts:38` |
| Terminal error codes (→ `failed`, no retry) | `pdf_image_only`, `llm_invalid_json` | `vendorExtractionWorkerPolicy.ts:62` |
| Transient codes (→ retry → `dead_lettered`) | `pdf_unparseable`, `llm_unavailable`, `llm_failed` | same |
| Claim predicate | `status='queued' AND scheduled_for<=now()` **OR** `status='processing' AND locked_at < now()-15min` | `CLAIM_SQL`, `vendorExtractionWorker.ts:130` |
| `attempts` incremented | on every claim | `CLAIM_SQL` |
| Queue-depth threshold | **30** (`queued`+`processing`) | `VENDOR_QUEUE_BACKLOG_THRESHOLD`, `vendorQueueDepthAlert.ts:31` |
| Queue-depth check cadence | every **15 min** + once on intelligence-worker boot | `services/intelligence-worker/src/scheduler.ts:25,38` |
| Dedupe model | rising-edge, re-arms when depth `< 30`; **resets on intelligence-worker restart** | `vendorQueueDepthAlert.ts:33-85` |

**`jobs` columns:** `id, organization_id, requested_by_user_id, job_type, status, scheduled_for, attempts, max_attempts, next_attempt_at, payload, result, error, locked_by, locked_at, created_at, updated_at, completed_at`
**`jobs.status` CHECK:** `queued | processing | succeeded | failed | dead_lettered`
**`vendor_assurance_documents`:** `processing_status (pending|extracting|extracted|extraction_failed|finalized|approved), processing_error_code, processing_error_detail`
**`vendor_assurance_extractions`:** `id, organization_id, document_id, model_id, prompt_version, raw_response_excerpt, fields, created_at` — **`UNIQUE (document_id)`** (`vendor_assurance_extractions_one_per_document`)

### Worker log events you will look for (Render logs → `…-vendor-extraction-worker-staging`)
- `vendor_extraction_worker_start` / `vendor_extraction_worker_shutdown` / `vendor_extraction_worker_shutdown_forced`
- `vendor_extraction_worker_tick_complete` (carries `processed`)
- `vendor_extraction_job_succeeded`
- `vendor_extraction_job_idempotent_success` (extraction already present — **no Claude call**)
- `vendor_extraction_job_failed` (carries `phase`, `error_code`)

### Credential / access notes
- Connect to the **staging** DB with the connection string from the Render dashboard (staging Postgres → Connect). **Do not inline the connection string** in shared shell history; export it into the session or use the dashboard PSQL.
- All queries below are scoped to a single document/job you create — capture the `documentId` / `job id` once and reuse it.
- Helper: set `:doc` / `:job` / `:org` as psql variables, e.g. `psql "$STAGING_URL" -v doc='…' -f -`.

---

## Exercise 1 — Redeploy-kill reclaim (exactly-once after mid-flight kill)

**Goal:** a job killed mid-extraction is reclaimed via the 15-min visibility timeout and finishes **exactly once**.

**Forceability:** ✅ No code change. Needs a real (text-based) SOC PDF + a staging vendor. The 15-min reclaim wait is inherent — an **optional manual DB write** ages `locked_at` to force immediate reclaim.

### Setup
- [ ] Confirm worker is polling: Render logs show `vendor_extraction_worker_start` and periodic ticks.
- [ ] Confirm a staging vendor exists (`SELECT id FROM vendors LIMIT 1;`) and you have a real text-layer SOC PDF.

### Action
1. [ ] Upload the SOC PDF to staging via the engine upload API (vendor-assurance surface; flag is ON for staging engine). Capture the returned `document.id` → `:doc`.
2. [ ] Watch for the job to be claimed (status `processing`, `locked_by` set), then **kill the worker mid-extraction**: Render → `…-vendor-extraction-worker-staging` → Manual Deploy / Restart (sends SIGTERM). Aim to restart while the job is still `processing`.

### Observe (staging SQL)
```sql
-- Job lifecycle for this document
SELECT id, status, attempts, locked_by, locked_at, scheduled_for, completed_at, error
FROM jobs
WHERE job_type = 'vendor_assurance_extract'
  AND payload->>'documentId' = :'doc'
ORDER BY created_at;

-- Exactly-once invariant: extraction rows for this document (expect 1)
SELECT id, document_id, model_id, created_at
FROM vendor_assurance_extractions
WHERE document_id = :'doc';

-- Document end state
SELECT processing_status, processing_error_code
FROM vendor_assurance_documents WHERE id = :'doc';
```
**Optional accelerator (manual DB write — skips the 15-min wait):**
```sql
UPDATE jobs SET locked_at = now() - interval '16 minutes'
WHERE job_type='vendor_assurance_extract' AND payload->>'documentId' = :'doc' AND status='processing';
```
**Logs:** expect `vendor_extraction_worker_shutdown` (the kill), then on reclaim either `vendor_extraction_job_succeeded` **or** `vendor_extraction_job_idempotent_success` (if the kill landed after the extraction committed).

### Pass condition
- [ ] Job reaches `status='succeeded'`, with `attempts >= 2` (claimed, killed, reclaimed).
- [ ] **Exactly one** row in `vendor_assurance_extractions` for `:doc`.
- [ ] Document `processing_status='extracted'`.
- [ ] No evidence of a second successful extraction (single extraction row; if reclaim-after-commit, the `vendor_extraction_job_idempotent_success` log confirms no second Claude call).

**Result:** **PASS** — notes: job killed mid-`processing`, reclaimed via visibility timeout, reached `succeeded` with `attempts>=2`; exactly one `vendor_assurance_extractions` row; document `extracted`; no second Claude call.

---

## Exercise 2 — Forced terminal failure (no retry)

**Goal:** a terminal-classified input → job `failed` with **no retry**, document `extraction_failed`.

**Forceability:** ✅ No code change **if** you have an **image-only / scanned PDF** (no embedded text layer) → `extractPdfText` returns `pdf_image_only` → `TerminalExtractionError`. ⚠️ `llm_invalid_json` (the other terminal code) **cannot be forced deterministically without code/prompt manipulation** — use the image-only path.

### Setup
- [ ] Obtain a scanned/image-only PDF (pages are images, no selectable text). Confirm it passes the upload MIME gate (`application/pdf`).

### Action
1. [ ] Upload the image-only PDF to staging. Capture `document.id` → `:doc`.
2. [ ] Let the worker claim and process it once.

### Observe (staging SQL)
```sql
SELECT id, status, attempts, next_attempt_at, error
FROM jobs
WHERE job_type='vendor_assurance_extract' AND payload->>'documentId' = :'doc';

SELECT processing_status, processing_error_code, processing_error_detail
FROM vendor_assurance_documents WHERE id = :'doc';

-- No extraction should have been written
SELECT count(*) AS extraction_rows
FROM vendor_assurance_extractions WHERE document_id = :'doc';
```
**Logs:** `vendor_extraction_job_failed` with `phase='execute'`, `error_code='pdf_image_only'`.

### Pass condition
- [ ] Job `status='failed'` (**not** `dead_lettered`, **not** requeued).
- [ ] `attempts = 1` and `next_attempt_at IS NULL` (proves no retry was scheduled).
- [ ] Document `processing_status='extraction_failed'`, `processing_error_code='pdf_image_only'`.
- [ ] `extraction_rows = 0`.

**Result:** **PASS** — notes: image-only PDF → `failed` (not `dead_lettered`, not requeued); `attempts=1`, `next_attempt_at IS NULL`; document `extraction_failed` / `pdf_image_only`; 0 extraction rows.

---

## Exercise 3 — Forced transient → dead-letter (max_attempts exhausted)

**Goal:** a repeating transient fault is retried with backoff and lands in `dead_lettered` at `attempts = max_attempts (5)`.

**Forceability:** ⚠️ **Cannot be done by upload alone.** You must force a *recurring* transient fault. Two no-code options, pick one:
- **(a) Storage manipulation (preferred, isolated to the test job):** upload a valid PDF, then **delete/rename its R2 object** before the first claim. `fetchPdf` then fails every attempt → classified `pdf_unparseable` (transient). Affects only this document.
- **(b) Env manipulation (broad side effects — avoid):** temporarily unset `ANTHROPIC_API_KEY` on the worker → every job returns `llm_unavailable`. This breaks **all** jobs, not just the test one. Not recommended during soak.

⚠️ Backoff makes a real run take ~15 min (1+2+4+8). **Manual DB writes recommended to accelerate** (see below). Keep `max_attempts=5` so the full 5-attempt path is exercised; only zero the backoff.

### Setup
- [ ] Upload a valid PDF, capture `document.id` → `:doc`.
- [ ] Apply fault path (a): delete the corresponding R2 object in the **staging** bucket before the worker claims it.

### Action
1. [ ] Let the worker claim/fail, then requeue. Repeat until `attempts` reaches 5.
2. [ ] **Accelerator (manual DB write — zero out backoff after each requeue):**
```sql
UPDATE jobs SET scheduled_for = now()
WHERE job_type='vendor_assurance_extract' AND payload->>'documentId' = :'doc'
  AND status='queued';
```
(Run after each failure, or loop it, so the next claim fires on the 15s tick instead of waiting out the backoff.)

### Observe (staging SQL)
```sql
-- Watch attempts climb and the terminal transition
SELECT id, status, attempts, max_attempts, next_attempt_at, error
FROM jobs
WHERE job_type='vendor_assurance_extract' AND payload->>'documentId' = :'doc';

SELECT processing_status, processing_error_code
FROM vendor_assurance_documents WHERE id = :'doc';
```
**Logs:** repeated `vendor_extraction_job_failed` (`phase='execute'`, `error_code='pdf_unparseable'`), one per attempt.

### Pass condition
- [ ] Job ends `status='dead_lettered'` with `attempts = 5` (`= max_attempts`).
- [ ] It was requeued (status returned to `queued` with a future `next_attempt_at`) on attempts 1–4 — i.e. exactly 4 retries before dead-letter.
- [ ] Document `processing_status='extraction_failed'` (set only at the terminal `dead_lettered` outcome; it stays `extracting` during retries).

**Result:** **PASS** — notes: R2-delete fault path; `pdf_unparseable` on every claim; requeued on attempts 1–4 (4 retries), terminal `dead_lettered` at `attempts=5`; document `extraction_failed` only at the terminal outcome.

---

## Exercise 4 — Idempotent re-run (re-enqueue an already-succeeded document)

**Goal:** re-running extraction on a document that already has a committed extraction produces **exactly one** extraction row and **no second Claude call**.

**Forceability:** ⚠️ **Requires a manual DB INSERT.** There is no API to re-enqueue extraction for an existing document (the upload route only ever creates a *new* document). You manually insert a second `vendor_assurance_extract` job pointed at the already-succeeded `documentId`.

### Setup
- [ ] Use a document that completed Exercise 1 (status `extracted`, one extraction row). Capture its `:doc`, its `:org` (`SELECT organization_id FROM vendor_assurance_documents WHERE id=:'doc'`), and the existing extraction's `id` + `created_at` (baseline):
```sql
SELECT id AS extraction_id, created_at
FROM vendor_assurance_extractions WHERE document_id = :'doc';
```

### Action — manual re-enqueue (mirrors the route's INSERT exactly)
```sql
INSERT INTO jobs (organization_id, requested_by_user_id, job_type, payload)
VALUES (:'org', NULL, 'vendor_assurance_extract',
        jsonb_build_object('documentId', :'doc'::text, 'documentTypeHint', NULL));
```
- [ ] Let the worker claim the new job.

### Observe (staging SQL)
```sql
-- The NEW job should succeed via the idempotent path
SELECT id, status, attempts, result, completed_at
FROM jobs
WHERE job_type='vendor_assurance_extract' AND payload->>'documentId' = :'doc'
ORDER BY created_at DESC;

-- Still exactly ONE extraction row; same id + created_at as baseline (proves no re-extract)
SELECT id, created_at FROM vendor_assurance_extractions WHERE document_id = :'doc';
```
**Logs:** `vendor_extraction_job_idempotent_success` for the new job (**not** `vendor_extraction_job_succeeded`). No `markExtracting` / Claude activity.

### Pass condition
- [ ] New job reaches `status='succeeded'` via `vendor_extraction_job_idempotent_success`.
- [ ] `vendor_assurance_extractions` for `:doc` is still **exactly one row**, with the **same `id` and `created_at`** as baseline (no new extraction written, no second Claude call).
- [ ] Document `processing_status` remains `extracted`.

**Result:** **PASS** — notes: manually re-enqueued job for the already-succeeded `:doc` reached `succeeded` via `vendor_extraction_job_idempotent_success`; extraction row unchanged (same `id` + `created_at`); document stays `extracted`; no `markExtracting` / Claude activity.

---

## Exercise 5 — Queue-depth alert (rising-edge once + re-arm)

**Goal:** backlog crossing **30** fires the `vendor_queue_backlog` alert **exactly once** (rising edge), and **re-arms** after the backlog clears.

**Forceability:** ⚠️ **Requires manual DB INSERTs** to seed ≥31 backlog rows. Hosted on **`securelogic-intelligence-worker-staging`** (NOT the vendor worker). The check runs every 15 min, or once on that service's boot. **Webhook delivery requires `ALERT_WEBHOOK_URL` set on intelligence-worker-staging** — if unset, `sendSecurityAlert` no-ops (`alert_skipped`) but the `vendor_queue_backlog` **warn log still fires** and proves the rising edge.

> ⚠️ Seed the rows as **`status='queued'` with `scheduled_for` in the future** so the vendor worker will **not** claim/drain them (claim predicate requires `scheduled_for <= now()`). They still count toward depth (`status IN ('queued','processing')`).
> ⚠️ The dedupe flag **resets on intelligence-worker restart**. Do **not** redeploy intelligence-worker between the "fires once" and "stays silent" checks, or you will artificially re-arm.

### Setup
- [ ] Confirm `ALERT_WEBHOOK_URL` is set on `securelogic-intelligence-worker-staging` (dashboard) if you want to verify webhook **delivery**; otherwise this is a **log-only** verification.
- [ ] Pick a real staging org: `SELECT id FROM organizations LIMIT 1;` → `:org`.

### Action
1. [ ] Seed 31 unclaimable backlog rows:
```sql
INSERT INTO jobs (organization_id, job_type, status, scheduled_for, payload)
SELECT :'org', 'vendor_assurance_extract', 'queued', now() + interval '1 hour',
       jsonb_build_object('documentId', gen_random_uuid()::text, '_soak', 'ex5')
FROM generate_series(1, 31);
```
2. [ ] Confirm depth (this is the exact query the alert uses):
```sql
SELECT COUNT(*)::int AS depth
FROM jobs WHERE job_type='vendor_assurance_extract' AND status IN ('queued','processing');
```
3. [ ] Trigger a check: wait for the next 15-min tick **or** restart `…-intelligence-worker-staging` once (boot runs the check). Record that this is the **first** crossing.
4. [ ] Wait for a **second** tick (≥15 min) without restarting → confirm it stays silent (dedupe holds).
5. [ ] Clear the backlog → re-arm:
```sql
DELETE FROM jobs WHERE job_type='vendor_assurance_extract' AND payload->>'_soak'='ex5';
```
6. [ ] Wait for a tick with depth `< 30` (re-arms), then **re-insert** the 31 rows (repeat step 1) → confirm it fires **again**.

### Observe — intelligence-worker-staging logs
- Rising edge: one `vendor_queue_backlog` **warn** log `{ depth: 31, threshold: 30 }`.
- If `ALERT_WEBHOOK_URL` set: a delivered `vendor_queue_backlog` alert (Slack/Discord). If unset: `alert_skipped`.
- Silent tick: no new `vendor_queue_backlog` log while backlog persists.
- Re-arm: after clear + re-cross, a **new** `vendor_queue_backlog` log.

### Pass condition
- [ ] **Exactly one** `vendor_queue_backlog` log/alert on the first crossing — NOT repeated on subsequent 15-min ticks while the backlog persists.
- [ ] After clearing (depth `<30`) and re-crossing, it fires **again** (re-arm proven).
- [ ] **Cleanup confirmed:** all `_soak='ex5'` rows deleted (re-run the depth query → expect 0 backlog from soak rows).

**Result:** **PASS** — notes: 31 unclaimable backlog rows seeded; exactly one `vendor_queue_backlog` warn at `{depth:31, threshold:30}` on first crossing; silent on the subsequent tick while backlog persisted; after clear (`<30`) and re-cross it fired again (re-arm proven); all `_soak='ex5'` rows deleted, depth back to 0.

---

## Pass / Fail summary

| # | Exercise | Forceable without code? | Result | Date | Notes |
|---|---|---|---|---|---|
| 1 | Redeploy-kill reclaim (exactly-once) | ✅ (15-min wait or DB age `locked_at`) | **PASS** | 2026-06-22 | Reclaimed after mid-flight kill; single extraction row; `processing_status='extracted'`. |
| 2 | Forced terminal failure (no retry) | ✅ image-only PDF (`llm_invalid_json` ⚠️ not forceable) | **PASS** | 2026-06-22 | Image-only PDF → `failed`, `attempts=1`, `next_attempt_at IS NULL`, `pdf_image_only`, 0 extraction rows. |
| 3 | Transient → dead-letter (5 attempts) | ⚠️ R2-delete **or** env unset; + DB writes to accelerate | **PASS** | 2026-06-22 | R2-delete path; `dead_lettered` at `attempts=5` after 4 retries; doc `extraction_failed`. |
| 4 | Idempotent re-run | ⚠️ requires manual DB INSERT (no API) | **PASS** | 2026-06-22 | Re-enqueued job → `vendor_extraction_job_idempotent_success`; same extraction `id`/`created_at`; no second Claude call. |
| 5 | Queue-depth alert (once + re-arm) | ⚠️ manual DB INSERT; intelligence-worker host; webhook needs `ALERT_WEBHOOK_URL` | **PASS** | 2026-06-22 | Rising edge fired once at depth 31; silent on next tick; re-armed and re-fired after clear; soak rows cleaned up. |

**Exercises requiring manual DB inserts:** 4 (re-enqueue), 5 (seed backlog). **Exercise 3** requires R2/env manipulation (no pure-upload path). **Exercise 2's** `llm_invalid_json` terminal code cannot be forced without code; image-only is the practical terminal path.

### Soak gate decision
- [x] All 5 exercises pass → §E Part 1 soak **GREEN** → unblocks Part 2 prod-enablement planning (separate explicit auth: prod R2, ANTHROPIC_API_KEY on prod worker, flag flip, **+ new worker-side flag gate** — claim path is currently flag-blind).
- [ ] Any fail → log here, do not proceed to Part 2.

**Overall soak verdict:** **GREEN — all 5 exercises PASSED.**  **Signed off by:** SecureLogic-AI (operator-run against staging)  **Date:** 2026-06-22

> **2026-06-22:** §E Part 1 staging soak passed, all 5 exercises — gate cleared for Part 2.
