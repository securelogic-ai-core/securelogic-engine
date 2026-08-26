# R-1 — Promotion Readiness Pack

**Produced:** 2026-08-21. **Read-only assessment plus a local rehearsal.**
No application code was changed, no feature flag was changed, nothing was
promoted, no production system was touched, and no production secret was read,
echoed or logged. The only writes this work performed were to a throwaway
Docker Postgres 16 on `127.0.0.1:55433` and to two files under `docs/release/`.

**Scope.** R-1 as defined in `docs/launch/SEPT15-LAUNCH-RECONCILIATION.md` §11:
establish a defensible, evidence-backed release boundary for the accumulated
`develop` → `main` promotion. R-1 does **not** promote and does not discharge
R-2 (#826), R-3 (production DSN repoint), R-4 (the B-5 ruling) or VA-3, each of
which is tracked separately and none of which is closed by this document.

**Companion artifact.** `docs/release/ROLLBACK-20261021-20261036.sql` — the
rollback procedure written and rehearsed here.

**Re-pinned:** 2026-08-26. The candidate SHA moved after this pack was produced.
The current pin, the reason it moved, and what survived the move are in **§A.0**.
Sections A.1–A.2 are preserved as the original 2026-08-21 record.

---

## A. Promotion candidate SHA and CI evidence

### A.0 RE-PIN — 2026-08-26: the candidate is `59efdab7`

The candidate minted by #853 (`65cd3330`) is **superseded**. The freeze declared
in `RELEASE-BOUNDARY-FREEZE.md` was deliberately broken three times, because the
Tier 2 gate the freeze was waiting on (#826) found real defects that must not be
promoted:

| Merge | What it fixed | Migrations added |
|---|---|---|
| `6647fc5d` (#885) | **F-1** — the async control matcher could not process global signals | 0 |
| `5fa33c2c` (#887) | **F-4** — the scheduler published telemetry it cannot measure | 0 |
| `59efdab7` (#888) | Corrected three Tier 2B criteria that would have misfired on 09-01 | 0 |

| Fact | Value | Verified by |
|---|---|---|
| **Promotion candidate** | **`59efdab7`** | `git rev-parse` |
| Subject | `Merge PR #888: docs(gate): correct three Tier 2B criteria that would misfire on 09-01 (#826)` | `git log` |
| `origin/main` tip | `011e1f1d` — unchanged | `git rev-parse` |
| Check-runs on `59efdab7` | **8/8 success**, push event | GitHub check-runs API |
| Migrations | **232 → 248 (16 pending)** — unchanged since 2026-08-21 | `git ls-tree` |

**Every migration-specific claim in this pack survives the re-mint.** The three
merges added **zero migrations**, so §C's inventory, §D's four rehearsals and the
companion `ROLLBACK-20261021-20261036.sql` are unchanged in substance. What moved
is the size of the delta (§B.1) and the SHA label.

**This document's own PR (#854) re-mints the candidate once more.** That is
accepted deliberately, and it costs nothing measurable. #854 changes only files
under `docs/` plus one test file,
`src/api/__tests__/va3CleanSoc2ExtractionRepro.test.ts`. `tsconfig.prod.json`
excludes `**/__tests__/**` and `**/*.test.ts`, and no non-test source file
differs between `59efdab7` and the merge result — so the **production build
artifact at the successor SHA is identical in content to `59efdab7`**.

The rule in §A.2 is unchanged and applies to the successor SHA: confirm 8/8
green on it, from the push-event run, before promoting.

### A.1 *(historical — 2026-08-21)* The candidate does not exist yet, and that is the correct state

| Fact | Value | Verified by |
|---|---|---|
| `origin/develop` tip | `4fe16808` | `git rev-parse` |
| `origin/main` tip | `011e1f1d` | `git rev-parse` |
| Check-runs on `4fe16808` | **0** | GitHub check-runs API |
| Workflow run for `4fe16808` | **`cancelled`**, push event, 2026-08-21T16:57:12Z | Actions API |
| Workflow run for `3a8ae09e` (its parent) | `success`, push, 2026-08-21T16:57:13Z | Actions API |

Three merges landed within 12 seconds and the concurrency group cancelled the
run for the tip while letting its ancestor's run finish. **`develop`'s current
tip therefore carries no CI evidence of its own**, and R-1's rule — green CI on
the *exact* candidate SHA, never on an ancestor or a stacked PR head — cannot be
satisfied by `4fe16808`.

This is not a defect to repair. It is resolved as a by-product of ordinary work:

> **PR #853** (`docs/sept15-launch-reconciliation` → `develop`) is open and its
> head `e0124423` is **8/8 green**. Merging it produces a new `develop` tip on
> which CI runs directly as a push event. **That tip is the promotion candidate.**

| Lane on `e0124423` | Result |
|---|---|
| `typecheck` · `lint` · `url-drift` · `test` · `audit` · `build` · `cross-org-isolation` · `tenant-coverage` | **8/8 success** |

Local pre-push checks also passed on that commit: `scripts/guard-imports.sh`,
`scripts/check-env-url-drift.mjs`, `scripts/check-contract-version.sh`.

### A.2 The rule to apply at promotion time *(still in force — see §A.0)*

1. Merge #853. Record the resulting `develop` SHA.
2. Confirm 8/8 green **on that SHA**, from the push-event run, not a PR-head run.
3. Do not allow further merges into `develop` between step 2 and the promotion.
   If one lands, the candidate moves and steps 1–2 repeat. See §N.

**R-1 cannot be marked complete on this criterion today.** It is procedurally
closed the moment #853 merges and its successor run reports green.

---

## B. Complete release delta

### B.1 Shape

Re-measured 2026-08-26 against the re-pinned candidate `59efdab7` (§A.0). The
2026-08-21 figures, taken at `4fe16808`, are shown for comparison.

| Measure | Value at `59efdab7` | Was, at `4fe16808` |
|---|---|---|
| Commits `main..develop` | **100** | 93 |
| First-parent (merge/PR level) | **63** | 59 |
| Commits `develop..main` | **2** (see §F) | 2 |
| Merge base | `38eb535f` (2026-08-16) | same |
| Files changed | **389** | 376 |
| Lines | **+43,945 / −1,414** | +40,092 / −1,413 |
| Migrations | **232 → 248** (16 pending) | **unchanged** |
| New engine route modules | **4** | 4 |
| New app pages | **0** | 0 |
| Files present on `main` but absent from `develop` | **0** | 0 |

**Measurement basis.** These are two-dot diffs — `git diff main..<candidate>`.
Stated explicitly because the original figures were reproducible only on that
basis; the three-dot form (`main...<candidate>`) reports 439 files at the
re-pinned candidate, and mixing the two makes the delta look like it grew by 50
files when it grew by 13.

### B.2 Classification of the 59 first-parent commits

| Class | Count | What it is | Customer-visible on promotion? |
|---|---|---|---|
| **Security remediation** | 10 | #799/#800 Postgres TLS verification · #807 token digest at rest · #812 dependency advisories · #813 anomaly client identity · #814 rate-limiter client identity · #816 durable anomaly record · #819 session epoch · #820 app sign-out on engine invalidation · #825 SSO public-origin redirect | No — behaviour is strictly more restrictive |
| **M-1 tenant channel** | 5 | #802–#806 grant catch-up, per-site channel closures, activation preflight | No — `app_request` flip is **not** in scope |
| **E-1 / E-2 tenant data governance** | 11 | Already on `main` by content (§F); these are develop's own commits for the same work | No — already live and dark |
| **Release / IaC / docs** | 8 | Wave-1 target-state declarations, promotion-audit sections, INF-1 | No |
| **Reliability Wave 4** | 1 | #817 Brief scheduler + LLM control-matcher stack | No — flag-dark; gated by #826 |
| **Observability** | 1 | #811 record when a control-match suggestion is surfaced | No |
| **Billing SL-BILL-1** | 7 | #829–#835 dunning convergence, ordering watermark, failure notice, metrics, grace period, dead-field removal, resubscribe path | **Partly — see §I** |
| **Findings / risk** | 9 | #837 finding↔risk link · #838 SLA settings UI · #839 Decision Workspace · #840 pen-test intake · #841 exception ≠ closure · #842 vulnerability findings · #843–#845 per-asset occurrences | **Partly — see §I** |
| **Support / IR documentation** | 3 | #846–#848 — the entire support runbook set and the minimum incident-response program | Yes, and it is pure gain (§J) |
| **Reporting** | 1 | #849 REPORT-1 | No — `SECURELOGIC_RISK_INTELLIGENCE_ENABLED=false` in prod |
| **Vendor Assurance** | 3 | #850–#852 CUEC determination, promotion to findings, review UI | **Partly — see §I** |

### B.3 The single most important property of this delta

**Production is running without every security fix since 2026-08-17.** None of
`a6c3e6cd` (#799), `903518bd` (#807), `9e0af404` (#812), `4a945257` (#813),
`842f499d` (#814), `8868859d` (#819), `8484b366` (#820), `f817998c` (#825) is an
ancestor of `main`. Corroborated independently at push time: GitHub reports
**65 open Dependabot advisories (40 high, 25 moderate) on the default branch**,
which is `main` — #812's remediation has not reached it.

The promotion is outstanding security remediation. Every day it is deferred is a
day production runs known-fixed vulnerabilities.

---

## C. Migration inventory and risk classification

### C.1 Inventory, in promotion order

`runMigrations.ts` applies files in **`Array.prototype.sort()` order** — UTF-16
code-unit order, i.e. C collation. This is load-bearing and is *not* the same as
`ls | sort` under a UTF-8 locale, which ignores punctuation and would have
placed `20260505_signal_match_suggestions_score_type_fix.sql` **before** the
migration that creates the table. The rehearsal harness reproduced the C order
explicitly; see §D.0.

| # | File | Class | Reversible? |
|---|---|---|---|
| 1 | `20261021_m1_g1_app_request_grant_catchup` | GRANT only (11 tables) | Yes — REVOKE |
| 2 | `20261022_m1_g2_sso_login_codes_export_read` | GRANT only | Yes — REVOKE |
| 3 | `20261023_llm_control_matcher_verdicts` | New table + RLS + policy | Yes — DROP (destroys rows) |
| 4 | `20261024_jobs_control_matcher_suggest` | CHECK re-stated, **widening** | Conditional — §E.3 |
| 5 | `20261025_signal_match_suggestion_surfaced` | 4 new columns + 1 index | Yes — destroys the columns |
| 6 | `20261026_users_session_epoch` | 1 new column NOT NULL DEFAULT 0 | Yes — **but see §E.1** |
| 7 | `20261027_organizations_stripe_event_watermark` | 2 new columns | Yes — **but see §E.2** |
| 8 | `20261028_billing_dunning_cycles` | New table + RLS + policy | Yes — DROP (destroys rows) |
| 9 | `20261029_finding_risk_links` | New table `finding_risks` + RLS | Yes — DROP (destroys rows) |
| 10 | `20261030_pen_test_findings` | New table + 4 columns + CHECK widened + **DROP NOT NULL** | Conditional — §E.4 |
| 11 | `20261031_finding_risk_exceptions` | 3 columns + CHECK + **unique index widened** + WORM fn replaced | Conditional — §E.5 |
| 12 | `20261032_vulnerability_findings` | 5 columns + CHECK widened + new CHECK + index | Conditional — §E.3 |
| 13 | `20261033_asset_identifiers` | New table + RLS | Yes — DROP (destroys rows) |
| 14 | `20261034_finding_asset_occurrences` | New table + RLS | Yes — DROP (destroys rows) |
| 15 | `20261035_vulnerability_observations` | **3** new tables + RLS | Yes — DROP (destroys rows) |
| 16 | `20261036_cuec_gap_determination` | 2 columns + 3 CHECKs re-stated + 2 indexes | Conditional — §E.6 |

### C.2 What the promotion actually changes, measured

Established by building both schemas from empty on Postgres 16.14 and diffing
the catalog, not by reading the SQL:

- **9 new tables** — `llm_control_matcher_verdicts`, `billing_dunning_cycles`,
  `finding_risks`, `pen_test_engagements`, `asset_identifiers`,
  `finding_asset_occurrences`, `vulnerability_scan_runs`,
  `vulnerability_scan_run_assets`, `vulnerability_observations`. All nine
  `ENABLE ROW LEVEL SECURITY` with a tenant-isolation policy at creation.
- **23 new columns on 6 pre-existing tables** — `findings` (10),
  `finding_risk_acceptances` (3), `vendor_assurance_cuecs` (2),
  `signal_match_suggestions` (4), `organizations` (2), `users` (1).
- **1 NOT NULL dropped** — `findings.severity`.
- **4 CHECK constraints re-stated**, not three:
  `findings_source_type_check` (+`pen_test`, +`vulnerability`),
  `jobs_job_type_check` (+`control_matcher_suggest`),
  `vendor_assurance_cuecs_review_status_check` (+`not_applicable`, +`satisfied`, +`gap`),
  and `vendor_assurance_cuecs_review_status_consistency`, which is **not purely
  widening** — it widens the reviewed branch from `= 'reviewed_no_match'` to
  `<> 'pending'` while *narrowing* the `pending` branch with
  `gap_basis IS NULL AND promoted_finding_id IS NULL`. That narrowing is
  vacuous on arrival because both columns are created in the same migration, so
  it is forward-safe — but it is a narrowing, and §2.3 of the reconciliation
  understates both the count and the direction. **Correction recorded here.**
- **29 new CHECK constraints**, all on new tables or new columns.
- **1 unique index replaced** — `finding_risk_acceptances_one_live (finding_id)`
  → `_one_live_per_kind (finding_id, kind)`. A **widening**.
- **1 trigger function replaced** — `finding_risk_acceptances_enforce_worm()`.
- **45 new GRANTs to `app_request`.**
- **Zero** `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `DELETE FROM`, column type
  change, or `SET NOT NULL` on any pre-existing column.

### C.3 Arrival risk — forward

**Forward application is proven, not asserted.** All 16 applied cleanly against
a schema built from empty (§D.1). The remaining forward risk is **lock
contention, not correctness**, and it has one specific shape.

`render.yaml` starts the production engine with `npm run migrate && npm start`.
Under Render's zero-downtime deploy the *old* instance keeps serving — and
keeps writing — while the *new* instance runs the migration. So every lock
below contends with live traffic.

| Table | Blocking DDL in the batch | Lock |
|---|---|---|
| `findings` | 3 × `ADD CONSTRAINT … CHECK` (validating), 2 × `ADD COLUMN` with inline CHECK, 1 × `CREATE INDEX` | ACCESS EXCLUSIVE + **full table scan**; then SHARE for the index |
| `vendor_assurance_cuecs` | 3 × `ADD CONSTRAINT … CHECK`, 2 × `CREATE INDEX` | ACCESS EXCLUSIVE + **full scan**; then SHARE ×2 |
| `finding_risk_acceptances` | 1 × `ADD CONSTRAINT … CHECK`, 2 × `CREATE INDEX` | ACCESS EXCLUSIVE + **full scan**; then SHARE ×2 |
| `jobs` | 1 × `ADD CONSTRAINT … CHECK` | ACCESS EXCLUSIVE + **full scan** |
| `signal_match_suggestions` | 1 × `CREATE INDEX` | SHARE — blocks writes for the build |
| `users`, `organizations` | `ADD COLUMN` with constant default | ACCESS EXCLUSIVE, metadata-only (PG11+ fast default) |

**No migration uses `NOT VALID`, and no index is built `CONCURRENTLY`.**

Two properties make this bounded rather than dangerous:

- `MIGRATION_LOCK_TIMEOUT` defaults to **5s**, so a migration that cannot
  acquire its lock **fails fast** rather than queueing behind live writes and
  stalling every reader behind it. A failed `npm run migrate` fails the deploy;
  the old engine keeps serving. The failure mode is *a deploy that must be
  retried*, not *a production stall*.
- `MIGRATION_STATEMENT_TIMEOUT` defaults to **300s**, capping any single scan.

**What R-1 cannot size:** whether those scans fit inside 300s depends on
production row counts, which this session has no credential to read. That is
one read-only, secret-free query, listed in §H as **OP-5**.

### C.4 Arrival risk — rollback

Covered in §D and §E. Summary: **rollback is clean while the new capabilities
are unused, and becomes a data-destruction decision the moment they are used.**

---

## D. Rollback rehearsal results

**Environment.** Docker `postgres:16` (server 16.14) on `127.0.0.1:55433`,
created for this exercise and disposable. Postgres 16 matches the harness
standard used by `cross-org-isolation` and by every prior validation record.

**Method.** `scripts/apply.sh` reproduces `applyMigration()` exactly — one
transaction per file, `SET LOCAL lock_timeout='5s'`,
`SET LOCAL statement_timeout='300s'`, filename recorded in `schema_migrations`
on success — so a mid-batch failure lands on a file boundary just as it would
in production.

### D.0 A harness defect worth recording

The first attempt failed at `20260505_signal_match_suggestions_score_type_fix`
with *"relation signal_match_suggestions does not exist"*. The cause was the
**harness**, not the repository: `ls | sort` under a UTF-8 locale ignores
punctuation and ordered `…_score_type_fix.sql` before `….sql`, whereas Node's
`Array.sort()` — what `listMigrationFilenames` actually uses — is C order and
gets it right. Re-run with `LC_ALL=C sort`, the chain built cleanly.

Recorded because it is a live trap for anyone who reimplements migration
ordering in a shell script, a container entrypoint or a CI step.

**By-product:** `main`'s 232-migration chain **rebuilds from an empty database
cleanly** — 232/232, zero failures. That is a property nothing else in this
repository currently asserts on `main`.

### D.1 Forward — PASS

| Database | Built | Result |
|---|---|---|
| `base232` | `main`'s 232 migrations from empty | **232/232, 0 failures** |
| `fwd248` | `base232` + the 16 pending | **16/16, 0 failures** |

### D.2 Rehearsal 1 — clean rollback, no post-promotion data — **PASS**

Rolled `fwd248` back and compared `pg_dump --schema-only` (including ACLs)
against the never-promoted `base232`:

> **IDENTICAL — 0 differences across 13,068 lines of DDL**, covering tables,
> columns, constraints, indexes, functions, triggers, RLS policies and GRANTs.
> `schema_migrations` = 232.

The first pass was **not** clean: one `COMMENT ON COLUMN
vendor_assurance_cuecs.review_status` survived the rollback, leaving the schema
documenting four determination states that the restored CHECK rejects. The
rollback script was corrected to reset it, and the run above is the corrected
script. This is exactly the class of defect a rehearsal exists to find.

### D.3 Rehearsal 2 — rollback with representative data — **PASS**

Seeded pre-promotion data through `base232` (2 organisations, 2 users, a
vendor, a SOC 2 document, a CUEC, 3 findings across both tenants, a live
risk-acceptance, a job), promoted, then added promoted-code writes (a Risk
Register entry, a `finding_risks` link, an advanced `session_epoch`), then
rolled back.

| Check | Result |
|---|---|
| Schema vs never-promoted `base232` | **IDENTICAL** |
| Every pre-promotion row, md5 per table, before vs after the round trip | **IDENTICAL** — including `findings`, `users`, `finding_risk_acceptances` and `vendor_assurance_cuecs`, whose row text changed under promotion and returned exactly |
| Rows written by promoted code into **pre-existing** tables | **Survive** — the `risks` row is still there, correctly |
| Rows written into **new** tables | Destroyed, and **counted and named by the pre-flight before the destruction** |

### D.4 Rehearsal 2b — behavioural coherence, not just executable SQL — **PASS**

Schema equality does not prove the application can run. These probes were run
against the rolled-back database:

| Probe | Expected | Result |
|---|---|---|
| Restored WORM trigger refuses `proposed → expired` | refuse | **REFUSED** |
| Restored WORM trigger refuses mutating `finding_id` | refuse | **REFUSED** |
| Restored WORM trigger permits `proposed → withdrawn` | accept | **ACCEPTED** |
| `findings.source_type = 'vulnerability'` | refuse | **REFUSED** |
| `findings.severity = NULL` | refuse | **REFUSED** |
| `jobs.job_type = 'control_matcher_suggest'` | refuse | **REFUSED** |
| `vendor_assurance_cuecs.review_status = 'gap'` | refuse | **REFUSED** |
| A normal pre-promotion finding INSERT | accept | **ACCEPTED** |
| **Every foreign key in the database re-validated** | all valid | **330 constraints checked, 0 broken** |

The trigger probes matter most. The rollback must restore the *pre-promotion
body* of `finding_risk_acceptances_enforce_worm()` **before** dropping the
`kind` column it references; reversed, every UPDATE on that table would fail
against a column that no longer exists. The script orders it correctly and the
probes prove the restored function behaves, rather than merely parsing.

**Answer to "coherent state, or merely executable SQL":** coherent. Schema
bit-identity, byte-identical pre-promotion data, live constraint enforcement
matching the 232 contract, and full referential integrity.

### D.5 Rehearsal 3 — partial promotion — **PASS**

Because each migration commits independently, a failed deploy stops at a file
boundary. Rollback was rehearsed from four such states:

| Died after | Rollback | `schema_migrations` | Schema |
|---|---|---|---|
| 1/16 (`20261021`) | rc=0 | 232 | **IDENTICAL to 232** |
| 5/16 (`20261025`) | rc=0 | 232 | **IDENTICAL to 232** |
| 9/16 (`20261029`) | rc=0 | 232 | **IDENTICAL to 232** |
| 13/16 (`20261033`) | rc=0 | 232 | **IDENTICAL to 232** |

Every partial state reverses to a bit-identical pre-promotion schema.

### D.6 Rehearsal 4 — rollback against *used* capabilities — **REFUSED, correctly**

The decisive rehearsal. A database was promoted and then exercised the way a
customer would: a `vulnerability` finding with a CVE and CVSS, a `pen_test`
finding with **NULL severity** and a verbatim `source_severity`, a
`control_matcher_suggest` job, a CUEC determined as a **gap** and **promoted to
a finding**, and a live **exception** alongside a live acceptance on one
finding.

The rollback **refused, atomically, changing nothing**, and named all five
blockers with counts:

1. 2 findings with `source_type IN (pen_test, vulnerability)`
2. 1 finding with `severity IS NULL`
3. 1 job with `job_type = control_matcher_suggest`
4. 1 CUEC carrying a determination the old vocabulary cannot express
5. 1 finding holding more than one live risk-acceptance record

…and separately reported two losses that are *not* blockers but *are*
destruction: the CUEC→finding promotion link, and the exception/acceptance
distinction.

Post-attempt state verified: **248 migrations, 5 findings, 1 gap CUEC — nothing
changed.**

> **This is the governing finding of R-1. The rollback has a shelf life.** It is
> a clean, proven, bit-exact reversal for as long as the new capabilities go
> unused, and it becomes an irreversible product decision the first time a
> customer records a gap determination, imports a vulnerability, or authorises
> an exception. **That is the strongest technical argument for promoting dark
> and activating separately** — a dark promotion keeps the rollback inside its
> shelf life for the entire window in which something might go wrong.

---

## E. Irreversible, destructive and data-loss behaviour — explicit

Nothing in this batch destroys data on the way **forward**. Everything below is
about the way **back**.

### E.1 `users.session_epoch` — a security regression on rollback

Dropping the column returns every counter to absent. On a later re-promotion
each user restarts at 0, so **a session token minted before the rollback and
carrying `se=0` becomes valid again**. Rolling back re-opens SEC-JWT-EPOCH
(#819), and re-promoting does **not** close it for already-minted tokens.

**Mandatory mitigation:** after any rollback, force a global session
invalidation by the pre-#819 mechanism *before* re-promoting. The script raises
this as a `SECURITY:` notice naming the affected user count.

### E.2 `organizations.stripe_billing_event_*` — billing can move backwards

These two columns are the SL-BILL-1 PR-D event-ordering watermark. Without
them, Stripe webhooks that are replayed or arrive out of order after a rollback
can move billing state backwards. **Suspend billing webhook processing across
any rollback window.** Raised as a `BILLING:` notice.

### E.3 CHECK vocabulary restoration — refuses rather than corrupts

`findings.source_type`, `jobs.job_type` and
`vendor_assurance_cuecs.review_status` all widen forward. Restoring the narrower
constraint **fails** if any row uses a new value. The pre-flight refuses with a
count. Collapsing a `gap` back to `reviewed_no_match` would destroy a human
determination, so this is deliberately not automated.

### E.4 `findings.severity SET NOT NULL` — cannot be satisfied automatically

A finding ingested with an unmappable source severity has `severity IS NULL`.
There is no correct automatic value: assigning one **manufactures an assessment
nobody made**. The pre-flight refuses and requires a per-finding decision.

### E.5 `finding_risk_acceptances_one_live` — cannot be satisfied automatically

The promoted schema legalises one live acceptance **and** one live exception on
the same finding. Recreating the narrower unique index fails on exactly that
state. Withdrawing one is a governance decision, not a cleanup, so the
pre-flight refuses.

Separately — and this is the subtler harm — dropping `kind` makes surviving
**exception** records indistinguishable from **acceptances**, and under the
pre-promotion contract an acceptance *closes* its finding. **Findings with
outstanding remediation would read as closed after a rollback.** Raised as a
`LOSS:` notice with instruction to export first.

### E.6 CUEC provenance

`vendor_assurance_cuecs.promoted_finding_id` is dropped. The findings survive;
**the provenance chain from finding back to the CUEC that justified it does
not.** Raised as a `LOSS:` notice.

### E.7 Nine tables dropped outright

Every row written to `llm_control_matcher_verdicts`, `billing_dunning_cycles`,
`finding_risks`, `pen_test_engagements`, `asset_identifiers`,
`finding_asset_occurrences`, `vulnerability_scan_runs`,
`vulnerability_scan_run_assets` and `vulnerability_observations` is destroyed.
The pre-flight counts and names each non-empty table before proceeding.

### E.8 Ordering constraint on any rollback

The script is the **schema half** of a code rollback and is only correct once
the engine has already been reverted:

> **1.** revert app → **2.** revert workers → **3.** revert engine → **4.** run the script

Run against the promoted engine it breaks that engine immediately, because it
drops columns and tables the promoted code reads unconditionally.

---

## F. `main` / `develop` divergence — reconciled, not resolved mechanically

### F.1 What the two commits are

| Commit | Date | Subject |
|---|---|---|
| `011e1f1d` | 2026-08-17 | `chore(release): E-1 + E-2 dark production promotion (#797)` |
| `5e108365` | 2026-08-16 | `release: E-1 dark production promotion — tenant data governance, activation NOT authorized` |

Both are **release-mechanics commits**: squashed promotions of work that
originated on `develop`. They are not independent development.

### F.2 Evidence that nothing on `main` would be lost

1. **Zero files** exist on `main` and not on `develop`.
2. Of the 59 files the two commits touched, only **four** differ between the
   branches, and in every case `develop` is strictly ahead:

| File | `main` | `develop` |
|---|---|---|
| `src/api/lib/dataClassification.ts` | 7 tables `rlsStatus: "pending"` | `"enabled"`, plus 8 new table classifications |
| `src/api/routes/ask.ts` | `ipKeyGenerator(req.ip)` | `rateLimitKeyGenerator(req)` — the #814 fix |
| `src/api/__tests__/vendorEntitlementGate.test.ts` | expects 19 routes | expects 20 — VA-1 added one |
| `test/isolation/erasureExecutor.test.ts` | a 1 ms timing race | the #815 fix |

Taking `develop` in each case adopts a fix or an addition. Nothing regresses.

### F.3 A true merge conflicts — this is not mechanical

Probed locally on a throwaway branch (created, tested, deleted; nothing pushed):

```
git merge --no-commit --no-ff origin/develop      # onto origin/main
→ CONFLICT in 5 files
   docs/backlog/INFRASTRUCTURE_BACKLOG.md   (add/add)
   render.yaml                              (content)
   src/api/lib/dataClassification.ts        (content)
   src/api/lib/governance/dataClasses.ts    (add/add)
   test/isolation/erasureExecutor.test.ts   (add/add)
```

The add/add conflicts are the signature of content that reached `main` as a
**squashed** release commit while `develop` carries the same content in its own
commits: git sees two independent additions.

Each conflict was inspected rather than auto-resolved:

- **`render.yaml`** — all three hunks are develop-side **additions against an
  empty `main` side**. Nothing on `main` is discarded. They add
  `DATABASE_TLS_NO_VERIFY="false"` to the production engine and intelligence
  worker (the #799 incident hatch, declared **off**) and
  `SECURELOGIC_RISK_INTELLIGENCE_ENABLED="false"` to the production app
  (REPORT-1, deliberately dark). All three are correct and all three are
  **safe for a dark promotion**.
- **`dataClassification.ts`** — `main` says `vendors … rlsStatus: "pending"`,
  `develop` says `"enabled"`. Develop is current.
- **`dataClasses.ts`** — `main` side empty; develop adds a governed retention
  class. Pure addition.
- **`erasureExecutor.test.ts`** — develop carries the #815 race fix; `main`'s
  version is the flaky one.
- **`INFRASTRUCTURE_BACKLOG.md`** — documentation; develop is current.

### F.4 Correct integration treatment, with a verifiable acceptance test

> **A true merge commit of `develop` into `main`, resolving every conflict to
> the `develop` side — and then verifying that the resolved tree is byte-identical
> to `origin/develop`'s tree before committing.**

That verification is what makes this non-mechanical: the resolution is not
trusted, it is **checked**.

```
git checkout main && git merge --no-commit --no-ff -X theirs origin/develop
git add -A && git write-tree      # must equal `git rev-parse origin/develop^{tree}`
```

**Proven locally: the resolved tree equals `origin/develop`'s tree exactly**
(the only delta observed was this session's own untracked rollback script,
which `git add -A` had picked up).

Why a merge commit and not a squash or a rebase:

- It makes `origin/main..origin/develop` **0** afterwards, which a squash does
  not, leaving the branches permanently divergent and the next promotion worse.
- It preserves `011e1f1d` and `5e108365` in `main`'s history, so the record of
  what production actually ran between 2026-08-16 and the promotion survives.
- A rebase would rewrite `main`, which is the deployed branch.

---

## G. Flag and configuration reconciliation

**Source and its limit.** Every value below is read from `render.yaml`
(**declared** state). No production dashboard was read and no secret was
accessed, echoed or logged. **Declared is not synced** — this repository has
previously found a flag that `render.yaml` declared and the staging service did
not carry. Confirming synced state is **OP-1** in §H.

### G.1 New environment keys introduced by the promotion — five, all safe

| Key | Semantics | Production declaration |
|---|---|---|
| `SECURELOGIC_BILLING_GRACE_ENABLED` | `=== "true"` → **default-deny** | **`"false"`** |
| `SECURELOGIC_BILLING_GRACE_DAYS` | numeric | `"15"` |
| `SECURELOGIC_BRIEF_REAPER_DISABLED` | `=== "true"` → default-off | undeclared (= off) |
| `SECURELOGIC_SIGNAL_SWEEPER_DISABLED` | `=== "true"` → default-off | undeclared (= off) |
| `SECURELOGIC_DB_STRICT_TENANT_LOG` | `=== "true"` → default-off | undeclared (= off) |

> **The promotion introduces exactly one new customer-affecting feature flag,
> and production declares it `false`.** This is the cleanest possible result and
> is the second strongest argument for promoting dark.

Note the grace flag must stay off until the Stripe retry window is reconciled
against `GRACE_DAYS=15` — an existing, separately tracked item.

### G.2 Pre-existing flags gating promoted surfaces — production state

| Flag | Prod | Staging | Effect on promotion |
|---|---|---|---|
| `SECURELOGIC_DECISION_WORKSPACE_ENABLED` | `false` | `true` | Decision Workspace stays dark |
| `SECURELOGIC_RISK_WORKSPACE_ENABLED` | `false` | `true` | Risk workspace stays dark |
| `SECURELOGIC_FINDINGS_QUEUE_CONTROLS_ENABLED` | `false` | `true` | Queue controls stay dark |
| `SECURELOGIC_RISK_INTELLIGENCE_ENABLED` | `false` | `true` | REPORT-1 executive view stays dark |
| `SECURELOGIC_ASSET_REGISTRY_ENABLED` | `false` | `true` | Asset registry stays dark |
| `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED` | `false` | `true` | ECL stays dark |
| `SECURELOGIC_DASHBOARD_BRIEFING_ENABLED` | `false` | `true` | Stays dark |
| `SECURELOGIC_RISK_ACCEPTANCE_ENABLED` | **undeclared** | `true` | Resolver is `=== "true"` → **default-deny**; exceptions (SL-EXC-1) stay dark. **Verified in `riskAcceptanceFeatureFlag.ts`, not assumed.** |
| `SECURELOGIC_VENDOR_ASSURANCE_ENABLED` | `true` (worker) | undeclared | Vendor Assurance extraction is **live in production** |
| `SECURELOGIC_LEGACY_VENDOR_WRITES_ENABLED` | `true` | `false` | Prod keeps legacy writes; a Wave-1 target, not this promotion |

### G.3 Undeclared-flag surface

**84** `SECURELOGIC_*` keys are read by engine/app/worker code on `develop`;
**45** appear in `render.yaml`. The 40-key gap is pre-existing and is not
created by this promotion; the five keys the promotion *does* add are in §G.1.
Every `_ENABLED` gate examined for a promoted surface used `=== "true"`
(default-deny). A full default-deny audit of all 84 is worth doing but is **not
an R-1 blocker** — it is unchanged by this release.

### G.4 A deployment-mechanics finding that R-5 depends on

`render.yaml` declares **`autoDeploy: true` on every production service** —
engine, app, and all four workers. Only `securelogic-website` is `false`.

> **The reconciliation's R-5 deploy order "engine → workers → app" is not
> achievable under the current Blueprint.** The moment `main` moves, all six
> services deploy concurrently. Only the engine runs `npm run migrate`; the
> workers `node dist-…/index.js` straight away.

Concrete consequence: the intelligence worker can boot on promoted code and
attempt to enqueue `job_type='control_matcher_suggest'` *before* `20261024`
lands, violating the old `jobs_job_type_check` and erroring. The window is
short, bounded, and self-healing — but it is real, it will produce errors, and
it is invisible to `/health` because workers have no HTTP endpoint.

Two ways to close it, both operator actions (**OP-4**):
1. Set `autoDeploy: false` on the four workers and the app, promote, let the
   engine migrate, then deploy the rest manually and restore the setting; or
2. Accept a bounded window of worker errors and watch for them explicitly.

This is a **new finding** and is not recorded in the reconciliation.

### G.5 R-3 has a second, lower-risk option

`src/api/infra/pgSsl.ts` documents `DATABASE_SSL_SERVERNAME`: verify the chain
against system roots but check the certificate hostname against a **supplied**
name rather than the DSN's host. Because Render's certificate SANs cover only
the public `*.{region}-postgres.render.com` names, setting this to the
database's external hostname satisfies #799's verification **while leaving the
internal DSN in place**.

R-3 is stated in the reconciliation only as an external-URL repoint. This is a
second route to the same outcome, it does not move database traffic onto the
public internet, and it should be considered before the repoint. **Operator
decision — recorded as OP-2, not taken here.**

---

## H. Operator-owned actions — separated from code

No item below can be closed by this session, and **none is marked complete**.
None requires a secret to be revealed to anyone, including this assistant.

| ID | Action | Why it is operator-owned | Blocks promotion? |
|---|---|---|---|
| **OP-1** | Confirm each production service's **synced** env matches `render.yaml`'s declared state for the flags in §G.2 | Requires dashboard/API access; declared ≠ synced has bitten before | **Yes** |
| **OP-2** | **R-3.** Decide and apply either the external-URL DSN repoint *or* `DATABASE_SSL_SERVERNAME` (§G.5) on all six production services | Requires reading and writing production DSNs | **Yes** — #799 makes TLS verification mandatory; workers fail live-but-broken and `/health` cannot see it |
| **OP-3** | **R-4.** Record the B-5 ruling: dark promotion or target-state promotion | A product/authority decision | **Yes** |
| **OP-4** | Decide the deploy-order treatment in §G.4 | Changes Blueprint/dashboard state | **Yes** |
| **OP-5** | Run `SELECT count(*)` on `findings`, `vendor_assurance_cuecs`, `finding_risk_acceptances`, `jobs`, `signal_match_suggestions` in production and confirm the validating scans in §C.3 fit inside `statement_timeout=300s` | Requires a production DB connection. Read-only, returns no personal data, exposes no secret | **Yes** |
| **OP-6** | Take a physical backup / PITR marker immediately before promotion | Production credential | **Yes** |
| **OP-7** | **R-2.** Observe #826 Tier 2 at the 2026-08-25T07:00Z window and complete its 27-box checklist with live log evidence | The cron fires weekly; nothing can accelerate it | **DISCHARGED 2026-08-26** — #826 **closed**: Tier 2A 14/14, Tier 2B 14 PASS + 2 N/A. It found F-1 and F-4, which is why the candidate moved (§A.0) |
| **OP-8** | Merge PR #853 and confirm 8/8 green on the resulting `develop` SHA (§A.2) | Merge authority | **DISCHARGED** — superseded by the re-pin: candidate is `59efdab7`, 8/8 green (§A.0). The rule persists for the successor SHA this pack's own PR mints |
| **OP-9** | Confirm the staging Stripe price-ID transposition does not exist in production | Requires Stripe production access | No — activation-time |
| **OP-10** | If a rollback is ever executed: global session invalidation (§E.1) and billing-webhook suspension (§E.2) | Production operations | Contingent |

---

## I. Customer-visible capability changes on promotion

The test applied: *with production's declared flags unchanged, what does a
logged-in, entitled customer see or reach that they could not before?*

### I.1 The dark-promotion claim needs one correction

The reconciliation says every new capability is "either entitlement-gated or
flag-dark". That is true — but **entitlement-gated is not dark**. Three of the
four new engine routes carry `requireEntitlement("premium")` and **no feature
flag**:

| Route | Gate | Reachable on promotion |
|---|---|---|
| `findingRiskLinks.ts` | `requireEntitlement("premium")` only | **Yes** |
| `findingAssetOccurrences.ts` | `requireEntitlement("premium")` only | **Yes** |
| `penTestEngagements.ts` | `requireEntitlement("premium")` only | **Yes** |
| `adminDunningMetrics.ts` | inherits `adminChain` (`requireAdminKey`) — verified mounted before the individual admin routers | Staff only |

### I.2 Newly reachable, no flag

**Zero new app pages ship in this release.** Every customer-visible change is a
modification to a page that already exists.

| Surface | Change | Gate |
|---|---|---|
| `settings/risk-policy` | SL-SLA-UI — admins configure the remediation SLA | Entitlement only |
| `risks/[id]` | Findings linked to a Risk Register entry | Entitlement only |
| `account` | SL-BILL-1 — payment-failure notice, corrected entitlement logic, resubscribe path | Entitlement only |
| `findings` list | Two new filter values: **Vulnerability** and **Penetration Test** | **No gate at all** |
| `findings/[id]` | Affected-assets panel; Risk Register panel | Rendered in both layouts; the Decision Workspace half stays dark |
| API | Finding↔Risk links, affected assets, pen-test engagements | Entitlement only |

**One honest wart.** The two new findings filters are visible to every customer
with findings access, and production holds no `vulnerability` or `pen_test`
findings. **Both filters will return zero results for every customer on day
one.** Not a defect — a filter that finds nothing because nothing exists — but
it is a customer-visible surface advertising a capability with no data behind
it. It is exactly the pattern TRUTH-1 exists to address.

### I.3 Remaining dark

Decision Workspace · Risk Workspace · findings queue controls · REPORT-1
executive risk view · asset registry · Enterprise Context · dashboard briefing ·
risk exceptions (SL-EXC-1, via default-deny) · billing grace period · Wave 4
Brief scheduler and LLM control matcher.

### I.4 Net assessment

A dark promotion changes **no gated behaviour**. It does expose a small,
entitlement-gated API surface and four modified pages to paying customers. Every
one of those is additive, none removes or changes an existing behaviour, and all
of them carry support runbooks (§J). **The exposure is real but small, and it is
correctly characterised as "entitlement-gated", not "dark".**

---

## J. Runbook and recovery coverage

### J.1 Production currently has no support runbooks at all

The **entire** `docs/runbooks/support/` tree — 30 files including the authority
model, the definition of done and 27 SR runbooks — is **new in this delta**
(SUPPORT-1/2, #846/#847), as is the minimum incident-response program
(SUP-SEC-1, #848).

> Support-readiness is not a cost of this promotion. It is one of its largest
> deliverables, and it is currently sitting entirely on the wrong side of the
> release boundary.

### J.2 Coverage against every newly reachable failure mode

| Newly reachable surface | Runbook | Status |
|---|---|---|
| Remediation SLA missing/wrong (SL-SLA-UI) | `SR-033` | **Covered** |
| Finding↔Risk link or promotion (SL-RISK-LINK) | `SR-030` | **Covered** |
| Affected-assets count unexpected (SL-OCC-1) | `SR-024` | **Covered** |
| Asset resolution failure (SL-OCC-1) | `SR-023` | **Covered** |
| Vulnerability reappeared / still active (SL-OCC-2) | `SR-025` | **Covered** |
| Scan-scope absence disagreement (SL-OCC-2) | `SR-026` | **Covered** |
| Vulnerability import failure (SL-VULN-1) | `SR-020` | **Covered** |
| Vulnerability with no severity → no SLA | `SR-022` | **Covered** — the customer-facing face of §E.4 |
| Payment failure / dunning (SL-BILL-1) | `SR-003`, `SR-041` | **Covered** |
| Resubscription checkout failure (SL-BILL-1 PR-H) | `SR-042` | **Covered** |
| CUEC determination or gap promotion (VA-1/VA-2) | `SR-016` | **Covered** — names the four determination states, `gap_reason_required`, and records the release dependency explicitly |
| Reporting failure (REPORT-1) | `SR-015` | **Covered** (surface stays dark) |
| **Pen-test engagement intake (SL-PENTEST-IN)** | — | **GAP** |

### J.3 The one gap

No SR runbook covers pen-test engagement intake; it is mentioned only in the
support README. Severity is low: `penTestEngagements.ts` is an **API-only**
surface — PEN-1, the UI, is not built — so a customer cannot reach it through
the product and cannot raise a ticket about it. **Not a promotion blocker.**
Worth writing as `SR-021` before PEN-1 ships, not before this promotion.

### J.4 Recovery coverage

`docs/release/ROLLBACK-20261021-20261036.sql` is written, corrected once by
rehearsal, and proven across four scenarios (§D). The two contingent operator
actions it triggers — global session invalidation and billing-webhook
suspension — are stated in the script itself and in §E.1/§E.2, and are recorded
as **OP-10**.

---

## K. Remaining R-1 blockers

| # | Blocker | Owner | State |
|---|---|---|---|
| K-1 | Green CI on the **exact** candidate SHA | Operator (**OP-8**) | **CLOSED 2026-08-26** — `59efdab7` carries its own 8/8 push-event run (§A.0). Re-opens on any further merge into `develop`, including this pack's own PR — re-confirm on the successor SHA |
| K-2 | Production row counts for the five tables taking validating scans, to confirm they fit in 300s | Operator (**OP-5**) | **OPEN** |
| K-3 | Confirm production's **synced** flag state matches `render.yaml`'s declared state | Operator (**OP-1**) | **OPEN** |
| K-4 | Decide the deploy-order treatment — `autoDeploy: true` on all six production services defeats the stated engine→workers→app order | Operator (**OP-4**) | **OPEN — new finding, §G.4** |
| K-5 | Physical backup / PITR marker taken immediately before promotion | Operator (**OP-6**) | **OPEN** |

Everything else R-1 owed is **closed**: the delta is classified (§B), the
migration inventory and arrival-risk assessment are written (§C), the rollback
procedure is written and rehearsed on a fresh database across four scenarios
(§D), irreversible behaviour is enumerated (§E), the divergence is reconciled
with a verifiable acceptance test (§F), flags are reconciled without touching a
secret (§G), operator actions are separated (§H), the customer-visible surface
is inventoried (§I) and runbook coverage is checked with one non-blocking gap
identified (§J).

---

## L. Remaining R-2 / R-3 / R-4 blockers — untouched by R-1

| Gate | State | Note |
|---|---|---|
| **R-2 — issue #826, Tier 2** | **OPEN, hard gate.** Window **2026-08-25T07:00:00Z** | The edition boundary rolls only on Tuesdays; nothing can accelerate it and destructive staging fixtures are out of bounds. Wave 4 is **DEGRADED, not PASS** — all 13 orgs returned `skipped_already_current`, so concurrency and the verdict cache were never exercised and no soak duration fixes that. **Issue #826 was not read, modified, commented on or otherwise disturbed by this work.** |
| **R-3 — production DSN** | **OPEN, operator-owned (OP-2).** | #799 makes TLS verification mandatory; internal Render DSNs fail `SELF_SIGNED`. Workers have no HTTP endpoint, so they fail live-but-broken and `/health` probes cannot detect it. **R-1 adds a second option**: `DATABASE_SSL_SERVERNAME` set to the external hostname, keeping the internal DSN (§G.5). |
| **R-4 — B-5 ruling** | **OPEN, operator-owned (OP-3).** | R-1's evidence points one way: §D.6 (rollback has a shelf life), §G.1 (one new flag, declared false) and §I (no new pages) all argue for **dark**. The ruling remains the operator's. |
| **VA-3** | **OPEN, not started.** | Unblocked and unaffected by R-1. 54 documents ingested, zero findings through the document path. |
| **Production Stripe / operator actions** | **OPEN (OP-9).** | Price-ID transposition unverified in production. Activation-time, not promotion-time. |

---

## M. GO / CONDITIONAL GO / NO-GO

### **CONDITIONAL GO — promote dark, once K-1…K-5 and R-2 close.**

**Why not NO-GO.** Every technical property this batch can be judged on came
back clean and was *proven*, not argued:

- Forward application: **232 → 248, zero failures**, on a schema built from empty.
- Zero destructive DDL against any pre-existing table.
- Rollback: **bit-identical schema across 13,068 lines of DDL**, byte-identical
  pre-promotion data, **330/330 foreign keys valid**, restored triggers and
  constraints behaviourally verified, and clean from **four** distinct partial
  states.
- Exactly **one** new customer-affecting feature flag, declared `false` in production.
- **Zero** new app pages.
- The delta carries the **entire** support runbook set and the incident-response
  program, neither of which production has today.
- The `main`/`develop` divergence resolves to a merge whose tree is **provably
  identical to `develop`'s**.

**Why not unconditional GO.** Five R-1 blockers are open, every one of them
operator-owned (§K), and R-2 is a hard gate that cannot open before
**2026-08-25T07:00Z**.

**Why dark specifically — the three findings that decide it:**

1. **§D.6 — the rollback has a shelf life.** It is exact while the new
   capabilities are unused and becomes an irreversible product decision the
   first time one is used. A dark promotion preserves the escape route through
   the entire window in which something might go wrong. A target-state promotion
   spends it on day one.
2. **§G.1 — the promotion introduces one new flag and production declares it
   `false`.** There is nothing to argue about in the flag surface.
3. **§B.3 — the promotion is security remediation.** Production is running
   without TLS certificate verification, token digest at rest, deterministic
   session invalidation, rate-limiter client identity and 40 high-severity
   dependency advisories. Deferring the deploy to wait on feature readiness
   couples two risks that should be separated.

**One correction to carry forward:** "entirely dark" overstates it. Three
entitlement-gated API routes and four modified pages become reachable to paying
customers with no flag in front of them (§I). All are additive, none changes
existing behaviour, and all but pen-test intake carry runbooks. Call it a **dark
promotion with a small entitlement-gated surface**, and say so in the release
record rather than discovering it afterwards.

**NO-GO conditions — any one of these, and this verdict reverses:**

- #826 does not reach PASS at the 2026-08-25 window.
- OP-5 shows a validating scan that will not fit inside `statement_timeout=300s`.
- OP-1 finds production's synced flag state diverging from `render.yaml`.
- OP-2 is not applied before promotion — the engine's `npm run migrate` will
  fail on `SELF_SIGNED` and the workers will fail live-but-broken.

---

## N. Should the release boundary be frozen now?

### **Yes — freeze it at the merge of PR #853.**

Three reasons:

1. **The candidate is otherwise a moving target.** `4fe16808` has no CI run of
   its own precisely because three merges landed within twelve seconds. Every
   further merge into `develop` re-mints the candidate and re-opens K-1. The
   boundary is the only thing that makes "green CI on the exact candidate SHA"
   a statement rather than a race.
2. **Everything R-1 verified is SHA-specific.** The 16 migrations, the 376-file
   delta, the rehearsed rollback, the flag reconciliation and the tree-equality
   proof in §F.4 are all evidence about *this* tree. A merge into `develop`
   invalidates a measurable part of that and would require re-running §D.
3. **The reconciliation already recommends a feature cutoff of 2026-09-05**, and
   the promotion is targeted at **Aug 26–27**. Freezing now costs nine days of
   merges into `develop` and buys a defensible release. Work continues on
   branches; a second small promotion after the Sept 5 cutoff carries whatever
   lands in between, exactly as §14 of the reconciliation proposes.

**Recommended freeze protocol:**

- Merge PR #853. **That SHA is the candidate and the boundary.**
- Freeze `develop`: no merges until the promotion completes or is abandoned.
- VA-3 proceeds during the freeze — it is a **staging operational exercise**
  against `4fe16808`, and it writes no code. If it finds defects, they are
  branched and held, not merged. That is the correct use of the freeze window,
  and it means the freeze costs nothing on the critical path.
- If the freeze must be broken, K-1 re-opens and §D must be re-run against the
  new tree.

---

## Appendix — what this pack did not verify

Stated so nothing here reads as stronger than it is.

- **Production environment state.** All flag values in §G are from
  `render.yaml`'s **declared** state. No production dashboard, DSN or secret was
  read. `render.yaml`-declared has previously diverged from synced — **OP-1**.
- **Production row counts and therefore actual migration duration.** The
  arrival-risk assessment in §C.3 establishes the *mechanism* and the *bound*
  (`lock_timeout=5s`, `statement_timeout=300s`); it does not establish the
  elapsed time — **OP-5**.
- **Rehearsal scale.** The rollback was rehearsed against a schema built from
  empty with a hand-built representative dataset, not a production-sized clone.
  It proves *correctness and coherence*, not *duration*.
- **Live test-suite execution.** CI results are quoted from the GitHub
  check-runs API for the exact SHAs named. The suites were not re-run locally.
- **Issue #826.** Not read, not modified, not commented on. Its state in §L is
  quoted from the reconciliation.
- **`demo-engine`, `demo-app`, `intelligence-api`.** Outside Blueprint
  ownership (INF-1) and outside this assessment.
