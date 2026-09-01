# VA-S4 Step 2 — the bounded ADR-0012 evidence-lifecycle subset

**Package:** wiring-plan §7 step 2 (`docs/design/VA-S4-assurance-wiring-plan.md`)
**Authority:** ADR-0012 (RATIFIED 2026-08-22) + owner direction 2026-09-01
**Migrations:** `20261080`, `20261081`, `20261082`
**Status:** BUILT, DARK. Not deployed, not staging-verified, not promoted.

---

## 1. What was asked for, and what this is

The owner authorised Step 2 as one coherent evidence-lifecycle package covering
exactly seven things: `evidence.valid_from`, `evidence.valid_until`, the evidence
version chain, `evidence_links`, per-use confirmation, `evidence_lifecycle_events`,
and `evidence.assurance_class`.

Four standing constraints came with it, and each one changed the build rather
than decorating it:

1. **Preserve existing evidence history.** Nothing rewrites, normalises or
   deletes a historical row.
2. **Fabricate no historical validity, confirmation, link or lifecycle event for
   legacy evidence.**
3. **Fail closed where historical state cannot be known.**
4. **Do not make S4 live**, do not call `assuranceCoveredRequirementIds`, do not
   reduce questionnaire depth, do not change residual risk, do not promote to
   production, do not Blueprint sync.

All four hold. The package is dark schema plus a reviewed predicate with no
consumer.

## 2. Re-slotting: 20261051–55 are retired unused

ADR-0012's ruling authorised migrations **20261051–20261055** for T2-A and
reserved them in the freeze-window schema ledger. They were never consumed: the
package was gated behind the promotion and the held train, and the repository
migration floor advanced to **20261079** in the meantime (VA-S4-4C-4, applied on
staging 2026-08-31 23:17:17Z).

The migration runner is filename-keyed, so applying `20261051` today would in
fact have worked. It is still wrong: a file numbered below the applied floor
reads as though it shipped before work it actually follows, and a from-scratch
rebuild would order it before the reasoning it depends on.

**Owner direction, 2026-09-01: re-slot to the next sequential range and preserve
the original authorisation in the record.** The ADR's reservation stands as a
historical fact. `20261051–55` are hereby **RETIRED UNUSED** and must not be
claimed by anything else.

| ADR-0012 §4 reservation | Implemented slot |
|---|---|
| 20261051 — `evidence` validity + supersession columns | **20261080** |
| 20261052 — `evidence_links` | **20261081** |
| 20261053 — origin-link backfill | **NOT BUILT** (see §3) |
| 20261054 — `evidence_lifecycle_events` | **20261082** |
| 20261055 — `vendor_assurance_document` source_type value | **NOT IN SCOPE** (ADR §6.3, a separate decision) |

## 3. The backfill that is deliberately absent — and the ADR divergence it creates

ADR-0012 §2.1 specifies a backfill: one `link_kind='origin'` row per live
evidence row, copying `reviewed_*` into `confirmed_*`. §6.2 additionally
recommends that legacy NULL-validity rows **keep counting** behind a visible "no
expiry" badge.

**Neither was built.** Owner direction 2026-09-01 supersedes both: fabricate no
historical confirmations, and fail closed where history cannot be known.

This is a real divergence from a ratified ADR and is recorded as one rather than
absorbed silently. The reasoning:

- A `reviewed_at` on the artifact is not a per-context confirmation. Copying it
  into every context the artifact is used in manufactures a judgement nobody
  made — which is the exact thing per-use confirmation exists to prevent.
- `valid_until IS NULL` today means two incompatible things: "nobody established
  this artifact's validity" and "this artifact genuinely never expires". The ADR
  predicate reads both as valid. `validity_basis` (20261080) is the discriminator
  that makes them distinguishable, and the contract predicate counts only the
  second.

### The consequence, stated so nobody trips over it later

Every pre-existing evidence row lands with `validity_basis='not_established'`,
`assurance_class='unclassified'`, and **no link**. Under
`SQL_EVIDENCE_COUNTING`, the entire legacy estate counts for **nothing**.

That is the honest reading of an unknown history. It is also why:

- nothing in the application imports the contract module (a unit test asserts
  this and fails the build if someone wires it);
- `SECURELOGIC_EVIDENCE_LIFECYCLE_V2` is default-off and undeclared in IaC; and
- **a curation path for legacy evidence is OWED before that flag can ever be
  considered.** Flipping it against an unmigrated estate would silently drop
  every proof a customer already relies on.

## 4. What was built

### 20261080 — validity, supersession, assurance class

- `valid_from` / `valid_until` — what the **artifact asserts**, never
  `uploaded_at + N days`.
- `validity_basis` — `not_established` | `artifact_dates` | `perpetual`. An
  addition beyond the ADR's literal column list; §3 explains why it is load-
  bearing. **`policy_default` is deliberately absent**: durations are Step 3 and
  are not ratified, and shipping a value only a ratified policy could produce
  would imply a policy exists.
- `supersedes_evidence_id` — version chain, `ON DELETE RESTRICT`, partial UNIQUE
  for linearity, no self-supersession. Currency stays **derived at read**
  (`NOT EXISTS` a newer row); there is no `superseded_by` column to go stale.
- A trigger refuses a version chain that crosses an organisation boundary — RLS
  stops the read, but a foreign key is not org-aware.
- `assurance_class` — sixteen values mapping 1:1 onto the validity proposal's
  §3.1–3.12 classes, with `unclassified` as the fail-safe default that carries no
  validity. `soc2_type1` and `soc2_type2` are separate values (a Type I can never
  establish that a control *operated*); so are `privacy_agreement` and
  `subprocessor_list` (a DPA can be valid for years while its Annex is a year
  stale). `evidence_type` is untouched — it answers form, not assurance class.

### 20261081 — `evidence_links` and per-use confirmation

- Origin freezes on `evidence.source_type`/`source_id`; this table records **where
  it counts**. One artifact, one blob, one `evidence_analysis` row — N uses.
- A link counts only when a human confirmed **that link** in **that context**.
  Confirmation is all-or-none (timestamp + user + non-empty note) and **write-once**
  by trigger. `evidence_analysis` remains advisory input, never the confirmation.
- Append-and-detach: **no DELETE grant**, a **column-limited UPDATE** grant
  (confirm/detach columns only), and identity columns frozen by trigger. A link
  cannot be repointed after a decision relied on it.
- `target_type` is six **verified** consumer contexts. Widening later is a safe
  migration; shipping a value with no verified target is not.
- `target_requirement_id` expresses the engagement × requirement grain the
  effectiveness ladder already counts at (`idx_evidence_engagement_requirement`,
  20260927). This is beyond the ADR's column list: a link table that cannot
  address the platform's principal evidence grain would be unusable substrate.
  `ON DELETE RESTRICT`, because silently widening a requirement-scoped proof into
  an engagement-wide one would make evidence claim more than a human confirmed.
- Cross-org linking is refused by trigger, not only by RLS.

### 20261082 — `evidence_lifecycle_events`

- Append-only through the **shared** `worm_guard_mutation` (20261017), never a
  private copy. SELECT + INSERT only.
- `evidence_id` and `link_id` are held **by value with no FK**, the
  `security_audit_log` discipline: an event recording that an artifact was
  destroyed must not be destroyed with it, and stacking a second cascade-blocked
  WORM table behind `evidence` would repeat the condition that makes
  `DELETE FROM users` fail estate-wide through `finding_lifecycle_events`.
- `expiry_observed` is a **notice**, never a state change. Posture must not depend
  on whether a cron fired, and expiry never un-closes a closed finding (ADR-0009).

### `evidenceLifecycleContract.ts` — one definition of "counts"

```
el.detached_at IS NULL
AND el.confirmed_at IS NOT NULL
AND e.validity_basis <> 'not_established'
AND (e.validity_basis = 'perpetual' OR e.valid_until >= CURRENT_DATE)
```

The date test lives in the **predicate**, not only in a sweep worker, for the
same reason `SQL_ACCEPTANCE_BINDING` carries its own: an artifact that has run
out stops counting on the very next read, and posture must never depend on a
cron. **Supersession is deliberately absent** from the predicate — excluding a
superseded artifact here would auto-detach it by arithmetic, which ADR-0012 §2.4
forbids. `SQL_EVIDENCE_SUPERSEDED` surfaces the flag beside the count instead.

## 5. This package ships substrate with NO writer, and says so at birth

No route, no worker, no backfill writes any of it. Both new tables are empty by
construction.

This is declared rather than discovered, because the repository has been bitten
by the opposite omission: **VA-S4 Step 4 shipped an opinion vocabulary, a
coverage gate and an authority CHECK with no writer**, and the gap surfaced only
much later (`va-s4-opinion-acceptance-has-no-writer`). The governed writer —
link / confirm / detach / supersede, each durably audited, plus the legacy
curation path — is the **next** package.

**Known consequence the writer package must resolve first:** `evidence_links.evidence_id`
is `ON DELETE RESTRICT` (the ADR's ratified choice), so once a link exists the
`DELETE FROM evidence` on the vendor-portal path (`vendorPortal.ts`) is refused.
It cannot break while the table is empty. Converting that path to a **detach** is
a precondition of the writer, not an afterthought — deleting evidence somebody
relied on is precisely what ADR-0012's standing rule forbids.

## 6. Proof

| Suite | Result |
|---|---|
| `src/api/__tests__/evidenceLifecycleContract.test.ts` | **20/20** — vocabulary lockstep against the migration CHECKs, fail-closed predicate shape, flag darkness, and an assertion that **nothing imports the contract** |
| `test/isolation/evidenceLifecycle.test.ts` | **32/32** against a real Postgres |
| `test/isolation/wormGuardConsolidation.test.ts` + `appRequestGrants.test.ts` | **30/30** — the new WORM table resolves to the shared guard; the new tables carry grants |
| `src/api/__tests__/dataClassification.test.ts` | **20/20** — both new tables classified; org export covers them |
| `evidenceRls` / `evidenceFileUpload` / `evidenceAuthorityRepair` / `findingsEvidenceCount` / `findingClosureGateFlagOff` | **43/43** — nothing that worked yesterday changed |

The isolation suite proves the five claims this package makes, in the order it
makes them: nothing was fabricated; unknown history fails closed; history cannot
be rewritten; the tenant boundary holds against a connection RLS does not
constrain; and evidence with no link still deletes.

One proof is worth naming because it corrects a wrong first draft: the intended
"RLS WITH CHECK refuses a link stamped for another org" test **passed for the
wrong reason** — the same-org trigger fires before the RLS check, and the
trigger's own lookup is RLS-scoped, so an `app_request` session pinned to org A
can never reach the WITH CHECK. The test now records which layer answered and
proves the WITH CHECK policy structurally from `pg_policies`. This is the
fourth occurrence of the same class in this program: **a check that proves
something by observing a refusal must pin down WHY the refusal happened.**

## 7. What this package does NOT do

- **S4 is not wired.** `assuranceCoveredRequirementIds` is not called. Step 5
  still depends on step 1 (crosswalk content coverage), this step, and step 3.
- **No questionnaire depth changes. No residual risk changes.** The closure gate,
  the effectiveness ladder and posture read exactly the columns they read before.
- **Two of VA-S4-4C-4's three `NOT_EVALUABLE` vetoes are not yet resolved by
  this package alone.** `contradictory_evidence` now has a substrate
  (`evidence_links`) but no population, and `report_period` still has **no
  ratified validity policy** — that is Step 3.
- **#966 and #967 remain open and separate.** Neither was folded in.
- Nothing is deployed, staging-verified, promoted, or Blueprint-synced.

## 8. What must come next, in order

1. **Step 3 ratification** — `docs/design/VA-EVIDENCE-validity-policy-RATIFICATION-MEMO.md`.
   Owner decisions only; no durations exist in code until they are approved.
2. **The governed writer + legacy curation path**, including converting the
   vendor-portal evidence DELETE to a detach.
3. **Dual-read divergence proof** (ADR-0012 §5) before the flag is even
   considered, and flag-off byte-identical (trivially true today: nothing reads
   the predicate).
4. Only then: staging acceptance on the merged SHA, and the Step 5 gate re-run.

## Related

- `docs/architecture/decisions/ADR-0012-shared-evidence-lifecycle.md`
- `docs/design/VA-EVIDENCE-validity-policy-proposal.md` (Step 3 input)
- `docs/design/VA-S4-assurance-wiring-plan.md` §7
- `docs/validation/VA-S4-4C-4-sufficiency-determination-2026-09-01.md` §8
