# Evidence-lifecycle substrate — PRODUCTION promotion record

**Date:** 2026-09-02
**Package:** production promotion of migrations `20261080`–`20261085` plus the governed evidence writer
**Authority:** owner approval 2026-09-02 (Decision 1), with the baseline-before-migration precondition
**Result:** **promoted, migrated, live, and DARK**
**Activation:** none. `SECURELOGIC_EVIDENCE_LIFECYCLE_V2` remains unset in production.

---

## 1. Why this was not a `develop -> main` merge

`develop` was **227 commits / 359 files** ahead of `main`. A branch merge would
have carried the whole VA-Q, VA-S4 4C, asset-registry and pen-test estate into
production alongside the substrate. The release candidate was therefore **cut
from `main`** and took the substrate alone.

Separability was proven, not assumed:

- the transitive import closure of the substrate is **25 files**, none of which
  touch the 4C chain;
- the six migrations **apply from scratch on a `main`-derived schema**, needing
  none of the 26 develop-only migrations between `20261041` and `20261079`.

**Deliberately excluded:** `assuranceCoverage.ts` (the S4 counting predicate) and
its `vendorEngagements.ts` consumption — questionnaire reduction was NOT
promoted; the six other routers `develop` mounts in `routes/index.ts`; and
`test/isolation/evidenceAuthorityRepair.test.ts`, which depends on a 4C-0 symbol
absent from `main`.

## 2. Exact state proven

| Fact | Value |
|---|---|
| PR | **#979**, 24 files, +6322/−2 |
| Merged head on `main` | **`d42acbac`** (merge of `3a8a9be4`) |
| Production engine | `srv-d5vmr37fte5s73cspe1g`, branch `main`, autoDeploy on |
| Live deploy | `dep-dac48bfqj5pc73dr7ud0`, status **live**, finished 2026-09-02T15:45:33Z, commit `d42acbac` |
| CI at exact head `3a8a9be4` | **8/8 green** (typecheck, lint, test, build, cross-org-isolation, audit, url-drift, tenant-coverage) |
| `schema_migrations` | **249 → 255** (exactly +6) |
| Migrations recorded | all six `20261080`–`20261085` |
| Migration log | applied 15:45:13–15:45:14, **only those six** |
| `/health` | `{"status":"ok","db":"connected"}` |
| Flag | `SECURELOGIC_EVIDENCE_LIFECYCLE_V2` = **(unset)** |
| `APP_ENV` | `production` (confirms the probes hit prod, not demo) |

**The 249 is the DB row count, not a repo file count.** `main` carries 248
migration files; production has one orphan row (`20260522_alert_preferences.sql`,
applied but absent from the repo) present in every environment. 249 + 6 = 255.

## 3. Baseline measured BEFORE migration (owner precondition)

Read-only probe `job-dac47aajnfac73etog50`, run against production immediately
before the merge:

```
db=securelogic  migrations=249  has_2026108x=0  substrate_tables=[]
evidence_rows=0  evidence_orgs=0  new_columns_present=[]
vendor_assurance_documents=0  organizations=1
flag_env=(unset)  app_env=production
```

The evidence estate was **empty**, none of the four substrate tables existed, and
none of the five new `evidence` columns existed. **Nothing to backfill and
nothing to transform.**

This is confirmed independently at the code level: the six migrations perform
**zero DML against pre-existing rows**. The only `INSERT`/`UPDATE` statements
target `evidence_validity_policy`, a table the same migration set creates; the
`UPDATE`/`DELETE` statements in `20261084` sit inside the `withdraw_evidence`
SECURITY DEFINER function body (lines 253/294/300, between the function's 171 and
its closing 311), not at migration time.

## 4. Post-migration verification

Read-only probe `job-dac49amk1f9s73e4eutg`:

| Object | Result |
|---|---|
| `evidence_links` | RLS enabled, 1 tenant-isolation policy |
| `evidence_lifecycle_events` | RLS enabled, 1 policy |
| `organization_evidence_validity_settings` | RLS enabled **and FORCED**, 1 policy |
| `evidence_validity_policy` | RLS correctly **absent** — global governed reference content with no org dimension |
| New `evidence` columns | `assurance_class`, `supersedes_evidence_id`, `valid_from`, `valid_until`, `validity_basis` |
| Ratified policy rows | **13 live / 3 superseded** — identical to staging and to the from-scratch local build |
| D2 bridge | `soc1` and `soc2_type2` at version 2, 12-month default, **15-month ceiling intact**, `bridge_required_above_months = 12` |
| D11 DPA ruling | `privacy_agreement` 24 default / 36 max, no bridge — the perpetual path stays CLOSED |

**The estate is still empty and nothing was activated:** `evidence` 0,
`evidence_links` 0, `evidence_lifecycle_events` 0,
`organization_evidence_validity_settings` 0.

## 5. Customer-visible behaviour

**15 pre-existing routes were probed unauthenticated before and after the
deploy. All 15 returned identical status codes.** No unrelated production change.

**One measured delta, reported rather than glossed.** The eight substrate paths
moved from **404 (no such route)** to **401 `api_key_required`**. They are not
reachable — every one sits behind
`GATE = [requireApiKey, attachOrganizationContext, requirePremiumOrCorePlatform,
denyContributor(), requireLifecycleV2]` — but because the flag check is **last**
in that chain, an unauthenticated caller is answered by `requireApiKey` before
reaching the 404 the route intends.

This violates the house standard stated in `src/api/__tests__/c4FlagOff.test.ts`
("a bare 404 — not 401, not 403"). It is **P3**: it discloses that a path exists
and nothing more — no data, no state change, no bypass. It is **pre-existing
staging code**, not introduced by this promotion, and it was deliberately NOT
fixed inside the release branch so the promoted bytes stay identical to what
staging proved. Fix belongs on `develop` -> staging -> a later promotion.

## 6. Byte-identity with staging

All six migrations and all six substrate source files are **byte-identical**
between `origin/main` and `origin/develop` (blob-hash compared). Production runs
exactly the code staging proved at 31/0.

## 7. Known gap carried forward

`20261080`–`20261084` have **no rollback SQL**; only `20261085` does. This is
inherited from the staging package and is recorded rather than papered over.
Practical rollback is redeploying the prior SHA and leaving the additive schema
in place, which is inert while the flag is off.
