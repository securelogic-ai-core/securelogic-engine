# `npm run migrate` cannot rebuild the schema from scratch

**Produced**: 2026-08-15. Surfaced while validating the migration-timeout
hardening (`docs/validation/migration-timeout-hardening.md` §4). **This defect is
pre-existing and was not caused by that change** — proof in §2.

**Status: FIXED 2026-08-15.** Option B was taken, with the regression test the
recommendation called for. `20260522_alert_preferences.sql` is renamed to
`20260417_alert_preferences.sql` (its real commit date) and
`test/isolation/migrationFilenameOrder.test.ts` now proves the whole set applies
to a fresh database in strict filename order. **No retry was added to
`scripts/runMigrations.ts`** — see §9 for the measured result and §7 Option A
for why retry stays out.

**Severity: P2.** No customer impact today, no production impact today. It
breaks disaster recovery, new-environment provisioning, and the documented
developer setup path.

---

## 1. The failure

On an empty database, the supported command applies 52 migrations and stops:

```
Applied migration: 001_securelogic_platform.sql
... 51 more ...
Migration failed: 20260504_user_alert_preferences_org_scope.sql
error: relation "user_alert_preferences" does not exist
```

Exit 1. `scripts/runMigrations.ts` applies files in **filename-sorted order**,
each in its own transaction, with no retry. The 53rd file `ALTER`s a table that
a **later-sorting** file creates.

---

## 2. Verified pre-existing

The original runner was restored from `git show HEAD:scripts/runMigrations.ts`
to a temporary file and run against a freshly dropped schema on the same
database:

| Runner | Applied before failing | Failure | Exit |
|---|---|---|---|
| Current (post-hardening) | **52** | `20260504_user_alert_preferences_org_scope.sql` — relation does not exist | 1 |
| Original (`HEAD:` copy) | **52** | identical file, identical error | 1 |

Byte-identical behaviour. The timeout hardening is not implicated.

---

## 3. Full scope — measured, not estimated

The first failure is not the whole story, so the entire set was replayed with
retry passes (the same strategy `test/isolation/testDb.ts` uses) against a
throwaway database:

```json
{ "totalFiles": 222, "applied": 222, "passes": 3, "stuck": [],
  "deferred": [ { "file": "20260504_user_alert_preferences_org_scope.sql",
                  "succeededOnPass": 2,
                  "firstError": "relation \"user_alert_preferences\" does not exist" } ] }
```

**Exactly one migration out of 222 is misordered.** With retry, all 222 apply,
and the third pass exists only to prove no further progress is possible. Nothing
is permanently stuck.

That is the good news and it shapes the fix: this is a one-file defect sitting on
top of a runner with no tolerance for it, **not** a pervasively broken migration
set.

---

## 4. Root cause — the dependency is misnamed, not the dependent

| File | Filename date | **Actually committed** | Role |
|---|---|---|---|
| `20260522_alert_preferences.sql` | 2026-05-22 | **2026-04-17** (`74d8ee64`) | `CREATE TABLE user_alert_preferences` |
| `20260504_user_alert_preferences_org_scope.sql` | 2026-05-04 | 2026-05-04 (`3ac9a71c`) | `ALTER TABLE user_alert_preferences ADD organization_id` |

The dependent file is dated correctly. **The dependency carries a filename date
~5 weeks in the future of its own commit**, so it sorts *after* the migration
that depends on it.

Production and staging are unaffected because they applied these in **commit**
order — April 17 then May 4 — and `schema_migrations` recorded that. Filename
order and apply order have simply never had to agree until someone rebuilds.

*(Production state is reasoned from the accretion model and the recorded
migration history, not queried — no production database credential exists in
this session.)*

---

## 5. Who this actually breaks

| Path | Affected? | Consequence |
|---|---|---|
| Normal deploy (staging/prod) | **No** | Only un-applied files run; the pair is long since applied |
| **Disaster recovery by replay** | **Yes** | The schema cannot be reconstructed with the supported command |
| **New environment provisioning** | **Yes** | Any new env — ephemeral, a second staging, a fresh demo — fails at file 53 |
| **Documented developer setup** | **Yes** | `README.md` §Development Setup tells a new developer to run `npm run migrate`. On their empty database it fails |
| Isolation test harness | No | `testDb.ts` has its own applier with retry passes |
| Demo database | Unknown | Already carries a recorded 140-migration drift; not investigated here |

DR by **snapshot restore** is unaffected — this only bites replay-based recovery.
Whether snapshot restore is the sanctioned DR path is itself undocumented, and
worth settling as part of the decision below.

---

## 6. Why it has stayed invisible

1. **The test harness routes around it.** `test/isolation/testDb.ts` documents
   this exact file pair by name and survives via retry passes. So the one place
   that rebuilds from scratch on every CI run never fails.
2. **Its warning goes to nobody.** `testDb.ts` logs
   `N migration(s) applied out of filename order (retry pass)` — real, accurate,
   and buried in setup output that nothing asserts on and no one reads.
3. **The convention is enforced by human vigilance, and it has already been
   caught once by hand.** `docs/vendor-assurance-presentation-design.md` §"Why
   the migration is dated `20260612`, not today" records an author noticing this
   exact hazard and hand-picking a filename to avoid it. A rule that depends on
   every author remembering it will fail again.
4. **Nothing in CI tests the real runner.** `scripts/**` is in neither
   `tsconfig.prod.json`'s `include` nor `vitest.config.ts`'s `include` — CI
   typechecks and tests none of it.

---

## 7. Options — a decision is owed

### Option A — retry passes in `scripts/runMigrations.ts`
Mirror `testDb.ts`: retry failures after the rest, stop when a pass applies
nothing, surface whatever remains as a genuine error.

- **For**: fixes the whole class, including the next inversion nobody catches.
  Proven — it is what the harness already does, and §3 shows it resolves this set.
- **Against**: it makes an ordering defect **self-healing and therefore
  invisible** unless the deferred list is logged loudly. It also interacts with
  the timeout hardening just landed (`b363e144`): a migration aborted on
  `lock_timeout` would now be retried inside the same deploy, which softens the
  deliberate fail-fast. Retry must be restricted to dependency-shaped failures,
  or must explicitly not retry SQLSTATE `55P03`/`57014`.

### Option B — rename the misnamed file
Rename `20260522_alert_preferences.sql` to sort before `20260504_…`.

- **For**: surgical, one file, makes filename order genuinely correct rather than
  tolerated. **Verified safe to re-run**: every statement in it is
  `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`, so the re-apply it
  triggers in existing environments is a no-op.
- **Against**: the runner is filename-keyed, so existing environments will apply
  the new name once and carry both rows in `schema_migrations` forever — exactly
  the hazard `BUILD_SEQUENCE.md` F-1 warns about, here benign but needing the same
  care. Fixes this instance only; the next inversion still breaks the rebuild.

### Option C — make the dependent migration self-sufficient
Add a guarded `CREATE TABLE IF NOT EXISTS user_alert_preferences (…)` to the
org-scope migration.

- **For**: no rename, no runner change, no `schema_migrations` churn.
- **Against**: duplicates a table definition in two files, which is how
  definitions drift. Worst of the three.

### Recommendation
**B + a regression test, with A as the follow-on.** Rename to make the ordering
actually correct, then add a CI check that a from-scratch apply in **strict
filename order** succeeds — which converts this from a convention nobody can
enforce into something that fails a PR. Option A remains worth doing afterwards
for resilience, but adding retry *first* would paper over the defect and remove
the pressure to keep filename order honest.

The regression test is the durable half of the recommendation. Without it, the
next future-dated filename reintroduces this silently.

---

## 8. What was done

Option **B + a regression test**, exactly as recommended. Option A (retry in the
runner) was explicitly **not** taken and remains available as a follow-on.

1. `db/migrations/20260522_alert_preferences.sql` →
   `db/migrations/20260417_alert_preferences.sql`. Content unchanged apart from
   a header recording the rename and why the file must stay re-appliable.
2. `test/isolation/migrationFilenameOrder.test.ts` — creates its own scratch
   database on the harness server and applies all 222 migrations with the
   deploy's own `listMigrationFilenames` order and `applyMigration` transaction
   body, **no retry**. Runs in the existing `cross-org-isolation` CI job; no
   workflow change was needed.
3. `src/api/lib/migrationRunner.ts` gained `listMigrationFilenames`,
   `ensureMigrationTable`, `SCHEMA_MIGRATIONS_DDL` and `migrationsDirFrom`,
   lifted out of `scripts/runMigrations.ts` so the test cannot sort or bootstrap
   differently from the deploy. This also moves that logic into the typechecked
   tree — `scripts/**` is typechecked by nothing (§6.4), and the omission bit
   during this very change: an unused-import cleanup dropped `import path` while
   `path.join` was still live, and only running the script surfaced it.
4. `test/isolation/testDb.ts` — the retry passes are kept as harness tolerance
   but the comment no longer presents them as the ordering guarantee. `deferred`
   should now always be empty.

---

## 9. Measured result

Postgres 16, throwaway Docker harness, 2026-08-15.

### From scratch, strict filename order

| | Before rename | After rename |
|---|---|---|
| `npm run migrate` on an empty DB | **failed at file 53 of 222** — `relation "user_alert_preferences" does not exist` | **exit 0, 222/222 applied**, "Migrations complete", 5.2s |
| Regression test | fails, naming file 53 | passes — `[migration-order] 222/222 migrations applied to a fresh database in strict filename order in 4711ms (no retry, no deferrals)` |

The regression test was written and run **before** the rename to confirm it
reproduces the documented failure, then re-run after.

### Re-application against an existing environment

The scratch database was fully migrated, then its bookkeeping rewound to look
like staging/prod — the `20260417` row deleted, a `20260522_alert_preferences.sql`
row inserted — and rows seeded into both affected tables with a
**non-default** value (`daily_digest = FALSE`) so a silent recreate would show.
Running the real runner then performed exactly the upgrade a deploy will perform:

- applied **one** migration, `20260417_alert_preferences.sql`; exit 0
- `pg_dump --schema-only` before vs after: **no difference** (the only delta is
  pg_dump's own random `\restrict` nonce)
- `user_alert_preferences` still 1 row with `daily_digest = false`;
  `alert_sends` still 1 row — no data loss
- `schema_migrations` ends at 223 rows carrying **both** filenames, as F-1
  predicts. Benign, and now deliberate rather than accidental.

A further run with nothing pending applied 0 migrations and exited 0.

### Operator note

On the next deploy, staging and prod will each apply
`20260417_alert_preferences.sql` once and permanently carry both rows in
`schema_migrations`. That is expected and proven harmless above. No operator
action is required, and no backfill or re-stamp is needed.

---

## 10. Still open

Nothing from this defect. It was **not** a promotion blocker before the fix and
is not one now: it does not affect the `develop → main` gate, whose two open
blockers remain BL-2 and BL-4.
