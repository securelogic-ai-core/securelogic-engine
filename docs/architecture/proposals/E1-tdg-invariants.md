# E-1 — Tenant Data Governance: FROZEN INVARIANTS

**Frozen 2026-08-16, before implementation.** These are the properties the
implementation must hold and the tests must prove. An implementation choice that
cannot satisfy one of these is wrong, not the invariant.

**Framing:** TDG is a platform primitive. `ask_conversation` is its **first
registered data class**, never a special case. Any behaviour that cannot be
expressed as a class-registry declaration is a design defect.

---

## TDG-1 — The organization owns the applicable policy

The effective retention policy for any object is resolved from its
`organization_id`, never from a global constant, an env var, or the caller.
Resolution signature is `(organizationId, dataClassKey) -> EffectivePolicy`, and
every deletion decision carries the resolved policy with it.

*Enforced:* single resolver, no other reader of `retention_policies`.
*Proven:* two orgs, different overrides, same class → different cutoffs.

## TDG-2 — Platform default applies when no tenant override exists

Absence of a policy row is a valid, fully-defined state meaning "the class
default". No backfill is required for the schema to arrive, and no org is
ungoverned. `EffectivePolicy.source` is `platform_default` | `tenant`, and is
always populated.

*Proven:* an org with zero policy rows resolves to the class default with
`source = 'platform_default'`.

## TDG-3 — Ask default is 365 days

`ask_conversation.defaultDays = 365`, declared in the registry, not in a route,
worker or SQL literal.

*Proven:* registry assertion + resolver test.

## TDG-4 — Supported tenant values are explicit and validated

Each class declares `minDays` / `maxDays` / `tenantConfigurable`. For
`ask_conversation`: **30–365 inclusive, integer days**. Out-of-range, non-integer
and non-numeric values are **rejected with 400 — never clamped, never coerced**.
A class with `tenantConfigurable: false` rejects any tenant write with 409.

*Proven:* boundary table (29/30/365/366, 0, -1, 36.5, "365", null).

## TDG-5 — Content can never outlive the provenance that substantiates it

Two independent mechanisms, both structural:

1. **Policy validation:** a class's retention may not exceed the retention of
   any class it `dependsOn`. `ask_conversation` (≤365) therefore can never
   exceed `ask_tool_invocation` (fixed 365, `tenantConfigurable: false`).
2. **Sweeper ordering:** a ledger row is eligible for expiry **only when its
   `message_id IS NULL`** — i.e. only after the message it describes is already
   gone. A live message's cited invocations are unreachable by the sweeper by
   construction.

*Proven:* a policy write that would breach rule 1 is rejected; a sweep with a
live message never deletes its invocations.

## TDG-6 — Legal hold overrides expiration AND deletion

A hold covering an object suppresses automated expiry, administrator deletion
and **owner deletion alike**. The owner receives an explicit
`409 legal_hold_active` — never a silent success, never a partial delete.

*Enforced:* the hold predicate lives inside the single delete path, not in its
callers, so a future caller cannot forget it.
*Proven:* all three callers refused under each hold scope.

## TDG-7 — Hold placement and removal are strongly authorized and audited

- `admin` role required; a resolvable human required (API-key-only callers
  refused — same rule as `canApprove`).
- **Release requires a different admin than the placer**: route
  `409 sod_violation`, backed by a DB `CHECK`.
- `reason` is mandatory on both placement and release.
- `legal_holds` is append-plus-release only at the database level: INSERT is
  permitted, the sole permitted UPDATE is the release transition, DELETE and
  TRUNCATE always raise.
- Both transitions write an immutable audit event.

*Proven:* SoD pair test; trigger tests for forbidden DELETE/TRUNCATE and for a
non-release UPDATE.

## TDG-8 — Policy changes are versioned and cannot rewrite history

`retention_policies` is **append-only and versioned**. A change INSERTs a new
version; nothing is updated in place. The effective policy is the highest
version whose `effective_from <= now()`. **Every deletion decision records the
`policy_version_id` under which it was taken**, so a later policy change cannot
retroactively re-explain a past deletion.

*Enforced:* WORM trigger on `retention_policies` (UPDATE/DELETE/TRUNCATE raise).
*Proven:* trigger tests; an audit event's `policy_version_id` still resolves
after three subsequent policy versions.

## TDG-9 — Automated deletion is deterministic, idempotent and tenant-scoped

- **Deterministic:** eligibility is a pure function of
  `(age_anchor, retention_days, holds, effective_from)`. The same inputs produce
  the same set, always.
- **Age anchor:** `COALESCE(last_message_at, created_at)` for
  `ask_conversation`, declared in the registry.
- **Idempotent:** re-running a sweep deletes zero additional rows and writes no
  additional deletion events. Deleting an already-deleted id affects 0 rows and
  is not an error.
- **Tenant-scoped:** every statement carries `organization_id = $1` **in
  addition to** the id list, and runs inside `withTenant`.

*Proven:* double-run test; a planted second-org row is never in a plan or a
delete.

## TDG-10 — Owner deletion and expiration have distinct, defined semantics

| | Owner deletion | Retention expiration |
|---|---|---|
| Trigger | Explicit user request | Sweeper, age ≥ policy |
| Scope | One conversation the requester owns | All eligible conversations for (org, class) |
| Hold | Refused `409 legal_hold_active` | Skipped and counted, never refused |
| Audit | One event per object | One event per **run** + one suppression event |
| Effect | Identical destructive transaction |

Both call the same `deleteConversations()`; the difference is who selects the
ids and how the outcome is reported. No second delete implementation exists.

## TDG-11 — Erasure semantics cannot contradict `dataClassification.ts`

Every governed class declares an `erasureDisposition` that must equal the
disposition recorded in `TABLE_CLASSIFICATION` for its tables. A drift test
fails the build if they diverge.

**RULED 2026-08-16.** An Ask conversation is an **organization-governed
record**. It does not automatically die when the originating user account is
deleted: the user is de-identified in place (tombstone — email and name
scrubbed, credentials cleared, UUID preserved), and the conversation is
preserved under the organization's applicable retention policy, with its
provenance and audit relationships intact.

The ruling exposed one contradiction in the schema, now fixed:
`ask_conversations.user_id` was `ON DELETE CASCADE`, so a hard user delete would
have destroyed the thread and every turn in it. `20261016` replaces it with
`ON DELETE SET NULL`, matching `ask_messages.user_id`, which has been SET NULL
since `20260922`.

**Consequence, documented rather than papered over:** a thread whose owner is
gone has `user_id = NULL`. It has no owner-deletion path (only an administrator
can remove it), and a **subject-scoped** legal hold no longer covers it, because
there is no subject left to match. Where a hold must survive the erasure of the
person it concerns, place it at organization, data_class or object scope.

E-1 does not change reaper behaviour; it makes the schema unable to contradict
the ruling, and pins the ruling with tests in both lanes.

**The five lifecycle events are declared as data** in
`src/api/lib/governance/lifecycleEvents.ts` — account deletion (preserves),
owner-requested deletion, administrator deletion, retention expiration (all
three delete, all three overridden by a hold), organization erasure (deletes
everything; **NOT BUILT**, blocked by D-12, mechanism proposed in ADR-0005), and
the legal hold itself (suppresses). A test asserts no two are aliases of each
other.

## TDG-12 — Deletion failures fail visibly and retry safely

- The deletion and its audit event are written in **one transaction**. They can
  never diverge; a rollback destroys both.
- A deletion event is **only** written for rows actually deleted in that
  committed transaction — the system never claims an erasure it did not perform.
- A failed sweep leaves the job retryable; after `max_attempts` it is
  dead-lettered with a `retention_sweep_failed` audit event. Silence is never a
  success signal.
- Partial batches are impossible: a batch commits whole or not at all.

*Proven:* injected failure mid-batch leaves zero rows deleted and zero events.

## TDG-13 — Cross-org isolation is proven, not asserted

Every route, store call and worker statement executes under `withTenant`, and
every predicate names `organization_id` explicitly. Isolation-lane tests
(real Postgres) prove that org A cannot read, plan, hold, or delete any object
of org B through any TDG surface.

## TDG-14 — Audit records that governance occurred, not what was deleted

Audit payloads carry: conversation id, owner user id, message count, age anchor,
policy version id, actor, reason, class key, cutoff, counts.

They carry **no** conversation title, no message content, no claim text, no tool
payload. Titles are model-generated *from* content and are therefore content.

*Enforced:* audit payloads are built by one function whose input type cannot
express a content field.
*Proven:* a payload-shape test over every TDG event type.

## TDG-15 — The model extends to new classes without schema redesign

Governing `jobs`, `data_export_files`, `email_provider_events` or any future
class requires: one registry entry, one handler pair
(`selectExpired` / `deleteBatch`), one classification cross-check, and tests.
**No migration, no new table, no route change, no worker change.**

*Proven:* a second class is registered in the test suite and exercised through
the same resolver, planner and sweeper with zero production-code changes beyond
its registry entry.

---

## Activation safety (not an invariant — a deployment property)

**Two independent gates, both off by default:**

1. `SECURELOGIC_TENANT_DATA_GOVERNANCE_ENABLED` — off ⇒ enqueuer returns 0
   without touching the database, worker claims no sweep jobs, destructive routes
   404.
2. `SECURELOGIC_TDG_EFFECTIVE_FROM` (ISO date) — **unset ⇒ zero deletions,
   ever**, even with the flag on. Planning and dry-run still work.

**Grandfathering:** an object is eligible only when
`age_anchor <= now() - retention_days` **and**
`now() >= TDG_EFFECTIVE_FROM + 30 days`. No conversation can expire because the
schema arrived; every org gets at least 30 days under a declared policy first.

---

## Correction — 2026-08-16 (E-2 Increment 1)

E-1 claimed, in its commit message, in `lifecycleEvents.ts` and in a comment on
`20261013`, that it "adds nothing to the D-12 cascade web" because its actor
columns use `ON DELETE SET NULL`. **That was wrong on both counts.**

- A `SET NULL` cascade is an **UPDATE**, and the WORM triggers guard
  `UPDATE OR DELETE` — so `SET NULL` does not avoid the web.
- `organization_id` on both new tables is `ON DELETE CASCADE` regardless.

Verified against a real database: an organization holding **only** a
`retention_policies` row, or **only** a `legal_holds` row, cannot be deleted.
`retention_policies` and `legal_holds` are two of the **nine** blocking tables.

No production defect follows — no shipped code deletes an organization or a
user, and E-1 remains dark. Removing these tables from the web is E-2's work.
Corrected in `lifecycleEvents.ts` and recorded in `20261017`; `20261013` is left
untouched because applied migrations are not edited.
