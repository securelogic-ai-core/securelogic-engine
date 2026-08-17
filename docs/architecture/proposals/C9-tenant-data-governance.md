# C-9 redesigned — Tenant Data Governance (TDG)

**Status: PROPOSED — awaiting operator approval. Nothing implemented.** No
schema, route, flag, worker, Blueprint or production state was touched to
produce this. Supersedes the scope of
`docs/legal/C9-ask-conversation-retention-brief.md`, whose *facts* still hold.

**Standard adopted:** build the enterprise foundations now; add enterprise
breadth over time. The test applied to every item below is not "does September
need it" but **"is this materially cheaper and safer to establish before
customer data exists."**

---

## Part 0 — The reframing, in one paragraph

C-9 as briefed was a retention constant for one feature. That is the wrong
object. Retention, deletion, legal hold and erasure are the same governance
question asked of different **data classes**, and SecureLogic will be asked it
by every enterprise buyer about evidence, engagement documents, exports, briefs
and audit trails — not just Ask transcripts. The right primitive is a
**tenant data-governance policy engine keyed on data classes**, with Ask
conversations as its first registered class. The cost difference between
building the engine now and hard-coding a constant now is roughly one package.
The cost difference between building the engine now and retrofitting it after
customer data exists is a data migration under contractual retention
commitments, per class, forever.

---

## Part 1 — What already exists (verified, reused rather than reinvented)

The design below adds **one** new architectural idea. Everything else is an
existing platform pattern applied to a new class.

| Requirement | Existing primitive being reused | Location |
|---|---|---|
| Immutable audit events | `security_audit_log` + WORM triggers (row + TRUNCATE), org FK `ON DELETE SET NULL`, `actor_user_id`, free-form `event_type`, sole writer `writeAuditEvent` | `20260505`, `20260614`, `20260527`, `src/api/lib/auditLog.ts` |
| Separation of duties | Authority seam (pure fn) + route `409 sod_violation` + DB CHECK | `riskApprovalAuthority.ts`, `riskApprovals.ts:292` |
| Scheduled expiry | Cron enqueuer → `jobs` → worker, elevated channel, `NOT EXISTS` dedup, **inert behind a flag** | `accountDeletionEnqueuer.ts`, `exportFilePurgeWorker.ts` |
| Data-class registry | `TABLE_CLASSIFICATION` (category, `userRefColumns`, piiRisk, rlsStatus) | `dataClassification.ts` |
| Tenant erasure mechanism | **ADR-0005 — session-variable escape hatch in the WORM triggers.** PROPOSED 2026-07-28, awaiting ruling, issue #695 | `docs/architecture/decisions/ADR-0005-…` |
| Org-level policy write path | `PATCH /api/org/settings`, admin role, one audit event per change | `orgSettings.ts` |

**The one new idea:** a `(organization, data_class) → policy` table plus a
**class-handler registry**, so governing a new class is a registration, not a
redesign.

---

## Part 2 — The C-9 architecture

### 2.1 Data-class registry (requirement 10 — extensibility)

A code-level registry, not a table — same discipline as `dataClassification.ts`,
which it extends rather than duplicates. Each governable class declares:

```
GovernedDataClass {
  key                 'ask_conversation'        // stable, appears in policy rows + audit events
  label               'Ask conversations'
  tables              ['ask_conversations','ask_messages']
  ageColumn           'last_message_at'          // what "old" means for this class
  defaultDays         365
  minDays / maxDays   30 / 365                   // platform bounds, not tenant-settable
  tenantConfigurable  true
  subjectColumns      ['user_id']                // for subject-scoped holds + erasure
  selectExpired(orgId, cutoff)                   // handler
  deleteBatch(ids)                               // handler — one transaction, ordered
  dependsOn           ['ask_tool_invocation']    // requirement 6, enforced (see 2.5)
}
```

Registering a second class (evidence, export bundles, brief history, `jobs`)
is a handler plus a registry entry plus tests. **No schema change per class.**

### 2.2 `retention_policies` (requirements 1, 2)

One row per `(organization_id, data_class)`, UNIQUE. Columns: `retention_days`,
`source` (`platform_default` | `tenant` | `contract`), `set_by_user_id`,
`effective_from`, `created_at`. **Absence of a row means the class default** —
so the table is empty at birth and every org is governed from day one without a
backfill.

- **Default: 365 days**, measured on `last_message_at`.
- **Tenant range: 30–365 days**, admin-set, validated against the class bounds
  server-side. Values outside the range are a 400, never a clamp.
- Not columns on `organizations`: that pattern (`voice_input_enabled`) does not
  extend to N classes without N migrations.

### 2.3 Deletion (requirement 3) and the migration it forces

Owner deletion, admin deletion and automated expiry are **one code path** with
three callers. Hard delete of `ask_conversations` + `ask_messages` +
`ask_provenance_contexts` in one transaction. No soft delete, no tombstone: a
tombstone of a deleted transcript is a second copy of the thing being deleted.

**The forced migration.** `ask_tool_invocations.message_id` is today
`NOT NULL REFERENCES ask_messages(id) ON DELETE CASCADE`, so deleting content
destroys the audit ledger with it — the opposite of its stated design intent.
Required: make `message_id` **nullable** with `ON DELETE SET NULL`, plus a
denormalised `conversation_id` (nullable, same treatment) so a ledger row
remains attributable after its message is gone. Additive + one constraint swap;
trivial today against a near-empty production table, materially harder once
these tables are large.

### 2.4 Administrator governance without content access (requirement 4)

Three planes, deliberately separated:

| Plane | Admin may | Admin may not |
|---|---|---|
| **Metadata** | List every thread in the org: id, owner, mode, created/last-message, message count, retention state, hold state | See any question or answer text, titles included (titles are model-generated from content) |
| **Action** | Delete by conversation id or by user; set retention policy; place/release holds | — |
| **Content** | **Nothing. Not built.** | — |

This answers "governance without unrestricted blind content access" by giving
admins authority over the *lifecycle* of a thread without authority over its
*contents* — deletion never requires reading. A future governed content-access
path (reason-bound, WORM-audited, owner-notified) gets a seam
(`askContentAccessAuthority`) and no implementation. Adding access later is
easy; withdrawing it after admins have it is not.

Every metadata listing and every admin action writes an audit event.

### 2.5 Provenance coupling (requirement 6) — enforced structurally

Two rules, neither of which relies on operator discipline:

1. **Policy validation:** a class's retention may not exceed the retention of
   any class in its `dependsOn`. `ask_conversation` (max 365) therefore can
   never exceed `ask_tool_invocation` (fixed 365 / 12 months, matching
   published Privacy Policy §10.4, **not** tenant-configurable — a
   customer-shortenable audit ledger is not an audit ledger).
2. **Sweeper ordering:** a ledger row is eligible for expiry **only when
   `message_id IS NULL`** (its message is already gone) **and** it is older than
   the ledger period. A live message's cited invocations are therefore
   unreachable by the sweeper by construction, not by query hygiene.

Net invariant: **no conversation can outlive the provenance that supports it,
and no live answer can lose its evidence chain.**

### 2.6 Legal hold (requirements 5, 9)

`legal_holds`: `organization_id`, `scope_type` (`org` | `data_class` |
`subject_user` | `object`), `scope_ref`, `reason` (required), `placed_by_user_id`,
`placed_at`, `released_by_user_id`, `released_at`, `status`.

- **A hold suppresses everything**: automated expiry, admin deletion **and
  owner deletion**. The owner gets an explicit `409 legal_hold_active`, not a
  silent no-op — a user told "deleted" whose data was retained is worse than a
  refusal.
- **Enforcement in the delete path itself**, not in the callers, so a future
  caller cannot forget it.
- **SoD, mirroring `riskApprovals` exactly:** placement requires the `admin`
  role and a resolvable human (`actorUserId !== null` — API keys refused, per
  `canApprove`); **release requires a different admin than the placer**, refused
  `409 sod_violation`, backed by a DB `CHECK (released_by_user_id IS NULL OR
  released_by_user_id <> placed_by_user_id)`. Authority lives in one pure seam,
  `legalHoldAuthority.ts`.
- **Single-admin orgs cannot self-release.** Deliberate. The break-glass is an
  operator-executed release under the same audit trail, documented in a runbook.
- `legal_holds` is WORM (release is an UPDATE of the release columns only — so
  the table takes an append-plus-release trigger, not a blanket forbid-UPDATE;
  the trigger permits exactly the release transition and nothing else).

### 2.7 Erasure semantics (requirement 7)

Two distinct paths, and the ruling should be explicit that they differ.

**User account erasure (Art. 17).** Recommendation: **Ask threads die with the
user.** Reclassify `ask_conversations` / `ask_messages` for deletion purposes
and add them to `CATEGORY_B_DELETE_TABLES`. The architectural argument: unlike a
risk treatment or a control assessment, an Ask thread is *not* org work product
— it is user-scoped by design, no colleague can read it, and it is phrased for
one person. Treating it as org content is what produces today's outcome, where a
user exercising Art. 17 leaves their questions in the org forever. This also
resolves the `dataClassification.ts` line that already promises Ask threads are
"included in GDPR export and erasure" — a promise the reaper does not keep.

**Org erasure.** Blocked by D-12 (WORM triggers fire on FK cascade), which
**ADR-0005 already proposes to solve** via a session-variable escape hatch behind
an erasure certificate. The recommendation is to **ratify ADR-0005 and build it**,
not to design a second mechanism. C-9 depends on it only for org-level erasure;
retention, holds and per-user erasure do not.

### 2.8 Immutable audit events (requirement 8)

**Reuse `security_audit_log`. Do not create a retention audit table.** It is
already WORM at the database level, already org-scoped, and its
`organization_id ON DELETE SET NULL` means the record of an erasure survives the
erasure — which a new org-FK'd table would not.

New `event_type` values:

| Event | Emitted when | Granularity |
|---|---|---|
| `retention_policy_changed` | Tenant/platform policy set or cleared | Per change, with before/after |
| `legal_hold_placed` / `legal_hold_released` | Hold lifecycle | Per hold, with reason + both actors |
| `ask_conversation_deleted` | Owner or admin deletion | Per object |
| `retention_expiry_executed` | Sweeper run | **Per run**, with class, cutoff, counts, and held-back count |
| `retention_sweep_suppressed` | Objects skipped for hold | Per run, with counts |
| `erasure_executed` | Account/org erasure | Per subject, referencing the certificate |

The per-run granularity for expiry is deliberate: one event per deleted object
would make the audit log the retained data, and the audit log is the one thing
we are not deleting.

**Also to settle here:** `audit_log` (20260405) is a *second*, **non-immutable**
audit table. Two audit tables with different integrity guarantees is a governance
smell that an enterprise assessor will find. Retention events go to the immutable
one; the divergence itself is listed in Part 3.

### 2.9 Execution model

Cron enqueuer → `jobs` → sweeper worker, copying `accountDeletionEnqueuer`
line for line: elevated cross-org scan, `NOT EXISTS` dedup, **returns 0 without
touching the database while the flag is off**. New job type
`retention_sweep`, one job per (org, class). Batched deletes with a bounded
batch size. The whole capability lands inert behind
`SECURELOGIC_TENANT_DATA_GOVERNANCE_ENABLED`.

### 2.10 What this does NOT include

Content access for admins; crypto-shredding / per-tenant keys; residency
controls; retention for classes other than Ask (the registry makes them cheap,
but each needs its own ruling); backup erasure — deletion is from live systems
only, which existing Privacy Policy §10.2 archival language already covers, and
`DR_PLAN.md` still carries `[OPERATOR-VERIFY]` on backup retention.

---

## Part 3 — Enterprise-readiness backlog

Each item: business value · architectural reason · scope · migration/data impact
· security risk · test burden · Stage-2 dependency.

### BUILD BEFORE LAUNCH

**E-1 — Tenant Data Governance engine (this document).**
*Value:* answers the retention/deletion/hold questions in every enterprise DDQ
with a product capability rather than a policy paragraph. *Architectural:* the
class registry is the difference between one ruling and one ruling per class,
forever. *Scope:* 2 tables, 1 registry, 1 enqueuer, 1 worker, ~6 routes, 1
constraint-swap migration, flag. *Migration/data:* additive; the
`ask_tool_invocations.message_id` swap is trivial now and expensive later.
*Security:* delete paths are destructive — hold enforcement must live in the
delete path, and cross-tenant scoping needs isolation-lane coverage. *Tests:*
high — isolation lane for every route, SoD pair tests, sweeper idempotency,
hold-suppression, provenance invariant. *Stage-2:* **independent** — Ask
persistence is already live in production and accruing now.

**E-2 — Ratify and build ADR-0005 (WORM erasure escape hatch), closing D-12/D-3.**
*Value:* tenant offboarding and Art. 17 become possible; Enterprise DPA
commitments become honest. *Architectural:* every new tenant deepens the web of
cascade-blocked rows; the trigger change is the same work at any date, but
*executing* an erasure is far safer to rehearse before real customer data.
*Scope:* 6 trigger functions, erasure certificate, dry-run mode, admin-chain
gate, runbook, staging rehearsal on `[SEED]` orgs. *Migration/data:* trigger
DDL on six evidentiary tables — no data change. *Security:* **the highest-risk
item on this list** — it deliberately weakens WORM under one condition, and must
have its own security review and isolation tests proving the triggers still
RAISE without the variable. *Tests:* high. *Stage-2:* independent.

**E-3 — Per-organization capability gates for the env-global flags.**
*Status 2026-08-17: BUILT on branch (migration `20261021_org_capability_gates`,
`orgCapabilityGates.ts`, wired at the five Ask flag sites) behind
`SECURELOGIC_ORG_CAPABILITY_GATES_ENABLED` (default off, zero-query
passthrough). One deviation from this document awaiting ruling: per-capability
org defaults (live `ask` = allow; dark agentic keys = deny/explicit-grant-only)
instead of blanket default-on — blanket default-on would leave Stage-2
activation all-tenants-at-once, which is the property E-3 removes.*
*Value:* staged rollout, per-tenant pilots, and the ability to enable an agentic
capability for one design partner. *Architectural:* every Ask/agentic flag is
**environment-global with no per-org gate** (audit §4), so Stage-2 activation is
all-tenants-at-once — a property that gets strictly worse with each customer,
and a gate retrofitted after activation means turning capabilities *off* for
live users. *Scope:* an org capability table + resolver + middleware, flags
resolving `env AND org`. *Migration/data:* additive; default-on preserves
current behaviour exactly. *Security:* a resolver bug is an entitlement bug —
fail-closed and test both directions. *Tests:* medium-high. *Stage-2:*
**direct dependency — this materially de-risks Stage 2 and should precede it.**

### BUILD IF LOW-RISK

**E-4 — Retention for the classes already accumulating** (`jobs`,
`data_export_files`/R2 bundles, `email_provider_events`, `security_audit_log`
itself at its published 12 months). *Value:* the policy engine governs the
platform, not one feature. *Architectural:* pure registry additions once E-1
exists. *Scope:* one handler + defaults + tests per class. *Migration:* none.
*Security:* low, except `security_audit_log`, whose expiry must itself be
audited. *Tests:* medium. *Stage-2:* independent.

**E-5 — Wire the admin IP allowlist.** `requireAdminNetwork.ts` has **zero call
sites** while `selfTest` requires its env var and reports `/admin` as
"fail-closed if missing" — a control believed active that enforces nothing.
*Value:* closes a control that is currently asserted and false. *Scope:* small —
attach the middleware, fix the self-test claim. *Migration:* none. *Security:*
must not lock the operator out; needs a staging rehearsal. *Tests:* low.
*Stage-2:* independent.

**E-6 — Reconcile the two audit tables.** Pick `security_audit_log` as the
system of record, migrate or retire `audit_log`, and close D-8's uneven
coverage. *Value:* one audit story survives assessor questions. *Scope:*
medium. *Migration:* possible backfill. *Security:* low. *Tests:* medium.
*Stage-2:* independent.

**E-7 — Org-level DSAR export (Art. 15 `org_full`).** The job type exists;
finish the surface. *Value:* enterprise data-portability commitments.
*Scope:* medium, mostly built. *Stage-2:* independent.

### DEFER

**E-8 — RLS `app_request` role flip (M-1).** Policies are inert because the
engine connects as owner. This is the **single largest retrofit cost on the
list** and the argument for doing it while production is empty is real — but
tenant-route coverage is still 260 warn-only, and flipping it in the same window
as a launch converts every un-wrapped route into a production outage. It needs
its own package, its own gate and its own rehearsal. *Recommendation: schedule
deliberately, not opportunistically.* Note honestly: this is the one DEFER whose
cost genuinely rises with customer data.

**E-9 — Crypto-shredding / per-tenant encryption keys.** Rejected in ADR-0005
for proportionality; unchanged.

**E-10 — Data residency / region controls.** Feature breadth; no customer
commitment exists.

**E-11 — Governed admin content access for Ask.** Seam now, implementation only
on a real customer requirement. Easy to add, impossible to withdraw.

---

## Part 4 — Recommended sequence

1. **Rule on this document** (Part 2) and on ADR-0005 (E-2).
2. **E-1** — the engine, Ask as its first class, inert behind its flag.
3. **E-3** — per-org capability gates, **before Stage-2 activation**.
4. **E-2** — erasure hatch, with its own security review and staging rehearsal.
5. **E-5**, then **E-4**, then **E-6/E-7** as capacity allows.
6. **E-8** scheduled as a standalone package with its own gate.

## Part 5 — What the ruling needs to decide

1. Adopt the class-registry model (Part 2.1), or hard-code Ask retention.
2. Default 365 / tenant range 30–365 / ledger fixed 365, as proposed.
3. Admin governance = metadata + action planes, **no content plane**.
4. Ask threads die with the user on Art. 17 erasure (2.7), and
   `CATEGORY_B_DELETE_TABLES` is extended accordingly.
5. Legal-hold SoD: release requires a different admin; single-admin orgs use an
   operator break-glass.
6. Ratify ADR-0005 (E-2) — or keep org erasure impossible and say so in the DPA.
7. Confirm E-3 precedes Stage-2 activation.
8. Confirm E-8 (RLS flip) is deliberately scheduled rather than dropped.
