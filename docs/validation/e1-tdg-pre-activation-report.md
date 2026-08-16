# E-1 TDG — pre-activation package

**Nothing is activated.** Both gates are off for all four services that read
them. `SECURELOGIC_TDG_EFFECTIVE_FROM` has not been set anywhere. No Render
service, Blueprint, production row or Stage-2 flag was touched to produce this.

**Verdicts up front:**

- **Dark production deployment: E-1 READY.**
- **Destructive activation: E-1 NOT READY** — two operator-owed items remain
  (§3 executed against production, and the activation ruling in §11). Neither is
  a code defect.

---

## 1. Deletion-path inventory — does a legal hold stand in front of every path?

The requirement is that a hold prevents **every applicable deletion path**, not
just the new sweeper. That is a claim about the whole codebase, so it was
established by inventory rather than by assertion.

**Every `DELETE FROM` against a TDG-governed table in shipped code:**

| Path | Reaches governed data? | Honours a hold? | Evidence |
|---|---|---|---|
| `classHandlers.ts` (the governed path) | **Yes — and it is the only one** | **Yes** — the check is inside `deleteGovernedObject`, upstream of every caller | isolation: hold suppresses sweeper, administrator and owner alike |
| Owner delete route | via the governed path | Yes → `409 legal_hold_active` | isolation |
| Administrator delete route | via the governed path | Yes → `409` | isolation |
| Retention sweeper | via the governed path | Yes — skipped, counted, `sweep_suppressed` event | isolation |
| **Art.17 account-deletion reaper** | **No** — deletes only Category-B tables (none governed) and tombstones the `users` row | **Yes, now** — see below | isolation, against the real reaper |
| FK cascade from `users` | **No longer** — `SET NULL` since `20261016` | n/a | isolation: hard-deleted user leaves the thread standing |
| FK cascade from `organizations` | Yes, in principle | n/a — **no shipped code deletes an organization**, and D-12 makes it raise | grep across `src/` + `services/`: zero occurrences |
| `exportFilePurgeWorker` | No — `data_export_files` / R2 only | n/a | not a governed class |
| Validation / teardown scripts | Yes, with triggers disabled | **No** — and they must not run outside a throwaway database | `scripts/validation/*`, non-production by construction |

**The structural finding: governed data has exactly ONE deletion path.** A scan
of all 1,266 shipped `.ts` files under `src/` and `services/` finds `DELETE FROM
ask_conversations | ask_messages | ask_tool_invocations |
ask_provenance_contexts | ask_proposed_actions` in **one file** — `classHandlers.ts`.
A hold can only stand in front of a deletion it is upstream of, so this property
is now enforced by a test that fails the build if a second deleter ever appears.

### Two gaps found, both closed

**(a) The reaper did not consult holds.** It cannot delete governed data, but it
*is* a deletion path: it deletes Category-B rows and destroys identity by
tombstone. Under a litigation hold naming a custodian, scrubbing their email and
name destroys exactly the linkage the hold exists to preserve. The reaper now
checks for a hold covering the **subject** before erasing:

- Only `organization` and `subject_user` scopes bite. A `data_class` or `object`
  hold protects a *thing*, and must not quietly become a hold on a person's
  right to be forgotten — asserted in both lanes.
- A held erasure is **neither failed nor completed**: the user stays
  `pending_deletion`, so the enqueuer produces a fresh job next tick and the
  erasure happens by itself once the hold is released. Self-healing, no operator
  action.
- Phase 2 (R2 export-bundle purge) is skipped under hold too — purging the
  subject's own bundles would destroy data under the hold preserving it.
- A `governance.erasure_suppressed` event is written immutably. "We received an
  erasure request and did not action it" is precisely what a regulator or an
  opposing party will ask us to evidence.
- It is logged as `account_deletion_reap_suppressed_by_legal_hold` at **warn**,
  not as a success — a suppressed right-to-erasure must not be
  indistinguishable from a performed one in the operational record.

**(b) `ask_proposed_actions` was cascading uncounted.** Deleting a conversation
destroyed its agentic proposals via FK cascade without appearing in the audit
event's `childRowCounts`. A governance record that under-reports what it
destroyed is the exact failure TDG-14 exists to prevent. Now deleted explicitly
and counted, before the messages.

**Residual, stated rather than hidden:** legal holds live inside one tenant.
Cross-tenant or platform-level preservation orders have no representation, and
the validation/teardown scripts bypass everything by design. Both are correct
for today's scope; neither should be forgotten if either assumption changes.

---

## 2. Grandfathering, and what timestamp establishes retention age

**Three independent reasons nothing expires on arrival.**

**(a) The migrations stamp nothing.** All four are additive: two new empty
tables, two widened columns, one extra permitted `jobs.job_type`, one FK
loosened. Retention is *computed* from an age anchor at sweep time, never stored
on the object, so no row acquires a retention attribute.

**(b) The activation gate is time-based, not data-based.**
`SECURELOGIC_TDG_EFFECTIVE_FROM` empty ⇒ **zero deletions, ever**, even with the
feature flag on. Once set, `TDG_GRACE_DAYS = 30` means nothing expires for a
further 30 days. Every organization gets at least a month under a declared
policy before anything of theirs is eligible — a platform property, not a
per-tenant migration someone must remember to run.

**(c) Arithmetic.** `ask_conversations` did not exist in production until
migration `20260922` arrived with the Stage-1 engine deploy, which went live at
**2026-08-16 05:43:43Z**. At the 365-day default, the earliest conceivable
eligible row in production is **2027-08-16**.

**Age anchors** (declared in the class registry, never in SQL a route could
diverge from):

| Class | Anchor | Why |
|---|---|---|
| `ask_conversation` | `COALESCE(last_message_at, created_at)` | A thread's age is the age of its **last turn**. A thread started a year ago and used yesterday is not old. The fallback stops a null anchor making a row either immortal or instantly expired. |
| `ask_tool_invocation` | `created_at` **and** `message_id IS NULL` | The clock starts when the read happened, but the row is not eligible until the turn it describes is already gone. |

**No backfill is required or performed.** An org with no `retention_policies`
row is fully governed at the platform default — absence is a defined state.

---

## 3. The exact operator queries, and their expected results

**Read-only. Run against the production database. Nothing here writes.**

```sql
-- Q1. Confirm the four E-1 migrations are applied and nothing else moved.
SELECT filename, applied_at
  FROM schema_migrations
 WHERE filename LIKE '202610%'
 ORDER BY filename;

-- Q2. Confirm no tenant has an override — the platform default must be what
--     the counts below are measured against.
SELECT organization_id, data_class, version, retention_days, cleared, source, effective_from
  FROM retention_policies
 ORDER BY organization_id, data_class, version DESC;

-- Q3. Confirm no legal holds exist yet (they would change the deletable set).
SELECT id, organization_id, scope_type, data_class, status, placed_at
  FROM legal_holds
 ORDER BY placed_at DESC;

-- Q4. THE COUNT — ask_conversation, at the 365-day platform default.
--     Exactly the planner's predicate.
SELECT o.id AS organization_id, o.name,
       COUNT(c.id) AS total,
       COUNT(c.id) FILTER (
         WHERE COALESCE(c.last_message_at, c.created_at) <= now() - interval '365 days'
       ) AS eligible,
       MIN(COALESCE(c.last_message_at, c.created_at)) AS oldest
  FROM organizations o
  LEFT JOIN ask_conversations c ON c.organization_id = o.id
 GROUP BY o.id, o.name
 ORDER BY eligible DESC, total DESC;

-- Q5. THE COUNT — ask_tool_invocation. Only rows whose message is already gone
--     are ever eligible.
SELECT organization_id,
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE message_id IS NULL) AS orphaned,
       COUNT(*) FILTER (
         WHERE message_id IS NULL AND created_at <= now() - interval '365 days'
       ) AS eligible
  FROM ask_tool_invocations
 GROUP BY organization_id
 ORDER BY eligible DESC;

-- Q6. Sanity on the ruling's schema requirement: the conversation owner FK must
--     be SET NULL, never CASCADE.
SELECT rc.delete_rule
  FROM information_schema.referential_constraints rc
  JOIN information_schema.table_constraints tc ON tc.constraint_name = rc.constraint_name
 WHERE tc.table_name = 'ask_conversations'
   AND tc.constraint_name = 'ask_conversations_user_id_fkey';
```

**Expected results**

| Query | Expected | If it differs |
|---|---|---|
| Q1 | Four rows: `20261013`, `20261014`, `20261015`, `20261016` (plus `20261010`–`20261012` from Stage 1) | The deploy did not carry E-1. Stop. |
| Q2 | **0 rows** | A tenant override exists that no one recorded. Recompute Q4 against it before proceeding. |
| Q3 | **0 rows** | Recompute the deletable set with the hold applied. |
| Q4 | `eligible = 0` for **every** organization; `oldest` no earlier than 2026-08-16 | An assumption in §2 is wrong. **Stop and explain the discrepancy before any activation.** |
| Q5 | `eligible = 0` everywhere; `orphaned` expected 0 (nothing has been deleted yet) | As above. |
| Q6 | `SET NULL` | The ruling is not reflected in the deployed schema. Stop. |

**Decision rule: activation may proceed only if Q4 and Q5 both return zero
eligible rows for every organization.** A non-zero anywhere means this report is
wrong about something, and being wrong about which rows are eligible is the one
error class that cannot be undone.

**Not produced from this session, deliberately.** No production database
credential exists in this environment. There is also a non-destructive
alternative: enabling `SECURELOGIC_TENANT_DATA_GOVERNANCE_ENABLED` alone exposes
`GET /api/governance/sweep/:dataClass/preview`, which plans and reports and
cannot delete while `EFFECTIVE_FROM` is empty.

---

## 4. Legal-hold behaviour

- **Four scopes:** `organization`, `data_class`, `subject_user`, `object`. A
  subject hold whose target has no owner covers nothing rather than widening.
- **Outranks every deletion path** — sweeper, administrator, owner, and now the
  Art.17 reaper (§1).
- **The owner is refused, not silently skipped:** `409 legal_hold_active`.
- **The sweeper skips and counts**, writing `governance.retention_sweep_suppressed`.
- **Authorization:** `admin` role, a resolvable human (API keys refused), a
  mandatory reason.
- **Separation of duties:** release requires a **different** admin — at the route
  (`409 sod_violation`) and in a database `CHECK`. Single-admin orgs cannot
  self-release; the break-glass is an operator release under the same audit trail.
- **Append-plus-release at the database level:** DELETE and TRUNCATE always
  raise, the only permitted UPDATE is `active → released`, and a release may not
  alter the hold it releases.

---

## 5. Deletion ordering across conversation, content and provenance

One transaction, four statements, in this order:

1. **`ask_provenance_contexts`** — the one place full authorized tool payloads
   are ever written; destroyed first and counted explicitly rather than vanishing
   as a side effect nobody measured.
2. **`ask_proposed_actions`** — would otherwise cascade uncounted (§1b).
3. **`ask_messages`** — this SET NULLs `ask_tool_invocations.message_id`
   (`20261014`) instead of cascading it away, so the ledger — denials included —
   outlives the content it describes.
4. **`ask_conversations`** — last, so no statement runs against a thread whose
   parent is already gone.

Orphaned ledger rows then age out under their own class and become eligible **in
the same sweep run**: the enqueuer emits classes in dependency order. No partial
outcome is possible — the batch commits whole or not at all, and the audit event
is written in the same transaction.

---

## 6. Retry and dead-letter behaviour

| Outcome | Result |
|---|---|
| Exception | `decideFailureState` (shared): requeued with exponential backoff — 1m, 2m, 4m … capped |
| Attempts exhausted | `dead_lettered` **plus** an immutable `governance.retention_sweep_failed` event |
| `NonRetryableJobError` | `failed`, terminal |
| Activation gates closed | `succeeded` with `reason: "blocked"` and a **warn** log |
| Unregistered class in payload | `succeeded` with `reason: "unknown_data_class"`, warn log |

Blocked is deliberately not a failure — it is the expected state while dark, and
dead-lettering every tick of an inert feature would bury real failures. **No
path leaves the job row untouched.**

---

## 7. Rollback — REHEARSED against a populated database

Treated as required, not optional. Script:
`scripts/validation/tdg-rollback-rehearsal.ts` (reproducible; uses the deploy's
own `applyMigration` / `listMigrationFilenames`, so `schema_migrations` is
stamped exactly as production stamps it). Rollback:
`db/rollback/20261013_20261016_tdg_rollback.sql`.

**Result: REHEARSAL PASSED — 26 checks, 0 failures.**

| Phase | Proven |
|---|---|
| Forward | 228 migrations applied to an empty database in strict filename order |
| Populate | 2 orgs, 3 threads with messages + ledger rows, a 2-version policy history, an active hold, governance audit events, and unrelated data |
| **Refusal A** | With **1 orphaned ledger row** present, the rollback **RAISED and changed nothing** — the orphan, the policy history and the TDG tables all survived. The audit record of a read performed on a customer's behalf was **preserved, not destroyed** |
| **Refusal B** | With a `retention_sweep` job row present, the rollback **RAISED**; the job history was preserved |
| Clean path | Committed. TDG tables dropped, `message_id` NOT NULL restored, `conversation_id` dropped, `job_type` narrowed, `13/14/15` unstamped |
| **Retention** | `20261016` **deliberately NOT unstamped** and the owner FK is **still `SET NULL`** — the rollback refuses to re-arm the CASCADE data-loss path the ruling forbids |
| **Audit survival** | Governance audit events **2/2 survived** the rollback |
| **No collateral** | **3/3 conversations survived**; non-TDG schema fingerprint byte-identical after forward re-apply |

**The refusal behaviour is the point.** A rollback that "worked" by deleting
orphaned audit rows and sweep history would have destroyed governance records to
make a constraint fit. It refuses instead, names the count, and leaves the
operator to make that call deliberately.

**Code rollback remains the expected path** and needs none of this: all four
migrations are additive and the capability is dark, so reverting the deploy
leaves inert objects behind.

**Data rollback does not exist.** A deleted conversation is gone. That asymmetry
is the reason for the two gates, the grace window and the hold.

---

## 8. Cross-tenant isolation

Four redundant layers: `withTenant` on every path; **every statement also names
`organization_id` explicitly** (RLS is inert until the `app_request` flip, so
these predicates are today's actual guarantee); RLS policies land with both new
tables; and the DELETEs re-assert their own selection predicate.

Proven in `test/isolation/tenantDataGovernance.test.ts` — org A's plan never
contains org B's conversation; org A cannot delete org B's conversation **even
naming its id exactly**; org B's org-wide hold is invisible to org A; a policy
set by org A does not change org B's effective policy.

---

## 9. The user-deletion ruling (2026-08-16)

An Ask conversation is an **organization-governed record**; it does not die with
its author. Already true and now pinned by tests: the Ask tables are absent from
`CATEGORY_B_DELETE_TABLES`; the reaper tombstones rather than deletes (email and
name scrubbed, credentials cleared, **UUID preserved**, so every reference stays
intact); the ledger survives content deletion.

**One contradiction found and fixed:** `ask_conversations.user_id` was
`ON DELETE CASCADE`. `20261016` makes it `SET NULL`, matching
`ask_messages.user_id`.

**Consequence:** an owner-less thread has no owner-deletion path (administrator
only), and a **subject-scoped** hold cannot cover it. Use an organization-,
class- or object-scoped hold where a hold must outlive the person it concerns.

**The five lifecycle events**, declared as data in `lifecycleEvents.ts` and
tested to be non-aliases: account deletion (**preserves**), owner deletion,
administrator deletion, retention expiration (all three deleting, all three
hold-overridden), organization erasure (deletes everything — **NOT BUILT**,
D-12/ADR-0005), and the legal hold itself (suppresses).

---

## 10. Dark production deployment — verified

**Verdict: E-1 READY for dark production deployment.**

| Property | Evidence |
|---|---|
| Routes do not exist while dark | Live on staging: `/api/governance/classes`, `/holds`, `/retention` and `DELETE /api/ask/conversations/:id` all **404**, while the sibling `GET /api/ask/conversations` **401**s on the same engine — the 404s are the flag refusing, not a broken build |
| Staging runs production's exact condition | The Blueprint is unsynced, so **both variables are ABSENT** on staging — identical to production. Absent and `"false"` agree because the default is off |
| Migrations apply cleanly | Staging engine is `live` on `bddc984d`; its start command is `npm run migrate && npm start`, so a live engine is proof the four migrations applied |
| The enqueuer has **no production footprint** | Unit-proven: with the flag off it returns 0 and issues **zero queries** — not "a query returning no rows". Also inert for `"false"`, `"TRUE"`, `"1"`, `"yes"`, `""` |
| The worker cannot claim a sweep | The claim filter excludes `retention_sweep` while dark, and a source assertion pins that the worker actually composes it that way |
| The second gate holds independently | Flag **on** + `EFFECTIVE_FROM` unset ⇒ `blockers = ["effective_from_unset"]`, execution returns `blocked`, zero rows deleted (proven in the isolation lane) |

**Nothing about a production deploy of E-1 can delete a row.**

---

## 11. Proposed activation semantics for `SECURELOGIC_TDG_EFFECTIVE_FROM`

**What the value means.** The instant this environment came under a declared
retention policy. It is a **platform/environment** value, not per-organization,
and it is the anchor for the 30-day grace window: an object may expire only when
`age_anchor <= now() - retention_days` **AND** `now() >= EFFECTIVE_FROM + 30
days`. Empty or unparseable ⇒ no deletions, ever (a typo fails closed).

**Proposed value: the UTC timestamp at which the customer-facing retention
statement is published**, not the deploy timestamp.

Why that one:

1. **It is the date the commitment becomes true for customers.** The gate's
   purpose is "has this tenant been under a declared policy long enough that
   deleting their data is legitimate" — that clock starts when the policy is
   *declared to them*, not when we shipped code.
2. **It is externally evidenceable.** A published policy has a date a regulator
   or a customer can check. A deploy timestamp is an internal artifact.
3. **It is the conservative of the two.** Publication cannot precede the deploy
   in practice, so this is the later date and therefore the longer protection.
4. **The grace window is not the binding constraint anyway.** Earliest data
   eligibility is 2027-08-16 (§2c), so any date chosen in 2026 leaves roughly a
   year of margin. There is no operational pressure to choose an early one.

**Treat it as write-once.** Lowering it later moves the gate *earlier* and can
open it immediately; raising it silently extends retention past what customers
were told. Either should be a deliberate, recorded decision, not a config edit.

**Recommended sequence, each step separately authorized:**

1. Deploy E-1 to production **dark** (both gates off). Nothing changes.
2. Run §3. Confirm all zeros.
3. Publish the retention statement; record its UTC publication timestamp.
4. Enable `SECURELOGIC_TENANT_DATA_GOVERNANCE_ENABLED` **only**. This exposes
   the surface and the dry-run and still cannot delete. Validate on staging
   first, then production; re-run the preview endpoint per organization.
5. **Only then**, and as its own authorization, set `SECURELOGIC_TDG_EFFECTIVE_FROM`
   to the timestamp from step 3.

Steps 1–4 are all reversible. Step 5 starts a clock that, ~13 months later,
begins deleting customer data.

---

## Verdicts

**Dark production deployment — E-1 READY.** §10 is verified live on staging
under production's exact configuration, the rollback is rehearsed (§7), the
deletion-path inventory is complete and closed (§1), and every gate is proven
inert.

**Destructive activation — E-1 NOT READY.** Two items remain, neither a code
defect:

1. **§3 executed against production** by an operator, returning zero eligible
   rows for every organization and both classes.
2. **The activation ruling in §11** — the chosen `EFFECTIVE_FROM` timestamp, and
   authorization to set it.

Optional but recommended before step 5: re-run the rollback rehearsal against a
production-shaped restore, since the rehearsal above used representative rather
than production-scale data.
