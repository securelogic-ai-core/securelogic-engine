# ADR-0004 — Finding→Risk promotion via approved acceptances, and the unified-approval standing rule

- **Status:** PROPOSED (2026-07-28). Awaiting Simmee ruling. No implementation is
  authorized by this document; build is tracked as issue **#694** and begins only
  after acceptance.
- **Date:** 2026-07-28
- **Source:** Enterprise Architecture Review + Decision Review (2026-07-28), DS-9 and
  DS-14 (both delivered in-session; register of record in BUILD_SEQUENCE.md Active-package
  reality-sync note).
- **Decision requested:** (A) adopt decision-triggered Finding→Risk promotion; (B) adopt
  the standing rule that any NEW approval-bearing capability uses one polymorphic
  approval shape. (B) must be ratified before (A)'s design memo is written.

---

## Context

Every post-launch platform seam converges on `findings`; nothing converges on `risks`.
- `finding_risk_acceptances.promoted_risk_id` is an explicit forward hook with **zero
  writers** (`20260907_finding_risk_acceptances.sql:99-101` calls promotion "an
  architectural commitment, not built here"; grep confirms no writer).
- The only findings↔risks join is the reverse direction (risk → generated finding,
  `risks.ts:788-791`). `risks.source_type` is unconstrained free text (`20260421:33`).
- The 9-state risk lifecycle machine (`riskLifecycleStateMachine.ts`) is fully built,
  dark in every environment, with **no automated inbound edge**.
- Consequence: an approved risk acceptance closes operational work and files a WORM
  governance record — and the enduring exposure reaches the Enterprise Risk Register
  only if a human retypes it.

Separately, three parallel approval implementations exist — `risk_approvals` (subject
hardwired: `risk_id NOT NULL`), `finding_risk_acceptances`, `orchestration_proposals` —
with three SoD encodings and three state vocabularies, plus a fourth SoD variant in
finding-closure. The acceptance migration exists *because* `risk_approvals` could not
take a polymorphic subject (`20260907:16-19`). Without a standing rule, promotion adds
a fourth shape.

## Decision (proposed)

**A. Promotion.** An acceptance reaching `approved` creates-or-links a register risk via
`promoted_risk_id`. Design memo (ERIP convention) settles: dedup semantics
(re-accepted findings; expiring→re-approved; N findings→1 risk), owner assignment,
`lifecycle_state` seed (per the DS-8 approver ruling), and a CHECK on
`risks.source_type` including `finding_promotion`. Exclusions: `legacy_unverified`
acceptances never auto-promote (they are flagged for human completion). Rejected
alternatives: manual-only promotion (coverage depends on discipline; register stays
partially trusted) and severity-threshold auto-creation (floods the register ahead of
human decisions; violates the spirit of ERG R3 — the system derives, humans decide).

**B. Standing rule.** Any *new* approval-bearing capability uses a polymorphic
`approvals(subject_type, subject_id)` shape with one SoD encoding and a state
vocabulary aligned to Contract 5 (per-subject terminal extensions allowed, e.g.
orchestration's `executed`). The existing three implementations are NOT migrated now;
consolidation is a future package whose memo should plan read-side federation over the
WORM acceptance rows rather than row migration. Promotion (A) is the rule's first test:
it reuses the acceptance approval — it does not mint a new shape.

## Consequences

- The register becomes trustworthy: every governed acceptance lands there, auditable
  end-to-end (SoD at both the acceptance and, once DS-8 is ruled, the lifecycle).
- Risk Lifecycle enablement (issue #694 step 4) gains its automated inbound edge.
- Approval-shape drift stops at three.
- ALIGNS: two-axis finding model, Contract 5, ERG R3, AD-9 (the applicability engine
  still never writes risks — promotion is triggered by a *human* governance act).
- EXTENDS: `risks.source_type` gains its first CHECK (previously free text).
- CONFLICTS: none identified against ratified rulings.
