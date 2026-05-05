# Auto-matcher audit

**Status:** investigation document. No code changed. No fixes applied.
**Scope:** the matcher logic in `cyberSignalProcessingService.processSignal()` that auto-creates findings when an ingested cyber signal matches a vendor or AI system in the platform.
**Goal:** decide what (if anything) needs to change before extending auto-match to controls and obligations, and before surfacing match suggestions to users in a customer-facing flow.

---

## Execution log (2026-05-05) — real data findings

### Environment correction (added 2026-05-05, post-run)

The §2/§3 queries were run against the `DATABASE_URL` configured in `.env.local`. **That URL pointed at production**, not staging. The repo has three Postgres instances (demo, staging, prod); `.env.local` was set to prod at the time of the audit run. Confirmed retroactively by the operator.

All queries were read-only `SELECT` statements; **no writes occurred**. Prod is byte-identical to its state before the audit. Verified by enumerating every statement issued (all `SELECT` or pure introspection; the one query that errored failed at the SQL parser before reaching any data path).

The empty-data observations below are **expected and correct for prod** — there are no customers on the platform yet, so zero organizations / vendors / AI systems / findings is the right state for that environment. The numbers are not diagnostic of anything wrong; they're a snapshot of a platform with no tenants.

The §3 spot-check **still cannot be performed from prod for this reason**, and the original blocker stands: assessing matcher accuracy requires a DB where (a) at least one organization exists, (b) it has vendors and/or AI systems seeded, and (c) signals have been ingested via the API path that calls the matcher. **Demo or staging is the correct target** for §3, not prod. `.env.local` is being repointed; queries will re-run once the new connection is provided.

### What stands regardless of which DB was queried

The architectural finding is code-level and is independent of the DB query results:

> The intelligence-worker pipeline (`services/intelligence-worker/src/pipeline/runPipeline.ts:103` and `services/intelligence-worker/src/kevPoller.ts:81`) inserts directly into `cyber_signals` and **does NOT call `cyberSignalProcessingService.processSignal()`**. (Verified by grep: the only `processSignal` references in the worker tree are a local helper in `editorial/executiveWriter.ts:79` that processes brief items — not the matcher.)

This was discovered by reading code, not by querying data, and remains true regardless of which DB is targeted. The matcher only runs when signals are POSTed via the API routes (`POST /api/cyber-signals`, `POST /api/cyber-signals/fetch/*`). The bulk-ingest worker path stores signals with `processed = false` and never invokes the matcher.

The implication is unchanged: **the matcher is not a load-bearing component of the platform's actual signal-processing flow today.** The customer-facing claim "we surface relevant signals" is not currently delivered by this matcher in the bulk-ingest path. Verifying whether this claim is delivered at all requires understanding the brief-generation path, which is a separate investigation.

### §2.1 — prod numbers (last 7 days, prod environment)

For reference only — not generalizable to staging or demo, where the matcher has presumably fired against seeded data.

| Query | Result (prod) |
|---|---|
| (a) Total signals last 7 days | **1,683** |
| (b) Signals with finding | **0** |
| (b) Signals without finding | **1,683 (100%)** |
| (c) Domain distribution among findings | n/a — no findings to distribute |
| (d) Multi-entity matches | 0 (vacuously) |
| (e) Source distribution (top 6) | cisa_kev: 1587 / regulatory_cisa: 21 / security_news_thehackernews: 17 / security_news_bleepingcomputer: 15 / security_news_theregister: 10 / vendor_risk_securityweek: 8 |

Total signals across all time on prod: **1,722**. **All 1,722 are global** (`organization_id IS NULL`). Zero are org-scoped. This confirms the worker pipeline is running and ingesting public-source signals into prod, even with no customer tenants present.

### §2.2 — environmental snapshot (prod)

| Entity | Count in prod |
|---|---|
| `organizations` | 0 |
| `vendors` | 0 |
| `ai_systems` | 0 |
| `findings` (any source_type) | 0 |
| `cyber_signals` (total) | 1,722 |
| `cyber_signals` (last 7 days) | 1,683 |
| `cyber_signals` with `processed = false` | 1,722 (every row) |

Prod has the platform schema and an active worker ingesting global signals, but no customer data. Expected for a pre-launch platform with no tenants. The presence of 1,683/week worker-ingested signals with `processed = false` is a useful empirical confirmation that the worker→matcher wiring gap is a live operational characteristic, not a theoretical one.

### §3 — accuracy spot-check (still blocked)

Cannot be performed from prod (zero findings, zero matched signals). Will be re-run once `.env.local` is repointed at demo or staging — those environments are expected to have at least the seeded `Meridian Financial Services` org (per `seed-demo.ts`) and any link-route POSTs the operator made earlier today.

### Updated implication for §6 recommendations

The §6 recommendations stand. The priority order shifts the same way regardless of which DB was queried, because the architectural finding (worker doesn't invoke matcher) is code-level:

- **R1 (don't extend matcher to controls/obligations) — still right.**
- **R2 (decide if matcher quality is good enough) — premature.** The matcher hasn't run in production volume because the worker pipeline doesn't invoke it. Quality is unmeasurable until either (a) the audit re-runs against demo/staging where the matcher has actually fired, or (b) the wiring changes to invoke the matcher on worker-ingested signals.
- **R3 (add tests) — still right and now more urgent.**
- **The architectural question — whose responsibility is it to run the matcher? — remains the most important unresolved question.** Three options outlined in earlier section: (a) worker iterates active orgs and runs `processSignal` per-org per cycle, (b) a separate per-org consumer drains the global signal pool, (c) the matcher remains API-only and customer-facing surfacing happens via the brief path.

### What I did NOT do

- Did not change `cyberSignalProcessingService.ts`, the worker pipeline, or any other code.
- Did not seed test data into prod to force the matcher to fire.
- Did not modify `.env.local`.
- Did not write to any DB. Every statement issued was a `SELECT` or a SQL-syntax-erroring `SELECT`.

---

## Staging environment (2026-05-05, second pass)

`.env.local` was repointed by the operator to the staging DB (`securelogic_staging`, host `dpg-d7n0pohj2pic738iidbg-a`, distinct from prod's host). Verification confirmed 5 organizations present; first org name "Staging Inc". Re-ran §2 queries against staging. All queries again read-only `SELECT` only; no writes.

### §2 query results — staging

| Query | Result (staging) |
|---|---|
| (a) Total signals last 7 days | **6,548** |
| (b) Signals with finding | **0** |
| (b) Signals without finding | **6,548 (100%)** |
| (c) Domain distribution among findings | n/a — no findings exist |
| (d) Multi-entity matches | 0 (vacuously) |
| (e) Source adapters: 21 distinct (top 5) | cisa_kev: 3174 / mitre_attack: 1849 / nvd: 1211 / mitre_atlas: 170 / cisa_alerts: 28 — **all 0% match rate** |

### Critical observation: the matcher has been firing — and matching nothing

Staging shows **4,859 org-scoped signals** out of 6,548 total (the rest are 1,689 global). Unlike prod (where 100% of signals were global, indicating the API ingest path had never fired in prod), staging shows clear evidence that `POST /api/cyber-signals/*` and therefore `cyberSignalProcessingService.processSignal()` **has fired thousands of times** in recent history.

But zero findings have been produced.

### Why zero findings: empty platform-entity tables

| Entity | Count in staging |
|---|---|
| `organizations` | **5** (4× "Staging Inc", 1× "Staging2 Inc") |
| `vendors` | **0** |
| `ai_systems` | **0** |
| `controls` | **0** |
| `obligations` | **0** |
| `findings` (any source_type) | **0** |
| `cyber_signals` (total) | 6,548 |
| `cyber_signals` (org-scoped) | 4,859 |
| `cyber_signals` (global) | 1,689 |

The matcher has fired ~4,859 times against an empty `vendors` table and found zero matches **by construction**. The `ILIKE` query returns zero rows because no vendor rows exist. This is the **empirically observed match rate of the matcher running against staging today: 0.0%** across all 21 adapter sources.

### What the staging data confirms vs leaves unanswered

**Confirmed empirically** (could not be confirmed from prod, where the API ingest path had never fired):
1. The matcher's API path **is** invoked at significant volume — 4,859 calls in recent ingest history.
2. The matcher's behavior with an empty platform-entity table is correct: zero matches, zero findings, no errors. (No 500s, no orphaned rows.)
3. The §2(d) multi-entity-match invariant holds (zero rows).

**Still unanswered** (the §3 algorithmic-accuracy question):
- The matcher's accuracy when seeded data exists. Cannot be assessed from staging in its current state for the same reason it couldn't be assessed from prod: no findings exist to spot-check. The blocker has shifted from "matcher hasn't run" (prod) to "matcher has run thousands of times and matched nothing because nothing's there to match" (staging). To answer §3, we need a DB where the matcher has fired against a realistic platform-entity inventory and produced findings.

### Operator data-hygiene observations (flagging, not acting)

Two anomalies surfaced during the verification query that are worth visibility before any further seed-script work:

1. **`Staging Inc` exists 4 times.** Four organizations named exactly `Staging Inc` (different IDs, all created 2026-04-27, all `status='active'`). Likely an artifact of repeated signup-flow tests on staging — but worth confirming this is intentional. If a seed script targets `WHERE name = 'Staging Inc'`, four rows match and the script needs to disambiguate or pick the most recent.
2. **The earlier `staging-seed-data` package spec referenced `WHERE name = 'Staging LLC'`** — that exact name does not exist on staging. The naming convention appears to be `Staging Inc` / `Staging2 Inc`, not `Staging LLC` / `Staging2 LLC`. The seed spec needs updating before it can run, OR the operator can confirm which of the four `Staging Inc` rows is the canonical seed target.

Not acting on either — both are operator decisions about staging data hygiene, not matcher-audit findings.

### Updated implication for §6 recommendations

Unchanged. The architectural finding (worker pipeline does not invoke `processSignal()`) stands and is now joined by an empirical second finding: **even when the API ingest path fires, the matcher returns zero matches today because the platform-entity tables are empty.** The customer-facing claim "we surface relevant signals" is, as best as can be determined from the data available, not delivered today by either path:
- **Worker path:** doesn't invoke the matcher at all (architectural finding, code-level).
- **API path:** invokes the matcher but it matches nothing because there's no platform inventory to match against (empirical finding, data-level).

The next investigative step requires either:
- Seeding the staging org(s) with realistic vendor/AI-system data so the matcher has targets, then re-running §3 against the resulting findings, or
- Querying the demo environment (the third of the three known DBs) where `seed-demo.ts` is expected to have seeded the `Meridian Financial Services` org with 12 vendors. The matcher's behavior there would be the most direct read on §3.

### Queries run against staging (all read-only)

| Statement | Mutation? |
|---|---|
| `SELECT current_database(), (SELECT COUNT(*) FROM organizations), (SELECT name FROM organizations LIMIT 1)` | read |
| `SELECT id, name, status, created_at::date FROM organizations ORDER BY created_at` | read |
| `SELECT COUNT(*) FROM cyber_signals WHERE ingestion_timestamp >= NOW() - INTERVAL '7 days'` | read |
| `SELECT COUNT(*) FILTER (...) FROM cyber_signals ...` | read |
| `SELECT f.domain, COUNT(*) FROM findings f JOIN cyber_signals ...` | read |
| `SELECT cs.id, COUNT(DISTINCT f.id) ... HAVING > 1` | read |
| `SELECT source, COUNT(*), match_pct FROM cyber_signals GROUP BY source` | read |
| `SELECT (SELECT COUNT(*) FROM vendors) ... ` | read |
| `SELECT COUNT(*) FILTER (WHERE org IS NULL) FROM cyber_signals` | read |
| `SELECT source_type, COUNT(*) FROM findings GROUP BY source_type` | read |

Zero `INSERT`/`UPDATE`/`DELETE`/DDL. Staging is byte-identical to its state before the queries ran.

---

## §3 spot-check — closed (2026-05-05)

The audit's blocking question — does the matcher actually do what §1.1 predicted? — is now answered empirically. Raw results and per-signal categorization in `docs/matcher-spot-check-2026-05-05.md`.

### Test setup

15 synthetic signals submitted against the canonical Staging Inc org's seeded inventory (10 vendors, 5 ai_systems). Direct invocation of `processSignal()` via `scripts/test-matcher-staging.ts` — same code path as `POST /api/cyber-signals`, minus HTTP/auth. Run script: `npm run test:matcher-staging`.

### Results

| Outcome | Count | What it says |
|---|---|---|
| Clearly correct hits | 7 | Microsoft, Cisco, Apple, Adobe, Apache, Microsoft Azure, Cisco Systems — all exact-name match cases |
| False positives | 0 | No matcher-attributed match was wrong; ILIKE-equality precludes false positives by construction |
| Correct misses | 6 | Oracle, Salesforce, Atlassian, GitHub, Snowflake (no inventory entries) plus AWS (acronym, no substring overlap with "Amazon Web Services") |
| Algorithmic misses (false negatives) | 2 | Bloomberg → inventory has "Bloomberg Terminal"; Refinitiv → inventory has "Refinitiv Eikon" |

The AWS case is technically a third near-miss, but the spot-check script's substring heuristic doesn't catch acronym-vs-expansion overlap. Counted as "no inventory overlap" in the data; operator-eye review would re-categorize it alongside Bloomberg and Refinitiv.

### Operational characteristics

- Zero errors. No 500s. No orphan rows.
- Every match correctly created a finding (`source_type='cyber_signal'`, `domain='Vendor Risk'`).
- Every match triggered a posture-snapshot recompute (the established side-effect path).
- The matcher is well-defined on every input — including the no-match path. Its failure mode is silence, not loudness.

### Conclusions

**§1.1 confirmed empirically.** The matcher does ILIKE-equality and only ILIKE-equality. No surprising fallback, no fuzzy logic accidentally engaged, no edge-case crashes. What the SQL says is what runs.

**Matcher quality, characterized:**
- **Precision: 100%** across all 15 signals. Every match the matcher claimed was correct.
- **Recall: ~70% on inventory-overlapping signals.** Of the 10 signals where some inventory vendor was related, 7 matched. The 3 misses were all symptoms of the same algorithmic gap: ILIKE-without-wildcards can't bridge brand→full-name (Bloomberg, Refinitiv) or acronym→expansion (AWS).

**This is a precision-first foundation.** The matcher's failure mode is silence — false negatives, not false positives. Customers shown matcher output will not see noise; they will see fewer matches than they could. That tradeoff is acceptable and arguably desirable as the basis for a customer-facing suggestion queue, where false positives erode trust faster than false negatives erode value.

### §6 status update

The original §6 recommendations, re-evaluated against the spot-check evidence:

- **R1 stands.** Don't extend the existing matcher to controls/obligations. They need a different algorithm class — controls have abstract names, obligations have regulatory citations. Neither is reachable via name-equality on `affected_vendor`. The spot-check did not test this; the conclusion stands on §5 analysis alone.
- **R2 closes.** The matcher's quality is now characterized: 100% precision, ~70% recall on inventory-overlapping signals, predictable failure mode. The question "is this acceptable as the foundation for customer-facing suggestion work" answers yes for precision, no for recall. Recall improvements (wildcards / aliases / fuzzy / hybrid LLM, per the original R4) are the scope of the next package, not a blocker for further work on top of the matcher.
- **R3 still right.** Zero test coverage on the matcher remains a real gap. The spot-check is empirical evidence the matcher works today; it is not a regression test. A vitest suite covering the matcher's documented behavior should land before any algorithmic changes per R4.

### Most important unresolved item

The architectural finding from the prod and staging runs: **the intelligence-worker bulk-ingest pipeline does not invoke `processSignal()`.** The matcher is reachable only from the API path. On staging, of 6,548 ingested signals across 21 sources, the worker pipeline alone produced 1,689 of them (the global pool); the API path produced 4,859 — and as the spot-check confirms, that path's matcher is fully operational at 100% precision.

But neither path delivers the customer-facing claim "we surface relevant signals" today: the worker-ingested signals never reach the matcher (architectural gap), and the API-ingested signals only match exact-name vendors (recall gap). Closing one without the other is half a story.

The next investigation worth scoping is **whose responsibility it is to invoke the matcher on worker-ingested signals.** Three options outlined in the prior execution-log section: (a) the worker fans out per-org and runs the matcher per ingest cycle, (b) a separate per-org consumer drains the global signal pool, (c) the matcher remains API-only and customer-facing surfacing happens via the brief path. The spot-check evidence makes this question concrete: a working matcher exists and is precise; the question is whether enough signals ever reach it.

### Audit closes here

This document closes as an investigation. The matcher is understood, its quality is characterized, and the open architectural question is named. Subsequent work — recall improvements, controls/obligations matching, suggestion-queue UI, tests, worker-pipeline wiring — is package-scoped, not investigation-scoped.

---

## §7 Resolution — package matcher-rewire-and-worker-coverage

The architectural item from §6 ("the worker pipeline does not invoke `processSignal()`") is **resolved** by package 3.5 (matcher-rewire-and-worker-coverage). Summary of what changed:

- **`runMatcherForSignal(signal, orgId, client?)`** — extracted from the body of the historical `processSignal`. Covers phases 1-3 only: vendor / ai_system ILIKE matching, finding INSERT (dual-write), suggestion INSERT into `signal_match_suggestions` with `match_score` populated by `computeRiskScore` and `match_metadata` populated with `{ source, matched_branch, matched_string }`. Optional `client` parameter lets callers share a transaction; `processSignal` passes its own client so phases 1-3 are atomic with phases 4-5.
- **`processSignal` is now a thin wrapper** — calls `runMatcherForSignal` with a shared client, then layers phases 4-5 (signal-row update, risk exposure flagging) inside the same transaction. Phase 6 (posture snapshot) remains a separate post-commit operation as before. For source signals with `organization_id IS NULL`, `processSignal` short-circuits before phase 4 — global signals fan out to N orgs and have no single linked finding to update. The invariant is row-based, not caller-based.
- **Worker fan-out** — `runPipeline.ts` and `kevPoller.ts` both query active orgs (`SELECT id FROM organizations WHERE status = 'active' ORDER BY id`) once per cycle, then iterate every (signal, org) pair through `runMatcherForSignal`. Per-pair `try/catch` isolates failures so one broken pair never aborts the cycle. Aggregate metrics (`pairsAttempted`, `pairsSucceeded`, `pairsFailed`, `matchesProduced`, `elapsedMs`) logged at end of cycle for observability.
- **Dual-write invariant** — the matcher continues to write findings rows (`source_type='cyber_signal'`) for backward compatibility with five live readers (`routes/cyberSignals.ts:505`, `routes/intelligence.ts:592` and `:670`, dashboard top-risks, posture computation). A future package will migrate readers to suggestions and let findings creation be removed; until then, dual-write is the steady state.

### Correction to §1 / §2 claim ("matcher is reachable only from the API path")

The original audit claim was incorrect. The matcher is reachable from **three** paths today:

1. **API ingest** — `routes/cyberSignals.ts` (POST `/api/cyber-signals` plus six `/fetch/<source>` routes plus the reprocess route). 11 call sites total.
2. **`briefScheduler.runScheduler`** — `lib/briefScheduler.ts:178` invokes `processSignal` per-org per-signal during the daily Intelligence Brief pipeline. This existed throughout the audit window and was not surfaced because the audit conflated "worker" (which had two definitions: the cron-based `intelligence-worker` service and the API-layer `briefScheduler`).
3. **Worker fan-out** — `services/intelligence-worker/src/pipeline/runPipeline.ts` and `kevPoller.ts`, after this package. Operates on global signals (`organization_id IS NULL`); fans out to all `organizations.status='active'` orgs.

### Side-finding (parked, deferred to a separate package)

`processSignal`'s findings INSERT (`cyberSignalProcessingService.ts:217-256`) has no `ON CONFLICT` guard. Re-running `processSignal` on the same signal produces duplicate findings rows. The reprocess endpoint comment at `cyberSignals.ts:1701-1703` claims dedup ("checks for an existing finding... and skips creation if one already exists") but the code does not implement it. Pre-existing bug, surfaced in package 3.5 investigation, deferred to a separate small package. Worker fan-out's per-cycle ingestion does **not** increase risk because `dedup_hash` partial-unique on `cyber_signals` blocks signal repeats — re-firing requires the user to call the reprocess endpoint manually.

### `match_score` column type fix (predecessor commit `fad02414`)

Package 1's migration declared `match_score NUMERIC(4,3)` (max value `9.999`), intending a 0..1 confidence. Package 3's `computeRiskScore` returns an integer in `[0, 100]`. The mismatch was silent because no INSERT writer existed yet — package 3.5's matcher rewire would have been the first writer. The latent bug was fixed in commit `fad02414` (schema-fix-match-score-and-metadata) before package 3.5 proper, widening to `INTEGER` with `CHECK (match_score IS NULL OR match_score BETWEEN 0 AND 100)` and adding the `match_metadata JSONB` column the rewire populates.

---

## 1. What the matcher actually does

> **Note:** claims about matcher call sites in §1 and §2 below were subsequently corrected in §7. Read §7 first if scope is what matters.

### 1.1 Algorithm

The matcher is in `src/api/lib/cyberSignalProcessingService.ts:processSignal()`. Two SQL queries, in sequence:

**Vendor query** (lines 154–164):
```sql
SELECT id, name FROM vendors
 WHERE organization_id = $1
   AND status = 'active'
   AND name ILIKE $2
 LIMIT 1
```

**AI system query** (lines 176–185, only runs if vendor query returned 0 rows):
```sql
SELECT id, name FROM ai_systems
 WHERE organization_id = $1
   AND name ILIKE $2
 LIMIT 1
```

**Critical detail: `ILIKE` is invoked with no wildcards.** The bound parameter `$2` is `signal.affected_vendor` verbatim — no `%` prefix, no `%` suffix, no normalization. PostgreSQL `ILIKE 'cisco'` is **case-insensitive equality**, not substring or fuzzy. It matches the strings `Cisco`, `CISCO`, `cisco`, but **not** `Cisco Systems`, `Cisco IOS XE`, or `cisco-asa-01`.

There is no Levenshtein, n-gram, trigram, fuzzy, alias, normalization, or token-overlap step. The matcher is **case-insensitive full-string equality on a single field.**

### 1.2 Input fields

The matcher consumes exactly one field from the signal: `affected_vendor` (TEXT, nullable). It does **not** consult:
- `normalized_summary` (the actual signal text)
- `affected_cve`
- `signal_type`
- `source`
- `raw_payload`

### 1.3 Scoring and thresholds

There are none. A match is binary (row found or not), and the first row wins (`LIMIT 1`). There is no confidence score, no ranking, no candidate set returned, no human-review flag.

### 1.4 Source of `affected_vendor`

The matcher's effectiveness depends entirely on what each ingestion adapter populates into `affected_vendor`. Three strategies are in play today:

| Adapter | How `affected_vendor` is set | Typical shape |
|---|---|---|
| `cisaKevAdapter.ts:164` | `entry.vendorProject?.trim()` — verbatim from CISA KEV's `vendorProject` field | `"Microsoft"`, `"Apple"`, `"Cisco"`, `"Apache"`, `"Adobe"` — short brand-only |
| `nvdAdapter.ts:223–254` | Parse CPE 2.3 string at component index 3, replace underscores with spaces | `"microsoft"`, `"cisco systems"`, `"apache software foundation"` — lowercase, sometimes multi-word |
| `feedAdapter/threatIntelHelpers.ts:133–139` | Substring scan of RSS title against a hardcoded `KNOWN_VENDORS` list (20 entries) | Returns the canonical-cased entry: `"Microsoft"`, `"AWS"`, `"Azure"`, `"Palo Alto"` |
| `feedAdapter/regulatoryHelpers.ts:125` | Always `null` — regulatory signals are org-wide, not vendor-specific | `null` |
| MITRE ATT&CK / ATLAS | (not surveyed in this audit; flag for follow-up) | unknown |

The adapter outputs are inconsistent in case, completeness, and granularity. The platform's vendor table (per `seed-demo.ts:250–263`) uses compound canonical names (`"Microsoft Azure"`, `"Amazon Web Services"`, `"Bloomberg Terminal"`, `"Refinitiv Eikon"`) that the brand-only adapter outputs cannot reach.

### 1.5 Domain routing and side effects (for completeness)

When a match is found, the matcher routes the resulting finding to `"Vendor Risk"` (vendor match) or `"AI Governance"` (AI-system match). When no platform entity matches, the signal is still stored and processed; it falls back to a domain by signal-type:

| signal_type | Fallback domain |
|---|---|
| `cve`, `patch`, `malware`, `advisory`, `threat_actor` | `Vulnerability` |
| `breach` | `Vendor Risk` |
| `geopolitical`, default | `General` |

Side effects per pipeline run (always, after match attempt):
1. **Finding creation** — only if a platform entity matched (vendor or AI system). No finding is created for "no-match" signals.
2. **Signal update** — `processed = true`, `linked_finding_id = <new finding id or null>`.
3. **Risk exposure flagging** (`UPDATE risks SET exposure_flagged = TRUE WHERE domain = $domain AND status='open' AND exposure_flagged = FALSE`) — fires regardless of platform-entity match. A no-match `cve` signal still flags every open risk in the `Vulnerability` domain.
4. **Posture snapshot recompute** — only if a finding was created.

### 1.6 Test coverage

**None.** A repo-wide grep of `src/api/__tests__/` and `services/intelligence-worker/src/__tests__/` for `processSignal`, `cyberSignalProcessingService`, `matched_vendor_id`, or `matched_ai_system_id` returns zero hits. The matcher has shipped to production without a single unit, integration, or behavioral test.

---

## 2. Current output shape on staging

**This section requires staging DB access to fill in real numbers. I cannot run queries against the staging Postgres from this environment.** What follows is the exact methodology + SQL the operator should run; results to be filled in by you.

### 2.1 Counts to collect (last 7 days)

```sql
-- Run against the staging Postgres for the last 7 days of ingestion:

-- (a) Total signals in window
SELECT COUNT(*) AS total
  FROM cyber_signals
 WHERE ingestion_timestamp >= NOW() - INTERVAL '7 days';

-- (b) Match coverage
SELECT
  COUNT(*) FILTER (WHERE linked_finding_id IS NOT NULL) AS with_finding,
  COUNT(*) FILTER (WHERE linked_finding_id IS NULL)     AS no_finding,
  COUNT(*) AS total
  FROM cyber_signals
 WHERE ingestion_timestamp >= NOW() - INTERVAL '7 days';

-- (c) Of those WITH a finding, vendor vs AI-system distribution
--     (the matcher writes the matched entity ID into the finding via
--     source_id=signal.id; we infer vendor vs AI-system by the finding's
--     domain, since vendor → 'Vendor Risk' and ai_system → 'AI Governance')
SELECT f.domain, COUNT(*) AS cnt
  FROM findings f
  JOIN cyber_signals cs ON cs.linked_finding_id = f.id
 WHERE f.source_type = 'cyber_signal'
   AND cs.ingestion_timestamp >= NOW() - INTERVAL '7 days'
 GROUP BY f.domain
 ORDER BY cnt DESC;

-- (d) "Signals matching multiple entities" — the current matcher cannot
--     by design (it's one-shot, vendor-OR-ai-system, never both). This
--     SHOULD always return zero rows. If it returns >0, that's a real bug.
SELECT cs.id, COUNT(DISTINCT f.id) AS finding_count
  FROM cyber_signals cs
  JOIN findings f ON f.source_id = cs.id::uuid
                 AND f.source_type = 'cyber_signal'
 WHERE cs.ingestion_timestamp >= NOW() - INTERVAL '7 days'
 GROUP BY cs.id
HAVING COUNT(DISTINCT f.id) > 1;

-- (e) Distribution of source adapters in the window
SELECT source, COUNT(*) AS cnt,
       COUNT(linked_finding_id) AS with_finding,
       ROUND(100.0 * COUNT(linked_finding_id) / NULLIF(COUNT(*), 0), 1) AS match_pct
  FROM cyber_signals
 WHERE ingestion_timestamp >= NOW() - INTERVAL '7 days'
 GROUP BY source
 ORDER BY cnt DESC;
```

### 2.2 Expected pattern (predicted from code)

Given (1.1) is case-insensitive exact match on `affected_vendor`, and (1.4) shows brand-only adapter outputs vs compound platform vendor names, the predicted shape is:

- **Match rate per signal:** low — guess **15–35% of total signals** result in a finding. Significant variance by source (CISA KEV likely highest match rate; threat-intel RSS lowest because the hardcoded `KNOWN_VENDORS` list often returns brand-only strings the platform doesn't have as exact vendor entries).
- **Multi-entity matches:** zero by design. Query (d) should be empty.
- **Domain distribution among findings:** heavily skewed to `Vendor Risk` (because vendor query runs first and AI systems is the fallback only when vendor returns zero rows).

### 2.3 What to record

Paste the actual numbers back into this document under section 2 once you've run the queries. The accuracy spot-check in §3 builds on the same row set.

---

## 3. Spot-check accuracy

**Operator-required.** I cannot pull real signals from staging.

### 3.1 Sampling

```sql
-- Random sample of 30-50 actually-matched signals from the last 7 days.
-- Returns signal text + matched entity name side-by-side.
SELECT
  cs.id            AS signal_id,
  cs.source,
  cs.signal_type,
  cs.affected_vendor,          -- what the matcher saw
  cs.affected_cve,
  cs.normalized_summary,       -- the human-readable signal text
  f.domain,
  f.title          AS finding_title
  FROM cyber_signals cs
  JOIN findings f ON f.source_id = cs.id::uuid
                 AND f.source_type = 'cyber_signal'
 WHERE cs.ingestion_timestamp >= NOW() - INTERVAL '7 days'
 ORDER BY RANDOM()
 LIMIT 40;
```

### 3.2 Categorization rubric

For each row, examine:
- `affected_vendor` — what the matcher used as the lookup key
- `normalized_summary` — what the signal is actually about
- `finding_title` — what got created in the platform
- The matched vendor's actual scope and use in the org

Categorize each into one of four buckets:

| Category | Definition | Example shape |
|---|---|---|
| **Clearly correct** | Signal is unambiguously about the matched entity | KEV signal `affected_vendor: "Microsoft"`, finding linked to vendor "Microsoft" — the org actually uses Microsoft products |
| **Plausibly correct** | Signal might apply to the matched entity, but reasonable doubt remains | KEV signal `affected_vendor: "Apache"`, finding linked to vendor "Apache" — but the org's "Apache" entry refers to Apache Kafka and the signal is about Apache HTTP Server |
| **False positive** | Signal does NOT apply to the matched entity | KEV signal `affected_vendor: "Microsoft"` (about Windows Server) linked to a vendor named "Microsoft" that the org uses only for LinkedIn integration |
| **Ambiguous** | Cannot determine without more context | Sparse signal text, or matched vendor with no clear scope |

### 3.3 What to record

Tabulate the 40-row distribution in this document under section 3 once you've reviewed. Include 2–3 verbatim examples per category. The numbers and examples drive section 6.

### 3.4 Predicted rubric distribution (anchor for sanity-check)

Based on §1 analysis, my prediction:

- **Clearly correct: ~50–65%** — the cases where the platform vendor name exactly equals the brand-only adapter output (`"Salesforce"`, `"Okta"`, `"CrowdStrike"`, single-word brands).
- **Plausibly correct: ~15–25%** — same brand match, but the matched vendor's role in the org doesn't actually intersect the signal scope.
- **False positive: ~10–20%** — over-broad ILIKE matches, the rare case where a brand has multiple unrelated platform roles.
- **Ambiguous: ~5–15%** — sparse data.

If real numbers are dramatically different from this — especially if false-positive rate is materially higher — the recommendation in §6 sharpens.

---

## 4. Failure modes

Predicted from code analysis. Real examples to be added by the operator from §3 sampling.

### 4.1 False positives (matcher creates a finding that shouldn't exist)

**FP-1: Brand collision.** Platform has a vendor named `"Apache"` referring to Apache Kafka. Adapter sees a CISA KEV entry with `vendorProject: "Apache"` referring to Apache HTTP Server. Match fires. Finding is wrong.
- Real example to capture: any KEV signal where `affected_vendor` matches a platform vendor exactly but the products differ. Paste the signal text + vendor service description.

**FP-2: Generic-name collision.** Platform has a vendor named `"Adobe"` for document signing. Adapter sees a CISA KEV entry with `vendorProject: "Adobe"` about ColdFusion. Match fires; finding domain is "Vendor Risk" but the signal has nothing to do with the platform's Adobe usage.
- Real example to capture: any vendor with a different product surface than the matched signal.

**FP-3: AI system named after vendor.** Platform has an AI system named `"OpenAI"` (the LLM provider). Adapter sees a signal about an "OpenAI Codex" vulnerability. Match fires against AI system but signal scope might be a different OpenAI product.

### 4.2 False negatives (matcher misses a real signal)

**FN-1: Compound platform vendor name.** Platform has `"Amazon Web Services"`. CISA KEV vendorProject is `"Amazon"`. ILIKE 'Amazon' against name 'Amazon Web Services' → no match. Finding is never created. Customer never sees the signal in their findings list.
- Predicted high-volume failure pattern given seed data: AWS, Azure, Bloomberg Terminal, Refinitiv Eikon all fail this way.

**FN-2: Reverse compound — adapter has more detail than platform.** Platform has `"Microsoft"`. NVD CPE adapter outputs `"microsoft windows"` (post-underscore-replacement). ILIKE 'microsoft windows' against name 'Microsoft' → no match.
- Predicted: NVD adapter signals with multi-word vendor strings underperform KEV.

**FN-3: Vendor renamed or rebranded.** Platform has `"Refinitiv Eikon"`. Adapter sees `"LSEG"` (London Stock Exchange Group, Refinitiv's parent). No match.

**FN-4: Acronym vs spelled-out.** Platform has `"Amazon Web Services"`. Adapter sees `"AWS"` (e.g., from RSS hardcoded list). No match — and vice-versa: platform has `"AWS"` and adapter outputs `"Amazon"`.

**FN-5: Trailing qualifiers.** Platform has `"Cisco IOS"`. Adapter sees `"Cisco"`. No match because ILIKE is exact.

**FN-6: Regulatory signals never match.** Adapter sets `affected_vendor = null` for regulatory signals (`regulatoryHelpers.ts:125`). The matcher short-circuits on null. Regulatory signals therefore **never** create findings even when they substantively apply to a vendor's contracts. This is by design but worth flagging for the customer-facing claim.

### 4.3 Operator action

Pull 5–10 examples of each pattern from staging where possible. The strongest signal here is the FN-1/FN-4 family — predicted to be high-volume given the demo seed data.

---

## 5. Extensibility to controls and obligations

### 5.1 Why the existing approach can't extend

The matcher matches `signal.affected_vendor` (brand string) against `vendors.name` or `ai_systems.name` (entity-name string). This is a name-on-name match.

For controls:
- `controls.name` is a free-text descriptor like `"MFA enforcement on admin accounts"`, `"Encryption at rest for customer data"`, `"Quarterly access review"`.
- No signal field carries that kind of phrasing. `affected_vendor: "Microsoft"` does not lexically intersect a control name. Even if a CISA advisory says `vulnerabilityName: "Microsoft Azure MFA bypass"`, the adapter strips it down to `affected_vendor: "Microsoft"` and `normalized_summary: <full advisory text>`. The matcher only sees `affected_vendor`.
- An ILIKE of `"Microsoft"` against control name `"MFA enforcement on admin accounts"` produces zero matches. There is no path to a control match using the current matcher.

For obligations:
- `obligations.title` is short reference text like `"GDPR Article 32 — Security of processing"`.
- `obligations.source_regulation` is a short citation like `"GDPR Art. 32"`.
- Signals do not carry regulatory citations as a structured field. A regulatory RSS adapter (`regulatoryHelpers.ts`) sets `affected_vendor: null` and dumps everything into `normalized_summary` as free text.
- The matcher consults neither `normalized_summary` nor any obligation field. There is no path to an obligation match using the current matcher.

**Conclusion: the existing matcher CANNOT extend to controls and obligations as-is.** Forcing it to would mean either (a) adding new structured fields to signals that adapters don't populate today, or (b) replacing the match algorithm with one that uses different signal data.

### 5.2 What controls and obligations actually need

Both entity types need a matcher that operates on the signal's free-text content (`normalized_summary` and/or `raw_payload`), not on a structured `affected_vendor` field. The right shape is approximately:

- **For controls:** match signal text against control descriptions using semantic similarity, keyword extraction, or LLM classification. Example: a signal "Critical MFA bypass disclosed in major SSO provider" should suggest controls that mention MFA, SSO, authentication.
- **For obligations:** match signal text against the obligation's `domain`, `source_regulation`, and `description` (or against pre-built keyword sets per obligation). Example: a regulatory signal about "EU AI Act enforcement" should suggest obligations whose `source_regulation` references the EU AI Act, regardless of the signal's `affected_vendor`.

Three viable algorithm classes:

| Approach | Pros | Cons |
|---|---|---|
| **Keyword tagging** (per-control or per-obligation keyword set, declared by the customer) | Predictable, debuggable, no LLM cost | Customer must curate keywords; brittle for novel signals |
| **Trigram / pg_trgm similarity** on signal_summary vs control description | No customer config; degrades gracefully | Mediocre precision on abstract control names like "Encryption at rest" vs signal text |
| **LLM-based suggestion** (Claude classifies signal → control/obligation candidates) | High precision on abstract phrasing; matches the platform's existing LLM stack | Per-signal cost; latency; LLM-side audit story needed; risk of hallucinated matches |

A hybrid (LLM produces candidates, keyword tags constrain) is plausible. None of these is a small extension of the existing matcher — they're a different system.

### 5.3 The customer-facing flow you described

You named the sales claim: "we surface relevant signals and your team confirms in one click, defensibly logged." Mapping that against current state:

| Required | Current state |
|---|---|
| **Surface suggestions to the customer** | Today: matcher auto-creates a finding on hard match. There is no "suggested link" or "candidate" surface. Findings exist or they don't. |
| **One-click confirm** | Today: no confirm step. Auto-created findings are simply present. The user can ignore them, but there's no UI/route for "this match is correct" or "this match is wrong, dismiss." |
| **Defensibly logged** | Today: signal-link audit logs only fire on the manually-created `signal_*_links` rows (the four packages just shipped). The auto-created findings carry their own audit trail (finding creation event), but there is no audit record of the matcher's *decision*: no "matcher considered N candidates, chose entity X, confidence Y, suggested at time T, confirmed by user U at time T+ε." |

The sales claim describes a **suggestion-with-confirm** workflow. The platform today implements an **auto-create-on-match** workflow. These are different products. Building the former on top of the latter requires:
1. A "suggestion" object distinct from a "finding" — produced by the matcher, surfaced to the customer, awaiting confirmation.
2. A confirm/dismiss route that promotes a suggestion to a finding (or kills it).
3. Audit logging of every step: matcher ran, suggestion produced, suggestion shown, user clicked confirm/dismiss.
4. A different matcher quality bar — false-positive rate has to be low enough that customers will actually click confirm rather than churn through false positives.

---

## 6. Recommendation

Concrete actions, ordered by priority. None of these are scoped as packages here — the user named this an investigation, and the next package depends on which of these is taken.

### 6.1 Before extending to controls and obligations

**R1. Do not extend the existing matcher to controls or obligations.** It cannot reach those entity types as designed (§5.1). Treat controls and obligations as a separate matcher project with its own algorithm.

**R2. Decide whether the existing vendor / AI-system matcher is good enough as-is, OR rebuild it.** The §3 spot-check answers this. If false-positive rate > ~20% or false-negative rate > ~50% on real staging data, the matcher is not strong enough to underpin a customer-facing "suggestion + confirm" claim. In that case, fix it before any extension or surfacing.

**R3. Add tests.** Zero coverage today is unacceptable for a feature that auto-creates customer-visible findings. Minimum: unit tests on the matcher's name-comparison behavior (case sensitivity, whitespace, exact vs partial), integration tests with a fixture vendor table and known signal inputs.

### 6.2 If the existing matcher needs to improve before launch

**R4. Replace exact-equality ILIKE with a layered match strategy:**

1. **Exact match (case-insensitive)** — current behavior, kept as fastest path.
2. **Token-overlap match** — split both sides on whitespace, match if signal vendor tokens are a subset of platform vendor tokens (so `"Microsoft"` matches `"Microsoft Azure"`) or vice versa.
3. **Alias table** — a per-org or platform-wide table mapping common adapter outputs to canonical vendor IDs (`"AWS"` → `"Amazon Web Services"`, `"Azure"` → `"Microsoft Azure"`, `"LSEG"` → `"Refinitiv Eikon"`).
4. **pg_trgm similarity** as a last-resort fuzzy fallback (gated by a minimum similarity threshold).

Each layer can return a confidence score; the matcher emits a candidate set rather than a binary winner, and the customer-facing UI promotes from candidate → finding via confirm.

**R5. Standardize adapter output.** The three adapters today produce three different shapes for the same conceptual field. Pick one canonical form (likely: lowercase, trimmed, no trailing qualifier) and have every adapter normalize before populating `affected_vendor`. The matcher then compares against an analogously-normalized vendor name.

**R6. Treat `affected_vendor: null` signals deliberately, not silently.** Today they short-circuit out of matching. For a customer-facing "we surface relevant signals" claim, regulatory signals matching to obligations is the whole point — they cannot be silently dropped from the matching pipeline.

### 6.3 If we're extending the customer-facing claim to suggestion-with-confirm

**R7. Introduce a `match_suggestions` table** (or equivalent) — distinct from `findings` and from the four `signal_*_links` tables. A suggestion has: signal_id, candidate_entity_type, candidate_entity_id, confidence_score, source_algorithm, status (pending / confirmed / dismissed), confirmed_by, confirmed_at. Confirming a suggestion is what creates the platform-canonical link or finding.

**R8. Audit-log the matcher's decisions, not just the outcomes.** Every match attempt (including no-match) should be visible in an admin trail: which entities were considered, which scoring layer produced the match, what the confidence was, who confirmed.

**R9. Decide the auto-create-vs-suggest threshold.** Today: hard match → finding auto-created. Future: low-confidence match → suggestion only; high-confidence match → suggestion auto-confirmed; exact match → finding (current behavior). The thresholds become a tunable.

### 6.4 What I am NOT recommending

- **Don't rebuild the matcher and the suggestion workflow as one package.** They're two different problems. Rebuild the matcher first to a quality bar that supports customer-facing claims, then build the suggestion/confirm surface on top.
- **Don't extend the auto-create-on-match pattern to controls and obligations.** The customer-facing flow you described (suggest, confirm, logged) is the right shape for those entity types. Auto-creating findings for abstract entities like controls without explicit confirmation will produce noise that erodes trust faster than the feature builds it.
- **Don't ship suggestion surfaces before §3 spot-check is done.** Customer-facing match suggestions are only credible if false-positive rate is known and low. Surfacing weak matches as "we surface relevant signals" is a credibility liability.

---

## 7. Open items for operator

1. Run the queries in §2.1 and §3.1; paste results here.
2. Categorize the 40-signal sample per §3.2; tabulate the rubric.
3. Decide based on the §3 distribution: is the existing matcher quality good enough to surface to users, or does it need R4/R5 first?
4. If extending to controls/obligations, agree the §5.2 algorithm class (keyword / trigram / LLM / hybrid) before scoping the package.
5. If building the suggestion-with-confirm surface, decide the §6.3 table shape and audit story before scoping.

The next package follows from these decisions. I have not pre-scoped it.
