# E-2 — Tenant erasure: discovery and design

**Status: RULED 2026-08-16. Increments 1–3 DELIVERED and deployed to staging,
inert. Increment 4 NOT STARTED and governance-gated.**

Erasure remains impossible in every environment: `erasure_agent` is `NOLOGIN`,
so no connection can be made as it. E-2 is **technically ready** for Increment 4
and **not governance-authorized** for it — see the closing section.

The original discovery text is preserved below exactly as written, including the
claims that building the increments later corrected. The rulings, the delivery
notes and the corrections are appended at the end; where the two disagree, the
later section wins and says so. Nothing was quietly edited to look right in
hindsight.

**Headline: ADR-0005 as literally specified is NOT the correct enterprise
solution.** It closes the finding and would leave the audit log gated by a value
an attacker can set for themselves. A corrected design is in §12.

---

## 1. ADR-0005, D-12 and D-3 in plain English

**D-3 — "GDPR deletion is not built."** A customer can ask for a copy of their
data and get one. If they ask us to delete it, we have no mechanism. Technically:
the Art.15/20 export engine ships; the Art.17 reaper is designed (ten settled
decision-locks) but the org-level path was never built.

**D-12 — "and it could not be built anyway."** Six (now nine) tables are
*append-only*: the database itself refuses to change or remove a row, no matter
who asks. That is deliberate — they hold the audit trail and the governance
decisions. The catch: when you delete a customer, the database tries to tidy up
the rows that pointed at them, and that tidy-up trips the same refusal. So
deleting a real tenant fails partway through and rolls back. Technically:
`BEFORE UPDATE OR DELETE … FOR EACH ROW` triggers that `RAISE` unconditionally,
and PostgreSQL fires row triggers on **FK-driven cascades** — both
`ON DELETE CASCADE` (a delete) and `ON DELETE SET NULL` (an update).

**ADR-0005 — the proposed way out.** Let the guards stand down for one specific,
audited transaction, identified by a session variable the erasure job sets.
Everything else stays absolute.

---

## 2. Current security boundary, and the weakness

**The boundary today** is the trigger layer. It is *role-independent*: it binds
the owner, `app_request`, and anyone holding the database password alike. That
is unusually strong, and it is what makes the SOC 2 CC7.2 / NIST AU-9 claim in
`20260614` true today.

**The weakness we are trying to eliminate** is not a hole — it is the
*absoluteness*. Because the guard cannot distinguish "an attacker scrubbing
their tracks" from "a lawful erasure", we have chosen to be unable to do the
lawful thing. Consequences: Art.17 unsatisfiable, commercial offboarding
impossible, Enterprise DPA commitments unhonest, and the web deepens with every
tenant.

**A second weakness, found during this discovery:** there is no single WORM
policy. Nine tables are guarded by **six independently-written trigger
functions**. Each new evidentiary table has added its own copy, and E-1 added two
more. Any escape hatch must be implemented six times or the behaviour diverges —
and divergence in a control like this is how one table quietly stops being
protected.

---

## 3. Affected production code paths — traced, not assumed

**No shipped code deletes an organization or a user.** A grep across `src/` and
`services/` for `DELETE FROM organizations` / `DELETE FROM users` returns
nothing but a comment. The affected paths are therefore *potential* ones:

| Path | Status | Reaches the web? |
|---|---|---|
| `accountDeletionReaper` (Art.17, user-level) | Built, **inert** — its flag is absent in every environment | **No, by design.** D-1 chose to TOMBSTONE the `users` row rather than delete it. This discovery shows that decision was load-bearing for a reason not recorded at the time: a hard user delete *raises* (§4) |
| Org erasure | **Not built.** No route, no worker, no job type | n/a |
| `scripts/validation/seed-walkthrough-org.ts` teardown | Non-production only; deletes by `ALTER TABLE … DISABLE TRIGGER` inside its transaction | Yes — and it is explicitly not an offboarding mechanism |
| E-1 retention sweeper / owner / admin deletion | Live, dark | No — governed tables carry no WORM trigger |
| SSO | `sso.ts` exists; **no SCIM implementation** | No automated deprovisioning exists to delete users |
| API-key rotation | Uses `status` / `revoked_at` | Revocation does not delete, so it does not hit the web — but a *deleting* rotation would (§4) |

## 4. What currently depends on this control — measured

Nine tables, six trigger functions, and the cascade paths that reach them:

| Table | Reached from `organizations` by | Reached from `users` by |
|---|---|---|
| `finding_lifecycle_events` | CASCADE (also via `findings`) | SET NULL |
| `risk_lifecycle_events` | CASCADE (also via `risks`) | SET NULL |
| `applicability_assessments` / `_evidence` / `_affected_entities` | CASCADE | — |
| `finding_risk_acceptances` | CASCADE + `finding_id` **RESTRICT** | SET NULL ×4 |
| `security_audit_log` | **SET NULL** | SET NULL (+ `api_keys` SET NULL) |
| **`retention_policies`** (E-1) | CASCADE | SET NULL |
| **`legal_holds`** (E-1) | CASCADE | SET NULL ×3 |

**Reproduced against a real database**, each in its own rolled-back transaction:

```
org with NOTHING attached                              -> SUCCEEDED
org with ONLY a retention_policies row (E-1)           -> RAISED (DELETE not permitted)
org with ONLY a legal_holds row (E-1)                  -> RAISED (DELETE not permitted)
org with ONLY a security_audit_log row                 -> RAISED (UPDATE not permitted)

user with nothing referencing them                     -> SUCCEEDED
user referenced by security_audit_log.actor_user_id    -> RAISED (UPDATE not permitted)
user referenced by legal_holds.placed_by_user_id       -> RAISED
user referenced by retention_policies.set_by_user_id   -> RAISED
deleting an audited api_key                            -> RAISED (UPDATE not permitted)
```

**Two corrections this forces, stated plainly:**

1. **`ON DELETE SET NULL` does not avoid the web.** A SET NULL cascade is an
   UPDATE, and these triggers guard `UPDATE OR DELETE`. Any escape hatch must
   permit **UPDATE as well as DELETE**, or erasure still fails on
   `security_audit_log`.
2. **E-1 deepened the web.** Its commit message and `lifecycleEvents.ts` say E-1
   "adds nothing to the cascade web" on the grounds that its actor columns are
   SET NULL. That reasoning is wrong for the reason above, and its
   `organization_id` columns are CASCADE regardless. `retention_policies` and
   `legal_holds` are now two of the nine blockers. This does not change E-1's
   dark-deployment posture, and it is not a production defect today — nothing
   deletes an organization — but the claim is false and should be corrected when
   E-2 lands.

**Non-database dependents:** the SOC 2 / NIST audit-integrity claim; E-1's
governance events, which are the *only* durable record that a deletion happened;
and the "withdrawn, not erased" rule for risk acceptances.

## 5. The attack and failure scenarios

**What the control prevents (and must keep preventing):**

- **Track-scrubbing.** An attacker who reaches SQL — injection, a leaked
  credential, a malicious insider — deletes or edits `security_audit_log` rows
  to remove evidence of what they did. There is no audit-of-the-audit; without
  the trigger this is undetectable. This is the scenario `20260614` was written
  for (OWASP A08-G1).
- **Evidence destruction under dispute.** Governance decisions — a risk
  acceptance, an applicability determination, a finding's lifecycle — are edited
  after the fact to change what the record says was decided and by whom.
- **Accidental mass loss.** A cascade, a migration, or a "cleanup" script
  silently removes evidentiary rows. The trigger converts a silent loss into a
  loud failure.

**What the absoluteness causes:** a lawful erasure request cannot be honoured;
offboarding a customer is impossible; and the failure mode is a partial,
rolled-back deletion — which is at least safe.

## 6. Is ADR-0005 the correct enterprise solution, or does it just close the finding?

**It just closes the finding, as specified.** The mechanism it proposes — a
session variable — is not an authorization boundary. Verified:

```
SET ROLE app_request;
SELECT set_config('app.erasure_authorized','any-value-i-like', true);  -> ALLOWED
```

**Any role can set any custom GUC**, including the least-privileged one. So an
attacker who can execute SQL through the application can set the variable and
then delete the audit rows that would have recorded them. The control would go
from "absolute" to "gated by a string the adversary controls" — against exactly
the adversary of §5.

Two honest qualifiers, because the picture is not one-sided:

- **Today the app connects as the database owner** (RLS is inert, KNOWN_ISSUES
  M-1), and the owner **can** `ALTER TABLE … DISABLE TRIGGER` — verified. So
  against a compromised *owner* credential the triggers are already not a hard
  boundary. The escape hatch would still make it materially easier: one
  `set_config` on the app's normal pooled connection versus a DDL statement.
- `app_request` **cannot** disable a trigger — verified. So after the M-1 flip
  the trigger layer becomes a genuine boundary against the app, and a GUC-only
  hatch would then be a real weakening of a real control.

**The correct enterprise solution is to make the boundary depend on something
the adversary cannot mint: a credential.** A dedicated database role, never held
by the application, checked by the trigger itself. The session variable stays —
as a statement of *intent* and as the carrier of the target org id — but it
stops being the thing that grants permission.

## 7. Desired fail-closed behaviour

1. **Absent context ⇒ RAISE.** No variable, no role, no certificate: the trigger
   behaves exactly as today.
2. **Wrong role ⇒ RAISE**, even with a perfectly-formed variable.
3. **Wrong organization ⇒ RAISE.** The asserted org must match the row's
   `organization_id`; an erasure of tenant A can never touch tenant B's rows.
4. **No certificate ⇒ RAISE.** A certificate row for this erasure must already
   exist in the same transaction.
5. **Unparseable / malformed context ⇒ RAISE.** Never "treat as absent and
   continue"; never coerce.
6. **Outside a transaction ⇒ RAISE.** The variable must be transaction-scoped
   (`set_config(…, true)`), so it cannot leak to the next pooled user.
7. **Active legal hold ⇒ REFUSE the erasure before it starts** (E-1 interaction,
   §11).
8. **Dry run ⇒ never mutate.** Enumerate and report; the same code path with the
   commit withheld.
9. **Partial failure ⇒ whole rollback.** An erasure is one transaction; there is
   no half-erased tenant.

## 8. Database and migration implications

- **Consolidate first.** Replace six divergent trigger functions with **one
  shared guard**, wired to all nine tables. Without this, the hatch is
  implemented six times and drifts. This is the single highest-value structural
  change in E-2 and is worth doing even if the hatch is never approved.
- **The guard must cover UPDATE and DELETE**, per §4 correction 1.
- **New role** `erasure_agent`: `LOGIN`, `NOBYPASSRLS`, `NOSUPERUSER`, not the
  table owner, granted only what erasure needs. Its credential lives outside the
  application's environment.
- **New table** `erasure_certificates`: target org, requested by, authorized by
  (two-person, §11), reason, scope digest, dry-run flag, started/completed. It
  must itself be append-only — and therefore must be **exempt** from the
  cascade problem (no `organization_id` FK to the org being erased, or the
  certificate dies with its subject).
- **No data migration.** All of this is DDL plus one new table; not one existing
  row changes.
- `finding_risk_acceptances.finding_id ON DELETE RESTRICT` must be handled
  explicitly in the erasure ordering — RESTRICT is not a trigger and no hatch
  affects it.

## 9. Cross-organization isolation tests required

Real-Postgres isolation lane, and the negative cases matter more than the happy
path:

1. Triggers **still RAISE** with no context set — one test per table, all nine.
2. Triggers **still RAISE** when the GUC is set but the role is wrong (this is
   the §6 attack, executed as `app_request`).
3. Triggers **still RAISE** when the role is right but the org id does not match
   the row.
4. Triggers **still RAISE** for a forged/garbage GUC value.
5. Triggers **still RAISE** when no certificate row exists.
6. Erasing org A leaves **every** org B row intact — counted per table, before
   and after.
7. The GUC does not survive the transaction (next statement on the same pooled
   connection raises again).
8. UPDATE path specifically: a SET NULL cascade from `users`/`api_keys` raises
   without context and succeeds under it.
9. Dry run mutates nothing — row counts identical.
10. An active legal hold blocks the erasure entirely (E-1).
11. After a completed erasure the certificate **survives**, and so does the audit
    record of the erasure.

## 10. Rollout and rollback, against existing production data

- **Phase 1 (consolidation)** is behaviour-preserving: same refusals, one
  implementation. Rollback is re-creating the old functions; no data risk.
- **Phase 2 (hatch + role + certificate)** ships **inert**: the role exists but
  no credential is issued, so no transaction can satisfy the guard. Erasure is
  still impossible until a human is handed the credential.
- **Production shape favours doing this now.** Production carries very few
  organizations and near-zero Ask data; the web is shallow today and deepens
  monotonically. Every month of delay makes the first real erasure larger.
- **Rollback of an erasure does not exist** — that is the nature of the feature,
  and is why the certificate, the dry run and the two-person rule are part of the
  design rather than additions to it.
- Rehearsal on `[SEED]` orgs in staging is mandatory before any production use,
  per ADR-0005's own consequence list.

## 11. Interactions

**E-1 (live, dark).** Two directions. (a) `retention_policies` and `legal_holds`
are now blockers — E-2 must include them, and the false claim in E-1's commit
message should be corrected. (b) **A legal hold must outrank an erasure.** E-1
already has the predicate (`holdCoveringSubject`) and already applies it to the
Art.17 reaper; org erasure must consult holds the same way, and
`lifecycleEvents.ts` already declares `organization_erasure` as
`overriddenByLegalHold: true` — E-2 is where that declaration becomes true.

**E-3 (per-org capability gates, not started).** An erased tenant's capability
rows must be removed with it. If E-3 lands first, its table joins the erasure
scope; if E-2 lands first, E-3 must register with the erasure inventory. Neither
blocks the other.

**SSO / SCIM.** `sso.ts` exists; **no SCIM implementation exists**, so there is
no automated deprovisioning path that deletes users today. If SCIM is ever
added, `DELETE`-semantics deprovisioning would hit the user-side web
immediately — SCIM should deactivate, and its design should reference this.

**Service accounts / API keys.** Deleting an audited `api_keys` row raises
(verified). Rotation already revokes rather than deletes; that should be recorded
as a requirement, not left as an accident.

**Background workers.** The E-1 sweeper and the Art.17 reaper both mutate tenant
data on a schedule. An erasure must not race them: the erasure transaction should
take its scope under lock, and the certificate should be checked by both workers
so neither operates on a tenant mid-erasure.

## 12. E-2 DESIGN RECOMMENDATION — the minimum coherent architecture

**Adopt ADR-0005's *shape* — a guarded exception rather than blanket
suspension — and change its *gate* from a session variable to a credential.**

**The guard, in one shared function used by all nine tables:**

```
permit the operation ONLY IF ALL of:
  1. session_user = 'erasure_agent'                     <- the boundary
  2. current_setting('app.erasure_org_id', true) = NEW/OLD.organization_id
  3. a matching, open erasure_certificates row exists    <- the record
  4. the operation is UPDATE or DELETE from a cascade in that scope
otherwise RAISE, exactly as today
```

Condition 1 is what an attacker with application SQL cannot satisfy; conditions
2–3 are what a *mistake* by a legitimate operator cannot satisfy. That split is
the design.

**Sequenced as four increments, each independently valuable:**

| # | Increment | Ships | Value on its own |
|---|---|---|---|
| **1** | **Consolidate** nine tables onto one shared WORM guard, behaviour unchanged | Behaviour-identical | Ends six-way divergence; makes every later step one change instead of six |
| **2** | `erasure_agent` role + `erasure_certificates` + the guard conditions, **no credential issued** | Inert | The mechanism exists and is testable; erasure still impossible |
| **3** | The erasure executor: scope inventory, hold check, dry-run, ordered deletion, certificate lifecycle, audit event | Behind a flag, dry-run only | Answers "what would be destroyed" for a real tenant |
| **4** | Credential issuance + staging rehearsal on `[SEED]` orgs → first authorized erasure | Operator-gated | D-3 and D-12 close |

**Security invariants (the E-2 equivalent of E-1's frozen list):**

- **E2-1** Absent context behaves exactly as today, on all nine tables.
- **E2-2** The gate is a credential the application never holds; a session
  variable alone never authorizes anything.
- **E2-3** An erasure can only ever touch the asserted organization.
- **E2-4** No erasure without a pre-existing certificate in the same transaction.
- **E2-5** The guard covers UPDATE as well as DELETE.
- **E2-6** One shared implementation; adding a WORM table cannot fork the policy.
- **E2-7** A legal hold outranks an erasure.
- **E2-8** Dry run mutates nothing.
- **E2-9** The certificate and the erasure audit event survive the erasure.
- **E2-10** Every refusal is loud; nothing degrades to a silent no-op.

**Implementation scope:** ~2 migrations (consolidation; role + certificate +
guard), one erasure service with a scope inventory derived from the FK graph
rather than hand-listed, one executor entry point, a runbook, and the isolation
suite in §9. No application route is required for increments 1–3.

**Tests required:** the eleven classes in §9, plus a build-failing test that a
new WORM table cannot be introduced with its own private trigger function.

**Rollout:** increments 1–2 are safe to deploy dark in the same manner as E-1;
3 behind a flag, dry-run only; 4 is a separate operator authorization with a
staging rehearsal first.

---

## Requiring your ruling

1. **Adopt the credential-gated variant, or ADR-0005 as written?** My
   recommendation is the credential variant; the GUC-only version is weaker than
   what we have today against the attacker it was written for.
2. **Does E-2 depend on the M-1 / `app_request` flip?** The trigger layer only
   becomes a true boundary against the application once the app stops connecting
   as owner. E-2 is worth doing before that, but its strength is capped until
   then. This is a sequencing decision, not a code one.
3. **Two-person authorization for an erasure** — required, or single admin plus
   certificate? (E-1 set the precedent that release-of-hold needs a second
   admin.)
4. **Is increment 1 (consolidation) authorized on its own?** It is
   behaviour-preserving, closes the six-way divergence, and does not depend on
   ruling 1.
5. **Certificate retention** — how long, and where. It is the record that a
   tenant was erased, and it must outlive the tenant.
6. **Correcting E-1's claim** that it adds nothing to the cascade web: fix now as
   a docs change, or fold into E-2's first increment?

---

## Rulings received — 2026-08-16

| # | Question | Ruling |
|---|---|---|
| 1 | Credential-gated variant, or ADR-0005 literally? | **Credential-gated variant approved.** ADR-0005 is not implemented literally; its fail-closed intent is preserved |
| 2 | Wait for M-1 / `app_request`? | **No.** Implement now, and **explicitly document and test the residual limitation** that remains until M-1 completes |
| 3 | Two-person authorization? | **Required.** Requester and approver must be different authorized users. Revalidate legal hold **immediately before execution**. No self-approval, no bypass through alternate application paths |
| 4 | Is Increment 1 authorized alone? | **Yes**, provided it remains behaviour-preserving |
| 5 | Certificate retention | **7 years.** It must prove governed erasure occurred **without retaining the content that was erased** — minimize fields accordingly, and identify any privacy/legal conflict before implementation |
| 6 | Correct E-1's cascade-web claim | **Yes, as part of Increment 1.** Incorrect lifecycle documentation is not knowingly preserved |

**Additional standing invariants from the same ruling:**

- API-key lifecycle remains **revoke/deactivate**, never destructive deletion.
- Any future **SCIM** implementation must **deactivate** users rather than blindly
  delete identities where that would break organizational record integrity.
- **E-1 legal hold outranks every erasure path.**
- Increments are sequential: complete and validate each before the next.

**On two-person authorization, in the operator's words:** it is not bureaucracy
for its own sake. SecureLogic exists to govern consequential risk decisions; a
single compromised account being able to irreversibly wipe an organization's
entire governance history would undermine the rest of the control architecture.
That is the design rationale, and it belongs in the record.

### Increment 1 — delivered

One shared `worm_guard_mutation()` across all nine tables; the two state
machines deliberately left local; behaviour proven identical against messages
captured from the pre-consolidation database; rollback rehearsed clean-room.
The residual M-1 limitation (ruling 2) is documented in §6 and **tested** in
`test/isolation/wormGuardConsolidation.test.ts` — the owner, which is what the
application connects as today, is stopped by the guard, and that guard is the
only mechanism in its way until the `app_request` flip.

### Increment 2 — delivered

`erasure_agent` created **NOLOGIN** (the inertness is structural, not
procedural), `erasure_certificates` with no FK to its subject and a name digest
rather than a name, and the guard's exception conditions. Erasure still
impossible: the mechanism exists, no credential does.

One design correction against §6: the check is on **`session_user`, not
`current_user`**. `SET ROLE erasure_agent` changes `current_user` but not
`session_user`, so role assumption cannot satisfy the guard. That makes the
residual M-1 limitation **narrower** than §6 claimed — the app-as-owner cannot
satisfy this guard; its remaining power is `DISABLE TRIGGER`, which bypasses the
guard rather than passing it, and was already true before E-2.

Also correcting §6's own evidence: the probe reported there as
`app_request -> SET ROLE erasure_agent: ALLOWED` was **invalid**. The session
was superuser throughout, so it demonstrated nothing about escalation.

---

## Increment 3 — delivered, and what building it changed

Request → inventory → dry-run → two-person approval → TOCTOU revalidation →
execution → certificate. Delivered with the ruling of 2026-08-16 applied and the
`[SEED]` rehearsal passed (14 stages, 10 disposable tenants, 9 negative paths).

### A security defect in Increment 2, found by building Increment 3

**The legal-hold check could FAIL OPEN.** `legal_holds` has RLS keyed on
`app.current_org_id`; `erasure_agent` is `NOBYPASSRLS`; the executor sets no
tenant context. The hold query therefore returned **zero rows** — not an error,
not a refusal, an empty result that reads exactly like "there is no hold".

Both hold checks were exposed: the executor's pre-flight, and the `EXISTS`
clause inside `worm_guard_mutation` on the **direct** path. Increment 2's hold
test passed only because it ran through a **cascade**, where PostgreSQL uses the
table owner's rights and the hold happened to be visible. An accident is not a
control.

Fixed by reading holds through `erasure_active_hold_count()`, a
`SECURITY DEFINER` function that cannot be blinded by RLS or a missing tenant
context.

### The capability model had to change, twice, to stay honest

§12 assumed the guard was the only thing standing between the role and the data.
Building the executor showed two places where the obvious implementation would
have quietly turned the erasure credential into a **read** credential:

1. **The TOCTOU re-inventory** must count rows in 112 org-scoped tables at the
   moment of destruction. Direct SELECTs would need read access to all of them.
   `erasure_inventory()` is `SECURITY DEFINER` and returns **counts only** — the
   role learns a tenant has 412 messages and cannot read one.
2. **Clearing blocking rows** would need DELETE (and the SELECT a WHERE clause
   implies) on thirteen tenant tables. `erasure_clear_blocking()` does it with
   definer rights instead.

Both **bypass privileges, never the guard**: `SECURITY DEFINER` changes
`current_user`, not `session_user`, so certificate, org-match and hold checks
all still run. Final capability model — `organizations` SELECT+DELETE,
`legal_holds` SELECT, its own certificate, and `security_audit_log` **INSERT
only**. It can append to the record of what it did and cannot read it.

### Approval binds an inventory, and the binding self-invalidated

Approving writes an audit event into an org-scoped table, so the first approval
was **immediately `scope_changed`** — the binding invalidated itself the instant
it was created. The fingerprint now excludes the ledgers the governance process
writes to itself (`security_audit_log`, `erasure_certificates`). A system ledger
recording "an erasure was approved" is not tenant activity; counting it made the
control unusable rather than strict.

### The FK graph refuses before the guard ever runs

Seventeen `RESTRICT` / `NO ACTION` edges exist, thirteen org-scoped.
`user_alert_preferences → organizations` is `NO ACTION`, so a plain
`DELETE FROM organizations` fails with an **FK error before any WORM trigger
fires**. §8 anticipated the `finding_risk_acceptances` RESTRICT; it did not
anticipate that the blocking set is discovered rather than known. It is now
derived from the live graph, so a schema change that adds an edge is handled
without a code change.

### Two smaller findings worth not rediscovering

- **`SET SESSION AUTHORIZATION` survives `COMMIT`.** A pooled connection handed
  back stays `erasure_agent` for whoever picks it up next. The operator entry
  point must open its own connection from an erasure-specific DSN.
- **The certificate guard froze `dry_run` one notch too tightly.** Exactly one
  transition is now permitted — `TRUE → FALSE` on the `draft → approved` edge —
  because the **second person** should decide destructiveness. Fixed at request
  time it would have been the requester's choice, weakening the two-person rule.

### The ruling that reversed shipped behaviour

Increment 3 originally allowed an approval to survive its approver's
deprovisioning, recorded honestly at the time as *observed, not assumed*. The
operator ruled the other way on 2026-08-16, and the reasoning holds: a
two-person control whose second person has since been removed is a one-person
control with a historical footnote.

Requester **and** approver are now revalidated immediately before destruction,
via `erasure_actor_authorized()` — definer rights again, because the role holds
no privilege on `users`. Fails closed on a missing row, a non-active status, a
demoted role, a NULL actor, and a **mismatched organization** (an approver must
have been an admin *of the tenant being erased*).

### A defect that would have failed the first real erasure

`security_audit_log.actor_user_id` is `ON DELETE SET NULL` and its
`organization_id` is **nullable** — platform-level events legitimately carry no
organization. Erasing a tenant cascades its users, firing a SET NULL update on
platform-level rows naming them; the guard saw a NULL organization, could not
match it, and refused. **One such row made a tenant permanently un-erasable.**

Not an edge case: it is what happens the first time any platform-level event
records a tenant user as its actor. The exception is deliberately minimal —
UPDATE only, org-less rows only, `actor_user_id` going value→NULL only, and
every other column byte-identical (compared as JSONB with the actor removed, so
a future column cannot widen it). A row belonging to a **different** tenant
still refuses.

### CURRENT INVARIANTS — E2-11, E2-12, E2-13

These are **in force today**, alongside E2-1 … E2-10 in §12. They were not part
of the original design; each exists because building the increments disproved an
assumption §12 made. The superseded assumption is named against each so a reader
can see what changed and why, rather than finding two documents that disagree.

| # | Current invariant | Supersedes |
|---|---|---|
| **E2-11** | Requester **and** approver authorization is re-derived immediately before destruction. A deprovisioned, demoted, deleted or wrong-organization actor **voids the approval**, and recovery requires fresh authorization — no retry path skips it. | **Increment 3 as originally delivered**, which bound an approval to the SCOPE alone and let it survive its approver's deprovisioning. That behaviour was recorded at the time as *observed, not assumed*; the operator ruled the other way on 2026-08-16. |
| **E2-12** | The platform-row exception may **only** null an `actor_user_id` on a row with **no organization**. It can never delete a row, never alter any other column (compared as JSONB with the actor removed), and never touch a row belonging to another tenant. | **§7's fail-closed list and §12's guard conditions**, which assumed the org-match condition was total. They did not anticipate org-less platform rows, and as written would have made any tenant naming a user in one permanently un-erasable. |
| **E2-13** | Every read the erasure role performs against tenant data goes through a `SECURITY DEFINER` function returning **aggregates**. The role holds no readable privilege on any tenant table, and the definer functions bypass **privileges only** — `session_user` is unchanged, so the guard still adjudicates every row. | **§12's capability model**, which assumed the guard alone kept the role from reading data. Counting 112 tables for the TOCTOU re-inventory, and clearing 13 blocking tables, would each have required broad SELECT/DELETE and turned an erasure credential into a read credential. |

**E2-2 is amended, not replaced.** The gate remains a credential rather than a
session variable, but the check is on **`session_user`, not `current_user`**:
`SET ROLE erasure_agent` changes `current_user` and cannot satisfy the guard.
This makes the residual M-1 limitation narrower than §6 described.

**§6's evidence is withdrawn.** The probe reported there as
`app_request -> SET ROLE erasure_agent: ALLOWED` was invalid — the session was
superuser throughout, so it demonstrated nothing about escalation. The
conclusion §6 drew from it (that a session variable is not an authorization
boundary) still stands on the separate, valid `set_config` evidence.

### INCREMENT-4 STRUCTURAL FINDING — the rehearsal cannot precede the credential

**Recorded as a binding constraint on how Increment 4 must be sequenced.**

§10 called for a `[SEED]` staging rehearsal *before* production use, following
ADR-0005's own consequence list. Building Increment 3 showed that ordering is
**impossible by construction** for the destructive path:

- execution requires `session_user = 'erasure_agent'`;
- `SET ROLE` cannot produce that (E2-2 as amended);
- `SET SESSION AUTHORIZATION` requires **SUPERUSER**, which the application's
  database user is not;
- therefore the only way to execute a destructive erasure anywhere — including
  staging — is with an **issued credential**.

**Consequence for sequencing.** A destructive staging rehearsal cannot be a
prerequisite *to* credential issuance, because it inherently requires one.
Staging-only credential issuance and the rehearsal it enables are therefore the
**FIRST ACTIVITY OF INCREMENT 4**, not a gate that precedes it.

**Consequence for governance.** That activity needs its **own separate
authorization**: a staging-only credential, issued and revoked under the same
two-person control as an erasure itself, with revocation confirmed afterwards.
It is a governance decision, not an engineering one, and it must not be folded
into a general "proceed with Increment 4" approval — issuing a credential is the
single act that makes tenant erasure possible for the first time.

**What was rehearsed instead**, and is not claimed to be more than it is: the
complete lifecycle against disposable `[SEED]` tenants on a **throwaway
database** — `scripts/validation/e2-seed-erasure-rehearsal.ts`, 14 stages, 10
tenants, 9 negative paths, **PASSED**, with `erasure_agent` confirmed still
`NOLOGIN` at the end. No staging or production data was touched.

---

## Where E-2 stands

| Increment | State |
|---|---|
| 1 — one WORM policy | Delivered |
| 2 — role, certificate, guard exception | Delivered, inert |
| 3 — executor, TOCTOU, two-person, actor revalidation | Delivered, unreachable |
| 4 — credential issuance → first authorized erasure | **Not started, governance-gated** |

**E-2 TECHNICALLY READY for Increment 4.** The mechanism is complete and every
control is proven against real Postgres.

**E-2 NOT GOVERNANCE-AUTHORIZED for Increment 4.** Two gates, both operator-owned:

1. **Seven-year certificate retention is PENDING LEGAL/PRIVACY REVIEW.** It is
   not represented as approved anywhere in code or documentation, and production
   erasure must not be enabled until it resolves.
2. **Staging-credential authorization**, per the structural finding above.

These are separate gates on purpose. Engineering evidence and governance
authorization are not the same thing, and E-2 sits cleanly on one side of the
first and short of the second.
