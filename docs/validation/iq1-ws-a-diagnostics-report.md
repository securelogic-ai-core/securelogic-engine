# IQ-1 — WS-A + B1/D1 Diagnostics Report

**Date:** 2026-08-07 · **Status:** COMPLETE — awaiting operator approval for the next workstream
**Scope executed:** WS-A (A1–A4), B1 diagnosis, B2 personalization validation + smallest fix (goal priority 4), D1 staging verification + prod handoff, baseline metrics.
**Plan:** `docs/iq1-intelligence-quality-plan.md` · Governing audit: `docs/architecture/intelligence-quality/IQP-PHASE-1-AUDIT.md`

Nothing here is committed. Exact commit scope is listed in §7.

---

## 1. Headline findings

1. **BR-2 is real, live on staging today, and worse than the backlog said.** The
   Jul 26 – Aug 2 brief for `[SEED] Walkthrough Org` presents **CVE-2002-0367
   (24 years old)** and CVE-2010-0188 as "this period"; the Aug 4 brief carries
   eight 2019 CVEs. Across both briefs, **17 of 24 items are CVEs from 2021 or
   earlier**, every one instructed to "patch within this week".
2. **The fix already exists and is proven — it is dark.** The recency branch
   behind `SECURELOGIC_SIGNAL_RECENCY_ENABLED` (IQP Q2, ledger OP-3) does
   exactly what is needed. Proven three ways in §3. **No rewrite required; the
   remaining work is operator enablement.**
3. **Enrichment fallback is 100%, not "predominant".** 24/24 items across both
   staging briefs match the `buildFallbackItem` template exactly (urgency
   `near_term` 24/24 = the fallback constant; severity High 24/24 = the KEV
   floor), and **brief-level synthesis — a separate Claude call — is also null
   on both briefs**. Two independent Claude call sites failing across two
   cycles points at the environment (key absent or not authenticating — the
   ledger's OP-6 "April signature" hypothesis), not per-item parse flakiness.
   Root-cause discrimination requires OP-6, which only the operator can run.
4. **The personalization bypass is confirmed on real data and is now fixed in
   the working tree.** Both staging briefs: `is_personalized` false on 24/24
   items — while the org's vendor registry contains Cisco and both briefs carry
   the Cisco CVE-2026-20316 item. Root cause: the cron scheduler never called
   `personalizeBriefItems` (17-column insert); only the manual route did
   (19 columns). Smallest fix applied (§4).
5. **The staging archive hole is exact and explained; prod needs one query.**
   Staging: legacy issues #1–#11 end 2026-05-19 (legacy newsletter flag dark
   since), canonical briefs resume 2026-08-02 (catch-up flag enabled on staging
   only). Prod verification is a read-only SQL the operator must run (§6).
6. **TR-5 confirmed with real rows** (recorded for WS-C, not fixed in this
   phase): 9 of 11 staging issues have `publish_date` exactly one day after the
   date in their own title — generation-day title vs send-day `publish_date`.

---

## 2. Evidence — B1 (enrichment fallback)

Staging API, `[SEED] Walkthrough Org` (platform entitlement), 2026-08-07:

| Brief | Period | Items | Fallback `why_it_matters`¹ | Fallback action¹ | urgency | severity | `is_personalized` | synthesis |
|---|---|---|---|---|---|---|---|---|
| `c5235bde…` | Jul 28 – Aug 4 | 12 (of 4510 signals) | 12/12 | 12/12 | near_term 12/12 | High 12/12 | 0/12 | headline/teaser/exec_summary all null |
| `2765c149…` | Jul 26 – Aug 2 | 12 (of 4507 signals) | 12/12 | 12/12 | near_term 12/12 | High 12/12 | 0/12 | all null |

¹ Exact-template match against `intelligenceBriefGenerator.ts` `fallbackWhyItMatters`
(lines 1064-1071) / `fallbackRecommendedActions` (1079-1095).

**Why this is measured by template-match, not a status column:** per-item
`enrichment_status` is deleted before persistence
(`intelligenceBriefGenerator.ts:926` — `delete copy.enrichment_status`). It
exists only in memory and in IQP Q5's per-cycle logs.

**What already exists for this defect (dark):** IQP Q5 shipped
`SECURELOGIC_ENRICHMENT_RELIABILITY_ENABLED` — 401-classification
(`brief_enrichment_fallback` `reason: anthropic_auth_failure`), a per-cycle
`brief_enrichment_summary` with `fallback_rate`, and degradation alerts. Its
suite passes (part of 6865 engine tests). The flag is **not in `render.yaml`**
and requires `ALERT_WEBHOOK_URL` to be non-inert.

**Root-cause status:** the customer-visible signature cannot distinguish
key-absent from key-invalid-401 from quota. **OP-6 (ledger) is the
discriminator and is operator-only** — one curl per environment with that
environment's key. Do OP-6 before OP-7. Prompt/summarization work stays frozen
until OP-6's answer is recorded (goal priority 2 satisfied: measured, not
modified).

## 3. Evidence — A1/BR-2 (recency)

Three independent proofs, no logic rewritten:

1. **Code trace:** `briefScheduler.ts` window query branches on
   `signalRecencyEnabled()` — flag ON: `COALESCE(published_at,
   ingestion_timestamp)` within window + `stale_signal_suppressed` count; flag
   OFF: ingestion-time only (the defect). Same branch duplicated in
   `intelligenceBriefs.ts` (manual route). `published_at` is recovered from KEV
   `dateAdded` (first-priority key, `cyberSignalNormalizer.ts`).
2. **Tests:** existing Q2 unit suite 18/18 (`signalRecency.test.ts`); **new
   real-Postgres suite** `test/isolation/signalRecencyWindow.test.ts` (4/4,
   full migration schema) pins the exact SQL: legacy branch admits an
   old-`dateAdded`/fresh-ingest row (the defect, now a regression alarm),
   recency branch suppresses it, telemetry counts exactly it, unknown-date rows
   keep ingestion behavior, tenant scoping holds. This closes audit release
   gate **G4**'s missing test.
3. **Live data:** §2's CVE-age table — 17/24 items ≤2021 in current staging
   briefs with the flag OFF.

**Remaining gaps found while validating:**
- The flag was in no `render.yaml` service → OFF everywhere (fixed in this tree, §4).
- Weekly scheduler's own KEV fetch shares the 15-min poller's Redis ETag key
  and ignored `fromCache` → weekly runs log `signals_fetched.cisa_kev = 0`,
  indistinguishable from a dead feed (fixed, §4).
- No brief surface showed any source date, and the detail masthead showed only
  the period END — a reader could not check an item against the window (fixed, §4).
- Brief items' own `ingestion_timestamp` column is written by **neither**
  insert path — always NULL in API responses (24/24 observed). The item-detail
  "Ingested" row is dead code today. Recorded as an instrumentation gap (§5),
  not fixed here.

## 4. Changes in the working tree (all validated)

| # | Change | Files |
|---|---|---|
| A2 | `SECURELOGIC_SIGNAL_RECENCY_ENABLED` added to IaC: `securelogic-engine-staging` **"true"**, `securelogic-engine` **"false"** (BLOCKED ON STAGING VALIDATION comment, OP-2 dependency + same-SHA-rebuild note). Engine services only — the two places the flag is read. | `render.yaml` |
| A3 | Brief GET joins the source signal's `published_at` → new additive `signal_published_at` on items (alias-qualified join; `cyber_signals` has no RLS). Card footer shows "Reported {date}" (UTC-pinned); item-detail Source section gains a "Reported" row; canonical masthead states the full coverage window "May 25, 2026 – Jun 1, 2026" instead of the end date. Absent date → nothing rendered, never inferred. | `src/api/routes/intelligenceBriefs.ts`, `app/src/lib/api.ts`, `IntelligenceBriefSignalCard.tsx`, `briefs/[id]/page.tsx`, `signal/item/[index]/page.tsx` |
| A4 | Scheduler destructures `fromCache`; 304 now logs `scheduler_cisa_kev_not_modified` ("brief window reads the 15-min poller's global rows") instead of a zero-count "fetched". Feed-health success still recorded (a cache hit is a healthy feed). | `src/api/lib/briefScheduler.ts` |
| B2 | Scheduler personalizes exactly like the manual route: `personalizeBriefItems(cappedItems, orgId)` after cap, before synthesis (non-fatal, FALSE/NULL fallback); synthesis + finalize run on personalized items; insert extended 17→19 columns (`is_personalized`, `platform_context`) — byte-identical column list to the route. No migration (columns exist since `20260511`). | `src/api/lib/briefScheduler.ts` |
| Tests | New: `test/isolation/signalRecencyWindow.test.ts` (4), `briefSchedulerPersonalizationWiring.test.ts` (5), `app…/brief.recency.display.test.tsx` (5). Extended: `briefSchedulerFeedHealthWiring.test.ts` (+3). | — |

**Validation:** engine 6865 passed / 3 pre-existing skips (420 files); app
1289/1289 (101 files); isolation recency suite 4/4 on real Postgres; engine +
app `tsc` clean; engine lint = 1 pre-existing warning in an untouched file.

## 5. Baseline operational metrics (goal priority 5)

Measured now, from staging (the only environment engineering can reach):

| Metric | Baseline value | How measured |
|---|---|---|
| Enrichment success rate | **0/24 (0%)** across the 2 most recent staging briefs | template-match proxy (§2) |
| Fallback generation rate | **100%** (items) + **2/2** briefs with null synthesis | same |
| Personalized briefing rate | **0/24 items, 0/2 briefs** (should be ≥1 — Cisco) | API `is_personalized` |
| Signal freshness (brief output proxy) | **17/24 items are CVEs ≤2021** under a "this period" label | `affected_cve` year |
| Stale signal count (window-level) | **not measurable without DB** — SQL provided §6; measurable from logs once recency flag is ON (`stale_signal_suppressed`) | — |
| Average signal age by source | **not measurable without DB** — SQL provided §6 | — |
| Recommendation confidence distribution | **does not exist anywhere in the pipeline** — `match_score` lives on `signal_match_suggestions` and never reaches brief items | — |

**Missing instrumentation (exact, per the goal's requirement):**
1. Per-item `enrichment_status` is never persisted (`generator.ts:926` deletes
   it). Either persist it (1 nullable column + insert passthrough) or accept
   log-only measurement via Q5 — decide at the next workstream.
2. Q5's `fallback_rate` per-cycle summary + auth-failure alerts: built, dark
   (`SECURELOGIC_ENRICHMENT_RELIABILITY_ENABLED` absent from render.yaml;
   alerts also need `ALERT_WEBHOOK_URL` confirmed).
3. `intelligence_brief_items.ingestion_timestamp` written by neither insert
   path — always NULL; the item-detail "Ingested" row never renders.
4. No per-cycle personalization counter (personalized_count) — belongs to the
   Q7 `brief_quality_summary` heartbeat, which remains unbuilt.
5. No signal-age / oldest-event-age metric (Q7 heartbeat).
6. No confidence score on brief items (Q7/Q6 scope).

## 6. Operator actions required (in order)

1. **OP-6 (ledger)** — verify `ANTHROPIC_API_KEY` *authenticates* (one curl per
   env, expect 200; 401 = the April root cause). Before anything else; prompt
   work stays frozen until this answer is recorded.
2. **Confirm OP-2 applied** — the recency column must exist wherever the flag
   turns on, or the new window query 500s:
   `SELECT column_name FROM information_schema.columns WHERE table_name='cyber_signals' AND column_name='published_at';`
3. **Merge IQ-1a, Blueprint-sync, deploy** — staging engine picks up the flag
   `true` (env reaches the process at DEPLOY, not restart — 2026-08-05 incident).
4. **Staging validation (OP-3 exit gate):** generate a brief for
   `[SEED] Walkthrough Org` (manual route or Tuesday cron/catch-up); expect —
   no item with `signal_published_at` before the masthead window; every KEV
   item showing "Reported {date}"; `stale_signal_suppressed` in logs;
   `is_personalized=true` on the Cisco item with the context strip rendering;
   `scheduler_cisa_kev_not_modified` on the scheduled run.
5. **D1 prod continuity (read-only):**
   ```sql
   -- canonical briefs: one row per org-week; gaps = missing weeks
   SELECT date_trunc('week', period_end)::date AS wk, COUNT(DISTINCT organization_id) AS orgs, COUNT(*) AS briefs
   FROM intelligence_briefs WHERE status='published' GROUP BY 1 ORDER BY 1 DESC LIMIT 20;
   -- legacy issues timeline (TR-5 columns included)
   SELECT issue_number, created_at::date, publish_date::date, status
   FROM newsletter_issues ORDER BY created_at DESC LIMIT 30;
   ```
6. **B1 prod fallback rate (read-only):**
   ```sql
   SELECT b.id, b.period_end::date, COUNT(*) AS items,
          COUNT(*) FILTER (WHERE i.why_it_matters LIKE '%face active exploitation risk at%Unpatched systems are exposed until remediation is verified.') AS fallback_items,
          COUNT(*) FILTER (WHERE i.is_personalized) AS personalized_items
   FROM intelligence_briefs b JOIN intelligence_brief_items i ON i.brief_id = b.id
   WHERE b.status='published' GROUP BY b.id ORDER BY b.period_end DESC LIMIT 8;
   ```
7. **Signal freshness by source (read-only, staging + prod):**
   ```sql
   SELECT source, COUNT(*) AS in_window,
          COUNT(*) FILTER (WHERE published_at IS NOT NULL AND published_at < NOW() - interval '7 days') AS stale_in_window,
          ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - COALESCE(published_at, ingestion_timestamp))))/86400) AS avg_age_days
   FROM cyber_signals WHERE ingestion_timestamp >= NOW() - interval '7 days'
   GROUP BY source ORDER BY in_window DESC;
   ```
8. **Prod flag flip** only after step 4 passes (flip render.yaml prod value to
   "true" in a follow-up commit + deploy).

## 7. Proposed commit scope (NOT committed — awaiting authorization)

One branch (**cut after PR #748 merges** — the A3 masthead hunk and #748's
back-link hunk are ~5 lines apart in `briefs/[id]/page.tsx` and will otherwise
conflict), one PR "IQ-1a — recency enablement + scheduler personalization
parity":

- `render.yaml`
- `src/api/lib/briefScheduler.ts`
- `src/api/routes/intelligenceBriefs.ts`
- `src/api/__tests__/briefSchedulerFeedHealthWiring.test.ts` (extended)
- `src/api/__tests__/briefSchedulerPersonalizationWiring.test.ts` (new)
- `test/isolation/signalRecencyWindow.test.ts` (new)
- `app/src/lib/api.ts`
- `app/src/components/IntelligenceBriefSignalCard.tsx`
- `app/src/app/briefs/[id]/page.tsx`
- `app/src/app/briefs/[id]/signal/item/[index]/page.tsx`
- `app/src/app/briefs/__tests__/brief.recency.display.test.tsx` (new)
- `docs/iq1-intelligence-quality-plan.md` + this report (operator's call
  whether docs ride the same PR)

No migrations. No API removals (one additive response field). No flag-default
changes in prod. Rollback = revert the PR; the staging flag value reverts on
the next Blueprint sync.

## 7a. ADDENDUM (2026-08-07, later same day) — B1 root cause CONFIRMED from Render logs

The Render CLI in this environment is authenticated (operator account), which
supersedes §2's "requires operator logs" caveat. Direct log evidence:

```
event: ask_claude_failed / brief_enrichment_fallback / synthesis_*_failed
claudeErr.status: 400, type: invalid_request_error
message: "Your credit balance is too low to access the Anthropic API.
          Please go to Plans & Billing to upgrade or purchase credits."
```

- **Root cause: the Anthropic account's credit balance is exhausted.** The key
  is PRESENT and VALID — Anthropic returns 401 for bad keys; a credit-balance
  400 means the request authenticated and was refused at billing. OP-6's
  invalid-key hypothesis is **discharged** for both environments.
- **Staging:** 100 matching errors (query limit) from Aug 3 00:44 → Aug 7
  14:27 UTC, continuous: 88 `brief_enrichment_fallback` (the Aug 4 Tuesday-cron
  fan-out), 4+4 synthesis headline/exec failures, 2 `vendor_signal_context`,
  2 `ask_claude_failed` (this session's probes).
- **Production: same failure.** 26 identical credit-balance errors at
  Aug 4 07:00:27–28 UTC — prod's Tuesday brief cron. Both environments draw on
  the same (or an equally drained) Anthropic account. **Prod OP-6 is thereby
  answered: key valid, account unfunded, enrichment dead in prod.**
- Onset: not datable past log retention (~Aug 3); the Aug 2 staging brief's
  100%-fallback content implies ≥ Aug 2. Whether this is also the April root
  cause is not provable from retained logs.
- Incremental Claude spend observed: **$0** — every call is rejected before
  generation.
- **Corrective action (operator-only, a spend decision):** fund the Anthropic
  account (Console → Plans & Billing) or point both services at a funded
  account's key. No Render env change is needed if the key stays the same —
  billing is account-side, so **no deploy/restart is required for the fix to
  take effect**; the next LLM call simply succeeds.
- **Post-fix validation (pre-staged, one action):** trigger one manual brief
  generation for `[SEED] Walkthrough Org` on staging (or wait for the Tuesday
  cron/catch-up); then §6 step 4's checks run via the customer API exactly as
  written. Enrichment validation does NOT wait on the IQ-1a merge; the
  recency/personalization checks do.

## 7b. ADDENDUM 2 (2026-08-07 15:50 UTC) — post-funding end-to-end validation: PASS

Anthropic account funded (correct org, after one wrong-org detour diagnosed via
per-service key fingerprints). OP-6 re-run: staging Ask → HTTP 200, 3.8s, real
org-grounded answer. Then one manual brief generation for `[SEED] Walkthrough
Org` (brief `528df775…`, period Jul 31 → Aug 7, 12 items from 4480 signals):

| Metric | Result |
|---|---|
| Generation time | **30 s** end-to-end (HTTP 201) |
| Enrichment success | **12/12 items (100%)** — 24/24 shortlist calls succeeded |
| Fallback rate | **0%** (zero `brief_enrichment_fallback` events in window) |
| Personalization | **5/12 items** — 100% of matchable: Cisco CVE-2026-20316 + 4 Microsoft CVEs, with `platform_context.matched_vendors` populated; the 7 unmatched items are vendors absent from the registry (correct) |
| Urgency distribution | immediate 3 / near_term 8 / far_term 1 (vs 12/12 near_term under fallback) |
| Synthesis | headline + teaser + exec_summary all present; exec summary explicitly labels old CVEs "deferred patching debt rather than new zero-days" |
| Evidence texture | 12/12 unique `why_it_matters`, 12/12 unique action plans, 7/12 actions name their own CVE; role-scoped steps (Security/SOC/IT/Compliance) with concrete hunt indicators (Exchange ECP log paths, `__VIEWSTATE` anomalies, `w3wp.exe` process parentage) |
| Stale items (BR-2, flag OFF) | **4/12 items are 2019/2020 KEV entries** (incl. BlueKeep CVE-2019-0708, Exchange CVE-2020-0688) in a "this period" brief — persists exactly as predicted until the recency flag ships |
| LLM usage observed | 26 brief calls (24 enrichment @ max 1024 + headline @ 60 + exec @ 450) + 1 Ask; ≈ $0.20–0.25 per org-brief, ~$0.02/Ask |
| Runtime errors | none (only log-level "warning" in window = a Render access-log line for the validation curl) |
| `published_at` | brief-level set correctly at publish; per-item source dates are invisible in the deployed API — that field ships in IQ-1a (`signal_published_at`) |

**Product-review deltas (unsoftened):** the briefing is now credible analyst
work — but (a) the masthead still claims "this period" over four multi-year-old
KEV entries (BR-2, fixed by the IQ-1a flag; note suppression will correctly
remove the old *Microsoft* items too — relevant old vulns already reach the
customer via the findings path); (b) some compliance references are decorative
("breach notification obligations under NIST CSF" — CSF carries no such
obligations) — enrichment-prompt tuning belongs to the B3/B4 workstream, not
IQ-1a; (c) `analyst_notes` is empty on all items (not part of enrichment
output — cosmetic); (d) cron-path briefs remain unpersonalized until IQ-1a's
scheduler parity change deploys.

**VERDICT: READY FOR IQ-1A COMMIT** (delivered in-session; sequence in §7's
commit scope + §6 operator steps: merge #748 → branch → PR → develop merge →
Blueprint sync → staging exit-gate re-run of this validation expecting stale
items suppressed, `stale_signal_suppressed` logged, `signal_published_at`
returned, cron-brief personalization live).

## 8. Remaining risks

1. **B2 changes cron-brief content going forward** (items gain personalization
   → email renderer shows "matched" badges; `notify_vendor_matches_only`
   subscribers may START receiving mail they were implicitly not getting —
   review `briefEmailSender.ts:83,146` behavior at staging validation).
2. **Personalization adds 4 sequential org-scoped reads per org per cycle** —
   negligible at current org counts; noted for scale.
3. **`signal_published_at` is read-time joined** — if a `cyber_signals` row is
   ever purged, the date disappears from old briefs (renders nothing; never
   wrong, only absent). Persisting at generation time is the durable
   alternative — deferred, needs a migration.
4. **OP-6 may reveal a quota/billing decision** — if the key is invalid, fixing
   it turns on ~12 sonnet calls per org per week plus 2 synthesis calls; size
   the spend before prod enablement.
5. **TR-5/TR-6 remain open** (WS-C/D) — evidence recorded here; no fixes in
   this phase per the stop instruction.
