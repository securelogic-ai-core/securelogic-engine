# Migration lock/statement timeout hardening — validation

**Change SHA**: **`b363e144279b4556dd49836610e91769306ea0f9`** (`b363e144`)
**Produced**: 2026-08-15. Follows BL-1
(`docs/validation/bl1-migration-lock-exposure.md` §"Recommended hardening"),
which called for this as **its own change, not smuggled into the promotion**.

**These results belong to `b363e144` alone.** The BL-3 evidence recorded in
`docs/validation/bl3-suite-verification.md` belongs to `59d85b18` and is not
extended to this SHA by this document. Each was run separately.

---

## 1. What changed

| | |
|---|---|
| `scripts/runMigrations.ts` | Now a thin wrapper: connection + file iteration. The transaction body moved out |
| `src/api/lib/migrationRunner.ts` | **New.** Transaction body, timeout resolution + validation, failure classification |
| `src/api/lib/__tests__/migrationRunner.test.ts` | **New.** 22 DB-free tests |
| `test/isolation/migrationRunnerTimeouts.test.ts` | **New.** 6 real-Postgres tests |

**Defaults**: `lock_timeout = 5s`, `statement_timeout = 300s`. Overridable via
`MIGRATION_LOCK_TIMEOUT` / `MIGRATION_STATEMENT_TIMEOUT`. Neither is set in
`render.yaml` — the defaults apply everywhere on arrival, which is the point.

**Why the code moved.** `scripts/**` appears in neither `tsconfig.prod.json`'s
`include` nor `vitest.config.ts`'s `include`. CI typechecks none of it and tests
none of it. The prod engine boots as `npm run migrate && npm start`, so this is
the most consequential code in a deploy and it had zero coverage. `src/api/lib`
is covered by both.

**Why validation is a security control, not a nicety.** Postgres accepts no bind
parameter in `SET`, so these values are interpolated into SQL. They come from the
environment. `MIGRATION_LOCK_TIMEOUT="5s'; DROP TABLE schema_migrations; --"` is
rejected before the first connection — verified by running the real script, not
only the unit test.

---

## 2. Test results at `b363e144` — all eight CI jobs

Working tree clean at the SHA for every run.

| CI job | Result | Exit |
|---|---|---|
| `typecheck` (engine) | no diagnostics | **0** |
| `typecheck` (app) | no diagnostics | **0** |
| `lint` | 0 errors, 1 pre-existing warning | **0** |
| `url-drift` | clean | **0** |
| `test` (engine) | **496 files / 8,074 passed**, 3 skipped | **0** |
| `test` (app) | **133 files / 1,738 passed** | **0** |
| `build` (engine) | dist emitted | **0** |
| `build` (intelligence-worker) | clean | **0** |
| `cross-org-isolation` | **150 files / 1,164 passed** | **0** |
| `tenant-coverage` | 260 warnings, warn-only by design | **0** |
| `audit` | 7 high — inherited red, unchanged (§3 of the BL-3 record) | **1** |

**The deltas are exactly the new tests, and nothing else:**

| Suite | `59d85b18` | `b363e144` | Delta |
|---|---|---|---|
| Engine unit | 495 files / 8,052 | 496 / 8,074 | **+1 file, +22** |
| Isolation | 149 files / 1,158 | 150 / 1,164 | **+1 file, +6** |
| App | 133 / 1,738 | 133 / 1,738 | unchanged |

No pre-existing test changed behaviour. Migrations are applied by
`test/isolation/testDb.ts`, which has its own applier and does not call the
script, so the harness is unaffected by the refactor.

---

## 3. What the real-Postgres tests actually prove

Mocks cannot exhibit lock contention, so these run against real Postgres 16.

| Proof | Measured |
|---|---|
| Under a conflicting `ACCESS SHARE` hold, the migration aborts with SQLSTATE **55P03** instead of waiting unbounded | **1,017 ms** against a 1 s `lock_timeout` |
| The aborted migration is **not** recorded in `schema_migrations`, so a retry re-runs it | column absent, row absent |
| A reader arriving after the aborted DDL is **not** stalled — the outage this prevents | **< 1 s** |
| An uncontended migration applies and records normally | applied |
| `SET LOCAL` does not leak onto the pooled connection | `statement_timeout` not retained |
| `statement_timeout` cancels a runaway migration with **57014** and rolls back | 500 ms budget honoured |

This reproduces BL-1's harness measurement (7,989 ms blocked read → 123 ms with a
lock timeout) as a permanent regression test rather than a one-off finding.

---

## 4. End-to-end verification of the real script

The unit and isolation tests exercise the extracted function. The deploy path is
`npm run migrate`, so that was run too, against a throwaway **TLS-enabled**
Postgres (the script hardcodes `ssl: { rejectUnauthorized: false }`, so the
non-TLS harness cannot serve it — that constraint is pre-existing and unchanged).

- Malformed duration → rejected before any connection, exit 1.
- Valid config → module graph loads under `tsx`, migrations apply, and the run
  logs `Migration timeouts: lock_timeout=5s, statement_timeout=300s`.

### A pre-existing defect this surfaced — NOT caused by this change

**`npm run migrate` cannot rebuild the schema from scratch.** On an empty
database it applies 52 migrations and then dies:

```
Migration failed: 20260504_user_alert_preferences_org_scope.sql
error: relation "user_alert_preferences" does not exist
```

Some migrations carry a filename date predating the migration they depend on, so
strict filename order is not a valid apply order. `test/isolation/testDb.ts`
documents this and survives it with **retry passes**; the real runner has no such
retry.

**Verified pre-existing, not introduced:** the original script was restored to a
temporary file and run against a freshly dropped schema — **52 applied, identical
failure, identical migration, exit 1.** Byte-identical behaviour.

Production is unaffected today because its migrations accreted incrementally.
The exposure is **disaster recovery and new-environment provisioning**: neither
can currently be done with the supported command. Not fixed here — this commit is
scoped to the timeout hardening.

**Written up separately, with full scope and options:
`docs/validation/migrate-from-scratch-defect.md`.** Measured there: exactly ONE
migration of 222 is misordered, and the misnamed file is the dependency
(`20260522_alert_preferences.sql`, committed 2026-04-17 with a filename dated
five weeks later), not the dependent.

---

## 5. Effect on the promotion

**The promotion candidate has moved.** `develop` HEAD is now `b363e144`, not
`59d85b18`. Both SHAs carry their own full eight-job evidence, recorded
separately; neither set of numbers is transferred to the other.

This change does not alter the promotion's blocker set. **BL-2** (staging
walkthrough legs) and **BL-4** (Vendor Assurance nav decision) remain OPEN, and
both need a human rather than a test run.

One promotion-time note: at production's current scale this hardening is
theoretical — BL-1 measured ~220 ms of total `ACCESS EXCLUSIVE` against empty
tables. It is landed now precisely because it is cheap while the consequence is
theoretical and expensive to retrofit once production carries load.
