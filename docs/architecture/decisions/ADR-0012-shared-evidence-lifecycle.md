# ADR-0012 — The shared evidence lifecycle: origin + links, confirm-per-context, validity-in-predicate

- **Status: RATIFIED — as recommended** (operator ruling, 2026-08-22, same
  day as proposal). The ruling, as given:

  > ADR-0012 is ratified as recommended, including the clarification that
  > consequential governance decisions snapshot their relied-upon
  > evidence-link set — IDs plus sha256 — in the decision-time audit payload.
  > Migrations 20261051–55 are **authorized** for T2-A, subject to the
  > established schema-slot and release-boundary rules. Preserved as a
  > standing rule: **evidence history is immutable — correction occurs
  > through supersession/new records, never destructive mutation of
  > historical evidence relied upon by prior decisions.** T2-A implementation
  > remains gated behind the promotion and the held-train/schema-slot
  > sequence.

  The five §6 decisions are therefore ruled per their recommendations:
  (1) strict gate = separate opt-in, default byte-identical to today;
  (2) `valid_until` required at confirmation, route-enforced, legacy badged;
  (3) the Spine B directional pointer is ratified (20261055 authorized with
  the package); (4) reuse open across all target types, per-context
  confirmation as the control; (5) `attested` remains out of T2-A scope.

  **Ratified clarification (decision-basis snapshot):** every consequential
  governance decision (finding closure, engagement decision, acceptance/
  exception approval, AI use approval) snapshots the set of evidence links it
  relied upon — link ids plus artifact `sha256` — in its decision-time audit
  payload, the `gap_basis` pattern applied to decision-time evidence. Zero
  schema cost; reconstruction of "what we relied on at that moment" becomes a
  read, not a replay.
- **Decision owner:** the product owner (ADR-0009 convention). §6 items are
  product-model positions, not technical preferences.
- **Applies to:** `evidence`, `evidence_analysis`, the finding closure gate
  (`risk_settings.require_evidence_gate`, `findingLifecycleMachine.ts`,
  `findingClosurePolicy.ts`), the engagement effectiveness ladder
  (`controlEffectiveness.ts`), posture, and — behind §6.3 —
  `vendor_assurance_documents`.
- **Related:** ADR-0010 (RATIFIED — Option 4; this ADR implements its
  evidence-availability consequence without reopening it), ADR-0009
  (recurrence does not reopen), ADR-0004 (finding→risk promotion).
- **Blocks / unblocks:** T2-A (evidence lifecycle), which the Capability Audit
  Phase 2 roadmap identifies as the highest-leverage T2 package (four
  verticals inherit it: Findings closure, Vendor engagements, AI governance
  assessments, Policy/control attestations).

---

## 1. The problem

The platform has one polymorphic `evidence` table (13 `source_type` values)
already gating finding closure and feeding the engagement effectiveness
ladder — but **no lifecycle**: no validity or expiry, no versioning or
supersession, no reuse (one row belongs to at most one engagement and one
requirement; re-attaching means re-uploading — second row, second blob,
second LLM analysis, second review, quota charged twice; `sha256` is stored
and never queried). Consequence: **historical evidence silently remains proof
of a current control forever**, which is the governance failure T2-A exists to
prevent — the exact analogue of the "an acceptance with no expiry is a
permanent pardon" rule already enforced by DB CHECK on
`finding_risk_acceptances`.

## 2. The model

Four moves, each an existing house pattern — no new governance machinery.

### 2.1 Origin is immutable provenance; use is a link

`evidence.source_type`/`source_id` freezes as **where the artifact came from**
(the `20260928` pointer-type rule). A new append-only **`evidence_links`**
table records **where it counts**:

```
evidence_links(
  id, organization_id NOT NULL,
  evidence_id NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  target_type TEXT NOT NULL CHECK (consumer contexts only),
  target_id UUID NOT NULL,            -- polymorphic, no FK (accepted; §7.3)
  link_kind TEXT CHECK ('origin','reuse'),
  linked_at, linked_by_user_id,
  confirmed_at, confirmed_by_user_id, confirmation_note,   -- all-or-none
  detached_at, detached_by_user_id, detach_reason
)
```

Partial UNIQUE on live links `(org, evidence_id, target_type, target_id)
WHERE detached_at IS NULL`. Grants: SELECT, INSERT, column-limited UPDATE
(confirm/detach columns only), **no DELETE**. Immutability trigger on the
identity columns; confirmation write-once. RLS NULLIF-GUC, NOT FORCE. One
artifact, one blob, one `evidence_analysis` row — N uses.

Backfill: one `link_kind='origin'` row per live evidence row, copying
`reviewed_*` → `confirmed_*`, marked as migrated in the audit payload.

### 2.2 Validity lives on the artifact; confirmation lives on the use

- `evidence.valid_from` / `valid_until` — the artifact's intrinsic coverage
  window (a SOC 2 covers a period regardless of where it is used). Machine
  extraction may pre-fill; a human commits.
- A link **counts** only when a human confirmed *that link* in *that context*
  (`evidence_analysis` verdict shown as advisory input at confirmation time —
  the ladder's existing stance). Attaching never counts by itself.
- **Reuse across engagements/assessments is therefore legitimate** — under
  per-context human confirmation plus artifact validity. Confirmation made in
  one context never leaks into another (machines-observe-humans-decide: a
  machine-created link must not promote an engagement to `evidenced` on
  someone else's judgment).

### 2.3 Counting is an in-predicate time test

`SQL_EVIDENCE_COUNTING` (contract module, sibling of
`SQL_ACCEPTANCE_BINDING`):

```
link live ∧ link confirmed ∧ artifact not detached
         ∧ (valid_until IS NULL OR valid_until >= CURRENT_DATE)
```

used verbatim everywhere evidence counts (closure gate, effectiveness ladder,
posture). A sweep worker (sibling of `riskAcceptanceExpiryWorker`) only
notifies and audits newly-expired artifacts with live confirmed links — **it
flips nothing**; posture must not depend on whether a cron fired.

- Expiry **stops the artifact counting for current posture immediately at
  read** — an engagement degrades `evidenced → documented → asserted` and
  residual risk moves. Historical evidence never silently proves a current
  control.
- Expiry **never un-closes a closed finding** (ADR-0009 asymmetry: closure is
  a human decision already taken; machines never reverse it). Post-closure
  expiry surfaces as a posture signal only.

### 2.4 Versioning is a new row; "current" is derived at read

A renewed artifact = new `evidence` row + `supersedes_evidence_id` (FK self;
partial UNIQUE enforces linear chains). No stamped `superseded_by` — currency
is `NOT EXISTS (newer row)`, derived at read (fifth domain on that pattern).
Open links to a superseded version are **never auto-detached**; every counting
surface names "newer version exists"; a human relinks (new link + detach with
`detach_reason='superseded'`). Old row, old link, old confirmation all remain
— history is never destroyed.

## 3. Spine B availability — the ADR-0010 compliance statement

A human explicitly **promotes a document to evidence**: new `evidence` row,
`source_type='vendor_assurance_document'` (14th CHECK value, held in its own
migration behind §6.3), `source_id = document_id`, file sextet NULL (content
stays in the Spine B store — no blob copy, no fold-in), and
`valid_from`/`valid_until` **snapshotted at promotion** from the extraction's
span-backed `report_period_start`/`report_period_end` (the `gap_basis`
snapshot pattern — a re-extraction can never silently move a validity window
a human confirmed).

Per ADR-0010's enforcement rule, stated explicitly: this is a **directional
pointer** — evidence may originate *from* a document; documents never learn
about engagements; no `engagement_id` is added to
`vendor_assurance_documents`. It implements no ADR-0010 option and reopens
none; Option 2 remains a separate future decision.

## 4. Schema reservation

Migration numbers **20261051–20261055 are reserved for T2-A and not consumed
until this ADR is ratified** (coordinate in the freeze-window schema ledger):

| # | Content | Size |
|---|---|---|
| 20261051 | `evidence` validity + supersession columns, CHECKs, indexes | S |
| 20261052 | `evidence_links` (RLS, grants, triggers, indexes) | M |
| 20261053 | origin-link backfill | S/M |
| 20261054 | `evidence_lifecycle_events` (append-only, SELECT+INSERT) | S |
| 20261055 | `vendor_assurance_document` source_type value — **held behind §6.3** | S |

No change to `findings`, `vendor_assurance_documents`, or
`vendor_engagements`.

## 5. Rollout

Schema dark → backfill + dual-write → dark dual-read logging divergence
(must be zero) → predicate flip behind `evidence_lifecycle_v2`
(default off; off = byte-identical, test-asserted like
`riskAcceptanceFlagOff.test.ts`) → UI (evidence library, reuse picker,
per-context confirmation, version chain, expiry badges) → §6.3-gated Spine B
promotion last. Post-promotion, post-Sept-15 work; the 2026-08-29 schema
cutoff does not bind. T2-A takes the one-schema-package-in-flight slot after
the held train (#865/#869) merges.

## 6. Decisions required to ratify (with recommendations)

1. **Gate strictness** — when `require_evidence_gate` is on, is a *confirmed,
   in-validity* link required, or today's mere-EXISTS?
   **Recommend:** new opt-in knob; default preserves today byte-identically.
2. **Is `valid_until` required at confirmation** (the acceptance-CHECK
   analogue) or optional?
   **Recommend:** required for new confirmations; legacy NULL-validity rows
   keep counting but render a visible "no expiry" badge.
3. **The Spine B directional pointer** (§3) — ratify or defer?
   **Recommend:** ratify; it is the only bridge that respects ADR-0010.
4. **Cross-vertical reuse scope at launch** — open to all target types, or a
   restricted matrix?
   **Recommend:** open; per-context confirmation is the control, a matrix can
   tighten later.
5. **Does `attested` (1.0, currently unreachable) enter scope?**
   **Recommend:** no — out of T2-A.

## 7. Risks accepted consciously

1. **Dual truth**: origin columns and origin links both encode attachment; a
   future consumer querying only `source_type/source_id` misses reuse.
   Mitigation: the contract module is the only sanctioned counting predicate,
   plus a CI grep for raw `FROM evidence` in counting paths. The
   `vendor_review` source_id defect proves write-side discipline decays —
   assume this will be violated eventually and make it detectable.
2. **Gate semantics are a landmine**: today unreviewed evidence closes
   findings; tightening is a separate knob (§6.1), never smuggled in.
3. **Polymorphic `target_id` has no FK** — same orphan tradeoff as
   `findings.source_id`; route-level target verification is the guard.
4. **Legacy rows are permanent proofs** until humans curate them; the badge
   makes that visible, it does not make it stop.
5. **Hot-path cost**: the gate and ladder gain a join + date predicate;
   partial indexes cover it, but the per-requirement ladder loader in
   `vendorEngagements.ts` needs a look before the flag flips.

## 8. Definition of Done for T2-A (summary)

FINAL_PRODUCT_STANDARD in full, plus: zero-divergence dual-read proof before
flip; flag-off byte-identical (test-asserted); the reuse, versioning, and
expiry journeys complete in the product UI with no SQL/API intervention;
cross-org negative proofs + dataClassification entries for the new tables;
every link/confirm/detach/supersede durably audited; posture provably correct
with the sweep worker stopped; dashboard evidence rollups covering all
source_types (repairing the current 5-of-13 omission); SR runbook; proven on
staging. Expired evidence demonstrably does NOT reopen any closed finding.
