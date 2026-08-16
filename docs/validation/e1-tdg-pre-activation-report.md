# E-1 TDG — pre-activation report

**Nothing is activated.** Both gates are declared off in `render.yaml` for all
four services that read them, and no Render service, Blueprint, flag or
production row was touched to produce this. This is the report the operator
asked for BEFORE any sweeper runs against production data.

---

## 1. How existing conversations are grandfathered

**Three independent reasons no existing conversation can expire on arrival.**

**(a) The migrations stamp nothing.** All four are additive: two new empty
tables, two widened columns on `ask_tool_invocations`, one extra permitted
`jobs.job_type`. No existing row changes state, and no row acquires a retention
attribute — retention is *computed* from the age anchor at sweep time, never
stored on the object. A conversation is in exactly the state after the migration
that it was in before it.

**(b) The activation gate, which is time-based rather than data-based.**
`SECURELOGIC_TDG_EFFECTIVE_FROM` is empty. Empty means **zero deletions, ever**,
even with the feature flag on. Once set, `TDG_GRACE_DAYS = 30` means nothing can
expire until 30 days after that date. So every organization gets at least a
month under a declared policy before anything of theirs is eligible — the
grandfather is a platform property, not a per-tenant migration someone has to
remember to run.

**(c) Arithmetic.** `ask_conversations` did not exist in production until
migration `20260922` arrived with the Stage 1 promotion at **2026-08-16 06:56Z**.
At the 365-day default, the earliest possible eligible row in production is
**2027-08-16**. On staging the table has existed since roughly 2026-08-13, so the
earliest there is ~2027-08-13.

**There is therefore no near-term destructive effect available to activate.**
Enabling the flag today exposes the surface and the dry-run; it cannot delete an
Ask conversation anywhere for approximately a year.

**No backfill is required or performed.** An organization with no
`retention_policies` row is fully governed at the platform default — absence is
a defined state, not a gap (TDG-2).

## 2. What timestamp establishes retention age

Declared in the class registry, never in SQL a route could diverge from:

| Class | Age anchor | Why |
|---|---|---|
| `ask_conversation` | `COALESCE(last_message_at, created_at)` | A thread's age is the age of its **last turn**. A thread started a year ago and used yesterday is not old. `last_message_at` is nullable (created, never used), so the fallback keeps a null from making an object either immortal or instantly expired. |
| `ask_tool_invocation` | `created_at`, **and** `message_id IS NULL` | A ledger row's clock starts when the read happened, but it is not eligible at all until the turn it describes has already been deleted. |

Both are `GovernedDataClass.ageColumn` / `.ageFallbackColumn`. A new class
declares its own; nothing else changes.

## 3. Dry-run counts by organization and data class

**Not produced in this session, and I will not claim otherwise.** No production
database credential exists in this environment (a standing constraint), and the
governance surface is dark, so both routes to the number are operator-owned.
Either is non-destructive:

**Option A — enable the flag only.** With `SECURELOGIC_TDG_EFFECTIVE_FROM` still
empty, enabling `SECURELOGIC_TENANT_DATA_GOVERNANCE_ENABLED` exposes
`GET /api/governance/sweep/:dataClass/preview`, which plans and reports and
**cannot delete**: execution short-circuits on `blockers` and returns `blocked`.
This is the intended way to produce this section.

**Option B — read-only SQL, no flag change.** Exactly the predicates the planner
uses:

```sql
-- ask_conversation, at the 365-day platform default
SELECT o.id AS organization_id, o.name,
       COUNT(c.id) AS total,
       COUNT(c.id) FILTER (
         WHERE COALESCE(c.last_message_at, c.created_at) <= now() - interval '365 days'
       ) AS eligible
  FROM organizations o
  LEFT JOIN ask_conversations c ON c.organization_id = o.id
 GROUP BY o.id, o.name
 ORDER BY eligible DESC, total DESC;

-- ask_tool_invocation: only rows whose message is already gone
SELECT organization_id,
       COUNT(*) AS total,
       COUNT(*) FILTER (
         WHERE message_id IS NULL AND created_at <= now() - interval '365 days'
       ) AS eligible
  FROM ask_tool_invocations
 GROUP BY organization_id
 ORDER BY eligible DESC;

-- Any tenant override that would change the 365 above (expected: none)
SELECT organization_id, data_class, version, retention_days, cleared, source
  FROM retention_policies
 ORDER BY organization_id, data_class, version DESC;
```

**Expected result, from §1(c): `eligible = 0` for every organization and both
classes.** If any row returns non-zero, stop — it means an assumption in this
report is wrong, and the discrepancy must be explained before activation.

## 4. Legal-hold behaviour

- **Four scopes:** `organization` (everything), `data_class`, `subject_user`,
  `object`. A subject hold whose target has no owner covers nothing rather than
  widening to the class.
- **A hold outranks every deletion path** — sweeper, administrator and **owner**
  alike. The check lives inside the single delete path, so a future caller
  cannot forget it.
- **The owner is refused, not silently skipped:** `409 legal_hold_active`.
  Telling someone their data is gone when it is not is worse than refusing them.
- **The sweeper skips and counts**, and writes a
  `governance.retention_sweep_suppressed` event — "the sweep ran and deleted
  nothing because everything was held" is itself a governance fact.
- **Authorization:** `admin` role, a resolvable human (API keys refused), and a
  mandatory reason.
- **Separation of duties:** release requires a **different** admin, enforced at
  the route (`409 sod_violation`) *and* by a database `CHECK`. A single-admin
  org cannot self-release; the break-glass is an operator release under the same
  audit trail.
- **The hold register is append-plus-release at the database level:** DELETE and
  TRUNCATE always raise, the only permitted UPDATE is `active → released`, and a
  release may not alter the hold it releases.

Proven by 8 isolation tests against real Postgres, including the two that bypass
the routes entirely and hit the constraints directly.

## 5. Deletion ordering across conversation, content and provenance

One transaction, three statements, in this order and for these reasons:

1. **`ask_provenance_contexts`** — they would cascade anyway, but they are the
   one place FULL authorized tool payloads are ever written, so they are
   destroyed first and **counted explicitly** rather than vanishing as a side
   effect nobody measured.
2. **`ask_messages`** — deleting these SET NULLs `ask_tool_invocations.message_id`
   (migration `20261014`) instead of cascading it away, so the audit ledger,
   **denials included**, outlives the content it describes.
3. **`ask_conversations`** — last, so no statement runs against a thread whose
   parent is already gone.

Orphaned ledger rows then age out under their own class policy, and become
eligible **in the same sweep run**: the enqueuer emits classes in dependency
order (content before the ledger its deletion orphans).

There is no partial outcome. The batch commits whole or not at all, and the
audit event is written **in the same transaction** — proven by the isolation
test that throws after the delete and finds neither the deletion nor the event.

## 6. Retry and dead-letter behaviour

Sweeps run as `retention_sweep` jobs on the existing data-rights worker,
deliberately reusing its machinery rather than copying it:

| Outcome | Result |
|---|---|
| Exception | `decideFailureState` (shared): requeued with exponential backoff — 1m, 2m, 4m … capped |
| Attempts exhausted | `dead_lettered` **plus** an immutable `governance.retention_sweep_failed` audit event, so an exhausted sweep leaves a governance record and not only a job row |
| `NonRetryableJobError` | `failed`, terminal, no backoff |
| Activation gates closed | `succeeded` with `reason: "blocked"` in the result and a **warn** log |
| Unregistered class in payload | `succeeded` with `reason: "unknown_data_class"` and a warn log — retrying cannot make a class reappear |

Blocked is deliberately not a failure: it is the expected state while the
capability is dark, and dead-lettering every tick of an intentionally-inert
feature would bury the real failures. **No path leaves the job row untouched**,
which is what makes "silently claiming erasure" unreachable.

## 7. Rollback behaviour

**Code rollback is trivial and is the expected one.** All four migrations are
additive and the capability is dark, so reverting the deploy leaves two empty
tables, two nullable columns and one unused job type — every one inert.

**Schema rollback** is written and reviewable at
`db/rollback/20261013_20261016_tdg_rollback.sql`, to the C-8 standard
(constraints and triggers dropped before the objects they guard). It has one
genuinely one-way step, named rather than discovered later: restoring
`ask_tool_invocations.message_id` to `NOT NULL` is only possible while **no
orphaned ledger rows exist**. Once any content has been deleted, orphans exist
by design, and the script **raises rather than deletes** them — destroying audit
records of reads performed on customers' behalf must be an explicit act, not a
side effect. It refuses on `retention_sweep` job rows for the same reason. It also
**deliberately does not revert `20261016`**: restoring the conversation owner
FK to CASCADE would silently re-arm the data-loss path the operator ruling
forbids, and a rollback script is not a licence to reintroduce one.

**Not rehearsed against a populated database.** The forward path is proven (227
migrations applied from scratch in the isolation lane); the rollback script has
not been executed. If a schema rollback is credible for this package, it should
be rehearsed the way C-8 was before activation, not during an incident.

**Data rollback does not exist.** A deleted conversation is gone. That
asymmetry is the entire reason for the two gates, the 30-day grace and the
hold — not a gap in the rollback plan.

## 8. Evidence that one tenant can never delete another tenant's data

**Four layers, deliberately redundant:**

1. Every route and worker path runs inside `withTenant(organizationId, …)`.
2. **Every statement additionally names `organization_id` explicitly** — in the
   store, in both class handlers, and in the DELETEs. Redundant with the tenant
   scope, and stated in the code comments as such: RLS is inert until the
   `app_request` flip (KNOWN_ISSUES M-1), so **these predicates are today's
   actual guarantee**, not a belt over a working brace.
3. RLS policies land on `retention_policies` and `legal_holds` with the tables,
   so they enforce the moment the flip happens.
4. The delete statements re-assert their own selection predicate (the ledger's
   `message_id IS NULL`), so an object that changed state between plan and
   execute is not destroyed.

**Proven** in `test/isolation/tenantDataGovernance.test.ts` against real
Postgres — 26 tests, all passing, including:

- org A's sweep plan never contains org B's conversation;
- org A cannot delete org B's conversation **even naming its id exactly** — the
  row is still there afterwards;
- org B's organization-wide hold is invisible to org A;
- a policy set by org A does not change org B's effective policy.

**Full evidence at this commit:** unit lane 49 tests + 10 route-gate tests, all
passing; isolation lane 26 tests passing on a fresh database that applied all
227 migrations in strict filename order; lint 0 errors; typecheck clean.

---

## What is still owed before activation

1. §3 executed by an operator — expected all zeros.
2. A ruling on C-9 item 4 (do Ask threads die with their user on Art. 17). E-1
   pins the current behaviour and corrects the classification prose; it does not
   change the reaper.
3. A schema-rollback rehearsal, if a schema rollback is considered credible.
4. Explicit authorization to set `SECURELOGIC_TDG_EFFECTIVE_FROM` — the
   destructive gate. Enabling the feature flag alone is safe and reversible.
