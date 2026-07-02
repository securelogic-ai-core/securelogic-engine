# Risk Lifecycle — Engineering Specification

**Status:** Draft for operator (Simmee) review. Not yet authorized for build.
**Author:** Platform architecture pass, 2026-07-02.
**Scope of this document:** the complete engineering blueprint for a formal, gated
risk-management lifecycle on the SecureLogic risk register. This spec is the
authority for all subsequent `R1`–`R4` build prompts. No feature code ships from
this session; this is a specification only.

**Governing constraint (non-negotiable):** every design element here is
**additive-only** relative to launch-critical behavior. Nothing in this spec may
change the behavior of an existing risk route when the feature flag is off. The
new lifecycle is dark by default (`SECURELOGIC_RISK_LIFECYCLE_ENABLED` unset → the
platform behaves exactly as it does today).

---

## Part 1 findings summary (verified current state)

Everything below is grounded in the code as it exists on
`docs/gate5-migration-reconcile-20260712`. Citations are `file:line`.

### 1.1 Risk domain model — what exists

| Object | Table / file | Key facts | Evidence |
|---|---|---|---|
| Risk | `risks` (`db/migrations/20260421_risk_register_primitives.sql`) | `status` enum `open/accepted/mitigated/closed/transferred`; `owner` TEXT + `owner_user_id` FK; inherent+residual `likelihood/impact/rating`; `inherent_score`/`residual_score` INTEGER 0–100 + `score_basis` JSONB; cadence (`last_reviewed_at`,`next_review_due`,`review_cadence_days`); `source_type`/`source_id` free-form provenance; `exposure_flagged`/`exposure_signal_id`. | `20260506_risk_inherent_residual.sql`, `20260607_risk_review_cadence.sql`, `20260604_risk_owner_user_id_fk.sql`, `20260706_risk_numeric_score.sql` |
| Risk routes | `src/api/routes/risks.ts` | `POST /api/risks` (`:239`), `GET /api/risks` (`:445`), `GET /api/risks/summary` (`:555`), `GET /api/risks/intelligence` (`:724`), `GET /api/risks/:id` (`:811`), `GET /api/risks/:id/history` (`:889`), `POST /api/risks/:id/review` (`:1052`), `PATCH /api/risks/:id` (`:1243`). `RISK_SELECT` at `:157-191` (computes `is_overdue` at `:185-188`). | `src/api/routes/risks.ts` |
| **Status is NOT transition-gated** | `src/api/lib/riskValidation.ts:70-76` | `risks.status` is only enum-validated; **any status → any status via PATCH**. No state machine on the risk itself. This is the single biggest gap this spec closes. | `risks.ts:597-608` |
| Treatments | `risk_treatments` (`20260426_risk_treatment_workflow.sql`) | `status` `not_started → in_progress → mitigated\|accepted\|transferred` (terminal). `treatment_type` `mitigate/accept/transfer/avoid`. `owner_user_id` FK (proposer). `reviewer_id` TEXT (legacy, deprecated) **and** `reviewer_uuid` UUID FK → users (intended approver, added `20260503_reviewer_id_uuid_fk.sql`). | `riskTreatments.ts`, `riskTreatmentValidation.ts:25-35` |
| Treatment workflow **is** gated | `src/api/routes/riskTreatments.ts` | Terminal guard → 409 `workflow_terminal` (`:494`); illegal transition → 422 `invalid_transition` (`:504`). On terminal, atomically writes `risks.status = treatment.status` (`:594-620`) bypassing risk-side validation; maps `mitigated/accepted/transferred` (never `closed`). | `riskTreatments.ts` |
| **`reviewer_uuid` is dormant** | `riskTreatments.ts:194,568-569` | Route code still reads/writes legacy `reviewer_id` (TEXT); the intended approver FK `reviewer_uuid` is **not written by any route**. Neither is wired to an enforced approval step. Approval today = writing a nullable field, not a gate. | `20260604_risk_owner_user_id_fk.sql:17-19,47` |
| Scoring | `src/api/lib/riskScore.ts` | `computeRiskScore(likelihood,impact,axis)` → `{score,basis}` or null (`:94-114`); weights `:31,:44`; `scoreBand` Critical≥75/High≥50/Moderate≥25/Low<25 (`:120`); `RiskScoreBasis` versioned envelope `method:"likelihood_impact_v1"` (`:72-77`). **`residual_rating` (analyst-set) is authoritative; `residual_score` only orders within a band** (ratified: `docs/scoring-vocabulary.md:31`). | `riskScore.ts` |
| Cadence | `src/api/lib/riskCadence.ts` | `resolveCadenceDays` order: per-risk → org policy → default (Crit 30/High 60/Mod 90/Low 180, `:24`) → fallback 90 (`:32`). | `riskCadence.ts:45` |
| Links | `riskControlLinks.ts`, `riskObligationLinks.ts` | `POST/DELETE/GET /api/risks/:id/controls` (`:487-517`), same for `/obligations`; soft-delete (`deleted_at`); RLS already enabled (`20260701_*_rls.sql`). | — |
| Audit trail | `security_audit_log` via `writeAuditEvent()` (`src/api/lib/auditLog.ts:54`) | **RR-3 shipped as a projection, not a dedicated stream.** No `risk_lifecycle_events`/`risk_history` table. Events: `risk.created` (`risks.ts:393`), `risk.updated` w/ field diffs (`:1441-1449`), `risk.reviewed` (`:1193`), `risk_treatment.created`, `workflow.status_transition`, `risk.terminal_status` (`riskTreatments.ts:661,684-699`). `GET /api/risks/:id/history` (`:889`) reconstructs a timeline across four resource types (`:959-976`). **Weakness:** audit writes are fire-and-forget, called AFTER `COMMIT`, not awaited — a failed audit insert loses the event silently. | `auditLog.ts` |
| Risk creation from finding/signal | — | **Does not exist.** Only `INSERT INTO risks` is `POST /api/risks` (`risks.ts:316`). Signals only `UPDATE risks SET exposure_flagged=TRUE … WHERE status='open'` (`cyberSignalProcessingService.ts:809-823`); `source_type`/`source_id` are unverified free-form. | — |

### 1.2 Evidence objects

- Table `evidence` (`20260420_evidence_primitives.sql`): polymorphic `(source_type, source_id)` on the row itself — **no join table**. `evidence_type` ∈ document/screenshot/log/test_result/interview/observation/policy/other.
- `source_type` DB CHECK (7 values, `20260427_evidence_linkage_workflow.sql:22-30`): `control_test, vendor_review, ai_review, obligation_review, dependency_review, risk_treatment, finding`. **`risk` is NOT a value** — evidence can attach to a risk *only via `risk_treatment`* (or via a `finding` that points at the risk), never to the risk directly (`evidence.ts:49-59`).
- **Metadata-only, write-once.** No file/blob storage (`evidence.ts:17-19`), only a free-text `external_ref`. No `PATCH`, no `DELETE`, no detach (`evidence.ts:7-9`).
- Endpoints (`src/api/routes/evidence.ts`): `POST /api/evidence` (`:164`), `GET /api/evidence?source_type=&source_id=` (both required, `:285`), `GET /api/evidence/:id` (`:345`), `GET /api/evidence/summary` (`:119`).
- Latent drift: `evidenceValidation.ts:14-23` lists `ai_governance_review` (not in DB CHECK) and omits `policy_review` (in route map) — a create with `ai_governance_review` passes validation then fails the DB CHECK (500).

### 1.3 Risk → action generator

- `runMatcherForSignal` (`cyberSignalProcessingService.ts` step 5) flags exposure on open risks (unconditional `UPDATE`), then — gated by `SECURELOGIC_ACTION_ENGINE_ENABLED` (`actionRecommendationEngine.ts:57-61`, currently `true` in committed `render.yaml`) — inserts one `auto_risk_exposure` action per newly flagged risk with `ON CONFLICT (organization_id, source_type, source_id) WHERE action_type='auto_risk_exposure' DO NOTHING`.
- Dedup: partial unique index `idx_actions_generated_risk` (`20260627_actions_generated_risk_dedup.sql`).
- `buildRiskActionDraft` (`actionRecommendationEngine.ts:114-125`): flat `near_term` priority, no severity threshold.
- **One-directional.** `actions.ts` never writes back to `risks` — closing an action does not change risk status or clear `exposure_flagged`; `exposure_flagged` has no reset path.

### 1.4 Roles / permissions / auth

- Roles live on `users.role` (no `org_members` table; membership = `users.organization_id`). Vocab is inconsistent: DB default `member` (`001_securelogic_platform.sql:17`), invite default `analyst` (`20260520_multi_user_team.sql:43`), route code checks `admin`/`analyst`/`viewer`. **No `owner` or `approver` role.**
- `src/api/middleware/requireRole.ts`: `requireRole(...)`, `requireAdminRole`, `requireNotViewer`. **Critical:** role is read from `req.userRole`/`jwtPayload.role`; **API-key requests have no role → all role guards no-op for API keys** (`requireRole.ts:9-29`).
- Auth (`src/api/middleware/requireApiKey.ts`): JWT path sets `req.userId=payload.sub`, `req.userRole` (`:136-140`); **direct API-key path sets only `req.apiKey`, no user identity** (`:230`). Audit records `actorUserId: req.userId ?? null` → `null` for API keys. **API-key approvals cannot be attributed to a human.**
- Route chain for all data routes: `requireApiKey → attachOrganizationContext → requireEntitlement("premium") → asTenant(...)` (`routes/index.ts:447-450`).
- **SoD today:** the data supports it (`risk_treatments.owner_user_id` = proposer, `reviewer_uuid` = approver, same-org enforced via `resolveOwnerUserSameOrg`), but **nothing enforces it** — no `owner ≠ reviewer` constraint, no approval state, no approver role, no actor capture on the API-key path.

### 1.5 Entitlements & flags

- `requireEntitlement(min)` (`src/api/middleware/requireEntitlement.ts`): ranks `starter=1`, `standard/professional=2`, `premium=4`. **`platform`/`team`/`premium` all normalize to `premium` (rank 4)** — the request path **cannot distinguish Platform from Team**. A true "Platform-only" gate is not expressible with the current middleware.
- The entire `risks` route family is `premium`-gated (Bucket A, `docs/entitlement-alignment-audit.md:19-28`). The lifecycle inherits this: **gate `premium` (rank 4)**, consistent with every other risk feature.
- Flag convention: one small module per flag reading `env["SECURELOGIC_<NAME>_ENABLED"] === "true"`, **off by default**, injectable `env` for tests (`legacyNewsletterFeatureFlag.ts:33-37`). Declared explicitly per service in `render.yaml` with a literal `value`. The "404 when off" middleware pattern is established (vendor assurance).
- Migrations: `YYYYMMDD_snake_case.sql` in `db/migrations/`, applied in lexical order (`scripts/runMigrations.ts:66-69`), one tx each, recorded in `schema_migrations`.
- RLS scaffolding ("inert but present"): `ENABLE ROW LEVEL SECURITY` + one `*_tenant_isolation` policy on `app.current_org_id`, `NOT FORCE` so the owner bypasses until the operator repoints `DATABASE_URL` to `app_request` (`20260703_risk_treatments_rls.sql:17-23`).

### 1.6 Existing risk UI

- Pages under `app/src/app/risks/`: list (`page.tsx`), `new/`, `import/`, `[id]/` detail (`RiskDetailClient.tsx`), `[id]/edit/`, `[id]/treatments/new/`, `[id]/treatments/[tid]/` (`TreatmentDetailClient.tsx` — status-gated transition buttons + inline confirm modal), plus `settings/risk-policy/`, `settings/risk-scale/`.
- Detail page sections: header pills, description, metadata grid, inherent/residual rating grid, treatment prose, active treatments, mitigating controls (`LinkedControlsSection`), affected obligations (`LinkedObligationsSection`), review cadence (`ReviewCadenceCard`), **history** (`RiskHistorySection` — the RR-3 timeline), linked findings.
- API client: `app/src/lib/api.ts` (`engineFetch`, `ENGINE_URL` env), plus Next.js proxy routes under `app/src/app/api/risks/[id]/*` that re-inject the JWT.
- **Strongest pending-approvals pattern to mirror:** the **matcher queue** (`app/src/app/queue/page.tsx` + `components/queue/SuggestionList.tsx` accept/dismiss with 5s undo + `Notice`/`useTimedNotice`).
- **No shared `ui/` primitives library** — pills/badges/tiles are copy-pasted; the one shared helper is `app/src/lib/auditLogUtils.ts`. Risk pages have **entitlement gating only, no per-role gating** today (`isPlatformUser` check; `me.role` admin/member exists only in team management).

### 1.7 Gap list per target stage

| Target stage | Exists today? | Gap |
|---|---|---|
| Identified / Created | Manual `POST /api/risks` only | No lifecycle state; risk is "born" at `status=open`. Net-new: `lifecycle_state`. |
| Owner Assigned | `owner_user_id` column | Not a gate — a risk can advance with no owner. Net-new: gate. |
| Evidence Collected | Evidence via treatment/finding only | Cannot attach evidence to a risk directly; not a gate. Net-new: `risk` source_type + gate. |
| Scored | `residual_score`/`residual_rating` computed on write | Not a gate; dormant (PR #382 not promoted). Net-new: gate. |
| Treatment Selected | `risk_treatments` workflow | Exists, but not tied to a risk-level state or an approval. |
| Executive Approval | `reviewer_uuid` (dormant) | **Entirely absent as a workflow.** Net-new: approvals table + state + SoD + roles. |
| Mitigation Started | Treatment `in_progress` | No risk-level state; not gated on approval. Net-new. |
| Validation | — | Absent. Net-new state + fail loop-back. |
| Residual Review | Review cadence exists | Cadence ≠ residual re-score gate. Net-new state. |
| Closed | `status=closed` | Reachable, but not gated and not transactionally audited. |
| Archived | — | Absent. Net-new terminal state + hidden-from-default-views semantics. |
| Audit of every transition | `security_audit_log` projection | Fire-and-forget, post-COMMIT, no dedicated stream. Net-new: transactional `risk_lifecycle_events`. |

**Relationship to the RR roadmap** (`docs/RISK_REGISTER_ROADMAP.md`): this spec **realizes and supersedes RR-3** (per-risk audit trail → dedicated transactional event stream) and **RR-8** (risk acceptance workflow → generalized approval gate; RR-8's proposed columns `acceptance_rationale`/`acceptance_approver_user_id`/`acceptance_expires_at` are absorbed into `risk_approvals`). It builds on the shipped RR-2 (owner FK), RR-4/RR-6 (links), RR-5 (cadence), and RR-11 (numeric score). There is **no active or conflicting risk-lifecycle package** in `BUILD_SEQUENCE.md`, and **no prior `SECURELOGIC_RISK_LIFECYCLE` flag or SoD decision** exists — those are greenfield.

---

## 2. Section 1 — Overview & personas

### 2.1 Purpose

Today a risk can move from any status to any other with a single `PATCH`, with no
gates, no approval, and only a best-effort audit projection. That is acceptable
for a lightweight register but not for a GRC platform whose value proposition is
defensible risk governance. This feature introduces a **formal, gated lifecycle**
so that:

- a risk cannot be treated before it has an owner, evidence, and a score;
- a treatment plan cannot start mitigation without executive approval;
- approval enforces **separation of duties** (the person who proposes a treatment
  cannot approve it);
- validation failure and approval rejection are first-class loop-backs, not silent
  status edits;
- **every** state change is captured in an append-only, transactional event stream
  suitable for audit export.

### 2.2 The target lifecycle (12 customer-facing stages)

`Identified → Created → Owner Assigned → Evidence Collected → Scored →
Treatment Selected → Executive Approval → Mitigation Started → Validation →
Residual Review → Closed → Archived`

These 12 stages are the **customer-facing journey** rendered in the UI. They map
onto a **smaller set of persisted states** plus **gate conditions** (Section 3),
because "Owner Assigned", "Evidence Collected", and "Scored" are milestones within
the assessment phase, not distinct workflow states.

### 2.3 Personas

| Persona | Maps to (current role) | Acts at stages | Capabilities |
|---|---|---|---|
| **Risk analyst** | `analyst` / `member` (non-viewer) | Identified → Scored, Treatment Selected, Mitigation, Validation, Residual Review | Create risk, assign owner, attach evidence, score, propose treatment, request approval, execute non-approval transitions, record validation, re-score. **Cannot approve.** |
| **Risk owner** | `analyst`/`member` (a specific `owner_user_id`) | Owner Assigned onward for their risks | Same as analyst, scoped to owned risks; the accountable party. May be the proposer. |
| **Executive approver** | `admin` initially, or a designated approver (Section 7) | Executive Approval | Approve / reject a treatment plan (or risk acceptance). **Must differ from the proposer (SoD).** Requires a JWT/user session (not API key). |
| **Auditor / read-only** | `viewer` | All (read) | Read the lifecycle panel, the append-only event stream, approvals, evidence, and exports. No mutations (`requireNotViewer` blocks writes). |

---

## 3. Section 2 — State machine

### 3.1 Persisted states

The authoritative persisted field is a **net-new** column
`risks.lifecycle_state` (Section 6). Legacy `risks.status` is **retained and kept
derived** for backward compatibility (posture scoring reads `status`). The nine
persisted states:

| State | Meaning | Terminal? |
|---|---|---|
| `draft` | Risk identified & created; assessment not complete | no |
| `scoping` | Under assessment — owner, evidence, and score are being established | no |
| `treatment_selection` | Score complete; a treatment plan is being proposed | no |
| `pending_approval` | A treatment plan (or acceptance) is awaiting executive approval | no |
| `mitigation` | Approved; remediation in progress | no |
| `validation` | Remediation complete; effectiveness being validated | no |
| `residual_review` | Validated; residual risk being re-scored/reviewed | no |
| `closed` | Lifecycle complete | **terminal** (reopen allowed) |
| `archived` | Retired from active management | **terminal** (hidden; un-archive allowed) |

### 3.2 12-stage → persisted-state mapping

The UI renders 12 milestones; several are **gate flags within a single state**:

| # | Display stage | Persisted state | Distinguisher |
|---|---|---|---|
| 1 | Identified | `draft` | risk row exists |
| 2 | Created | `draft` | (always true in `draft`) |
| 3 | Owner Assigned | `scoping` | gate: `owner_user_id IS NOT NULL` |
| 4 | Evidence Collected | `scoping` | gate: ≥1 evidence linked to the risk or its treatments |
| 5 | Scored | `scoping` | gate: `residual_rating` (and `residual_score`) present |
| 6 | Treatment Selected | `treatment_selection` | ≥1 active `risk_treatment` |
| 7 | Executive Approval | `pending_approval` | open `risk_approvals` row |
| 8 | Mitigation Started | `mitigation` | — |
| 9 | Validation | `validation` | — |
| 10 | Residual Review | `residual_review` | — |
| 11 | Closed | `closed` | — |
| 12 | Archived | `archived` | — |

### 3.3 Gate conditions

| Gate | Predicate | Machine reason (409) |
|---|---|---|
| `owner_required` | `risks.owner_user_id IS NOT NULL` | `owner_required` |
| `evidence_required` | ≥1 non-deleted `evidence` where `(source_type='risk', source_id=risk.id)` OR linked to any of the risk's treatments | `evidence_required` |
| `score_required` | `risks.residual_rating IS NOT NULL` (and `residual_score` computable) | `score_required` |
| `treatment_required` | ≥1 `risk_treatment` for the risk | `treatment_required` |
| `approval_required` | a `risk_approvals` row exists with `decision='approved'` for the current plan | `approval_required` |
| `validation_recorded` | the transition supplies a validation outcome (+ evidence) | `validation_evidence_required` |
| `separation_of_duties` | `approver_user_id <> requested_by_user_id` | `separation_of_duties` |
| `actor_identity` | approval endpoints require a JWT user (`req.userId` set) | `actor_identity_required` |

Whether the **evidence gate** is enforced or advisory is controlled by an org
setting (`risk_settings.require_evidence_gate`, default advisory) so evidence
collection can be a hard gate for regulated customers and a soft nudge for others.

### 3.4 Transition matrix

Legend for "who": **A** = analyst/owner (non-viewer), **X** = approver
(admin/designated), **S** = system. All transitions require the feature flag on,
`premium` entitlement, and `requireNotViewer`.

| From | To | Trigger | Gates | Who |
|---|---|---|---|---|
| `draft` | `scoping` | Begin assessment | — | A |
| `scoping` | `treatment_selection` | Advance to treatment | `owner_required`, `score_required`, (`evidence_required` if enforced) | A |
| `treatment_selection` | `pending_approval` | Submit plan for approval | `treatment_required`, `actor_identity` | A |
| `treatment_selection` | `mitigation` | Start mitigation (approval not required for this risk — see Section 7 threshold model) | `treatment_required`, `approval_not_required` | A |
| `pending_approval` | `mitigation` | **Approve** | `approval_required`(granted), `separation_of_duties`, `actor_identity` | X |
| `pending_approval` | `treatment_selection` | **Reject** (loop-back) | `separation_of_duties`, `actor_identity` | X |
| `mitigation` | `validation` | Remediation complete | `treatment` reached terminal/`mitigated` | A |
| `validation` | `residual_review` | **Validation pass** | `validation_recorded` | A |
| `validation` | `mitigation` | **Validation fail** (loop-back) | `validation_recorded` | A |
| `residual_review` | `closed` | Close | residual re-scored | A |
| `residual_review` | `scoping` | **Re-score on new evidence** (loop-back) | new evidence attached | A |
| `closed` | `residual_review` | Reopen | — | A |
| `closed` | `archived` | Archive | — | A (bulk-capable) |
| `residual_review` | `archived` | Archive (skip close) | — | A |
| `archived` | `closed` | Un-archive | — | A |
| any active state | `scoping` | Re-score on new evidence (general) | new evidence attached | A |

**Loop-backs (explicit):** approval-rejected → `treatment_selection`;
validation-fail → `mitigation`; re-score-on-new-evidence → `scoping`.

**Terminal-state semantics:**
- `closed` = read-only for register mutations except an explicit **reopen**
  transition; posture scoring already drops closed/terminal risks.
- `archived` = hidden from default list views (list endpoints exclude `archived`
  unless `?include_archived=true`), retained forever for audit; un-archive returns
  it to `closed`.

### 3.5 Interaction with the existing treatment→status sync

The treatment terminal-status sync (`riskTreatments.ts:594-620`) currently writes
`risks.status` directly. When the flag is **on**, that write is reconciled to the
lifecycle:

- treatment → `mitigated` moves lifecycle `mitigation → validation` (mitigation
  produced a result to validate), and sets derived `status='mitigated'`;
- treatment → `accepted` requires the risk to be in `pending_approval` or later
  and routes lifecycle to `residual_review` (an accepted risk still gets a residual
  review), derived `status='accepted'`;
- treatment → `transferred` routes lifecycle to `residual_review`, derived
  `status='transferred'`.

When the flag is **off**, the sync behaves exactly as today (no lifecycle column
is consulted or written). This reconciliation lives behind the flag and is
specified precisely in epic R1's acceptance criteria.

---

## 4. Section 3 — Screens

No shared `ui/` primitives layer exists (§1.6); each screen reuses the existing
domain-foldered components and the `RiskTable`/`SuggestionList`/`Notice` patterns,
factoring the duplicated pill/badge/tile styles into a small shared module as
opportunistic cleanup (not a blocker).

### 4.1 Risk detail — Lifecycle panel *(addition to `app/src/app/risks/[id]/RiskDetailClient.tsx`)*
- **Purpose:** show the current stage, the 12-stage progress rail, satisfied/unmet
  gates, and the available transition actions.
- **Entry:** the risk detail page (existing).
- **Components:** a new `components/risks/LifecyclePanel.tsx` (stage rail with
  checkmarks for gate milestones), `LifecycleTransitionButtons.tsx` (buttons
  filtered by state + role, mirroring `TreatmentDetailClient` gated buttons), and
  an inline `LifecycleHistory` link.
- **Data:** `GET /api/risks/:id/lifecycle` (state, gates, allowed transitions).
- **Actions per role/state:** analyst sees enabled transitions whose gates are met
  (unmet gates render disabled with the reason); approver additionally sees
  Approve/Reject when `pending_approval`; viewer sees the rail read-only.
- **States:** loading (skeleton rail), error (retry), empty (flag on but risk in
  `draft` → "Begin assessment" CTA).

### 4.2 Transition modal *(new `components/risks/TransitionModal.tsx`)*
- **Purpose:** capture a required comment, optionally attach evidence, and surface
  gate feedback before executing a transition.
- **Entry:** any transition button in the lifecycle panel.
- **Components:** comment textarea (required), evidence multi-select (existing
  evidence for the risk + "add evidence" inline), gate checklist, submit.
- **Data:** posts to `POST /api/risks/:id/lifecycle/transitions`.
- **States:** validation (comment required), 409 gate feedback rendered inline with
  the machine reason, loading, success (optimistic panel update + `Notice` toast).

### 4.3 Pending-approvals queue *(new page `app/src/app/approvals/page.tsx`)*
- **Purpose:** the approver's work queue of treatment plans / acceptances awaiting
  decision, org-wide.
- **Entry:** nav item visible only to approvers (role-gated — a **new** role-gated
  surface for risks, §1.6).
- **Components:** mirror `components/queue/SuggestionList.tsx` — per-row
  Approve/Reject with an inline rationale, `Notice`/`useTimedNotice` undo; filter
  by domain/rating; `RiskTable`-style layout.
- **Data:** `GET /api/approvals?status=pending`; actions post to the approval
  decision endpoint.
- **States:** loading, first-time empty ("No approvals pending"), filtered-empty,
  error, and a **SoD notice** on rows the current user proposed (Approve/Reject
  disabled with `separation_of_duties`).

### 4.4 Evidence panel *(addition to risk detail)*
- **Purpose:** list evidence linked to the risk (directly + via treatments) and
  attach/detach.
- **Components:** `components/risks/RiskEvidenceSection.tsx` (mirrors
  `LinkedControlsSection`).
- **Data:** `GET /api/evidence?source_type=risk&source_id=:id` plus treatment
  evidence; attach via `POST /api/evidence`; detach via soft-delete (§5, §10 open
  question — evidence is write-once today).
- **States:** empty ("No evidence yet — required before scoring" when the gate is
  enforced), loading, error.

### 4.5 Residual-review screen *(new `app/src/app/risks/[id]/residual-review/`)*
- **Purpose:** re-score residual risk after mitigation/validation, decide
  close vs re-score-loop.
- **Components:** residual dimension editor (reuse `EditRiskForm` fields), a
  before/after score delta, "Close" vs "Re-score (new evidence)" actions.
- **Data:** `PATCH /api/risks/:id` (residual dims) + a lifecycle transition.
- **States:** loading, error, validation.

### 4.6 Archived-risks view *(addition to `app/src/app/risks/page.tsx`)*
- **Purpose:** show archived risks, excluded from the default list.
- **Components:** an "Archived" filter pill on the existing list; reuse `RiskTable`.
- **Data:** `GET /api/risks?lifecycle_state=archived` (or `include_archived=true`).
- **Actions:** un-archive (→ `closed`); bulk-select for archival from the active
  list.
- **States:** empty, loading, error.

### 4.7 Lifecycle audit-trail view *(new `components/risks/LifecycleEventStream.tsx`)*
- **Purpose:** the append-only, transactional event stream for a risk (distinct
  from the existing `RiskHistorySection` projection).
- **Entry:** the risk detail page ("Lifecycle history" tab) and export.
- **Components:** timeline of `risk_lifecycle_events` (from→to, actor, comment,
  evidence refs, approval ref), reusing `auditLogUtils.ts` badge helpers.
- **Data:** `GET /api/risks/:id/lifecycle/events`.
- **States:** loading, empty (flag just enabled), error, "load more".

**New pages:** approvals queue (4.3), residual-review (4.5).
**Additions to existing pages:** risk detail (4.1, 4.2, 4.4, 4.7), risk list (4.6).

---

## 5. Section 4 — Workflows

### 5.1 Happy path (end-to-end)
1. Analyst → `POST /api/risks` → risk in `draft`.
2. Analyst assigns owner (`PATCH /api/risks/:id` `owner_user_id`) → `owner_required` gate met.
3. Analyst attaches evidence (`POST /api/evidence` `source_type=risk`) → `evidence_required` gate met.
4. Analyst sets residual dims → system computes `residual_score`/`score_basis` → `score_required` gate met.
5. Analyst transitions `draft → scoping → treatment_selection` (gates checked).
6. Analyst creates a `risk_treatment` (proposer = `owner_user_id`), then transitions `treatment_selection → pending_approval`, creating a `risk_approvals` row (`requested_by_user_id = actor`).
7. Approver opens the approvals queue, **Approve** (rationale) → SoD checked (`approver ≠ requester`) → `risk_approvals.decision='approved'`, lifecycle `pending_approval → mitigation`.
8. Analyst works the treatment to terminal `mitigated` → lifecycle `mitigation → validation`.
9. Analyst records validation pass (+ evidence) → `validation → residual_review`.
10. Analyst re-scores residual, closes → `residual_review → closed` (derived `status='closed'`; drops from posture).
11. Later, analyst bulk-archives closed risks → `closed → archived`.
Every step writes one `risk_lifecycle_events` row **inside the same transaction**.

### 5.2 Approval rejection loop
1. Risk in `pending_approval`.
2. Approver **Reject** (rationale required) → `risk_approvals.decision='rejected'`, `decided_at`, `approver_user_id`.
3. Lifecycle `pending_approval → treatment_selection`; event records from→to + rejection rationale.
4. Analyst revises/adds a treatment, re-submits → new `risk_approvals` row (prior rejected row retained for audit).

### 5.3 Validation failure loop
1. Risk in `validation`.
2. Analyst records **fail** with a comment (+ optional evidence) → transition `validation → mitigation`.
3. Event captures the failure; treatment re-opened or a new treatment added; mitigation resumes.

### 5.4 Re-score after new evidence
1. Risk in `residual_review` (or any active state).
2. Analyst attaches new evidence → transition `→ scoping` (loop-back), recomputing score.
3. Score gate re-evaluated; analyst re-advances through `treatment_selection` (a materially changed score may require fresh approval — enforced when the threshold model, §7, deems it above threshold).

### 5.5 Bulk archival
1. Analyst multi-selects `closed` risks in the list.
2. `POST /api/risks/lifecycle/bulk-archive` `{ risk_ids: [...] }` (idempotent: already-archived ids no-op).
3. Each eligible risk transitions `closed → archived`, one event each; response reports per-id outcome.

### 5.6 Auditor read path
1. Auditor (viewer) opens a risk → lifecycle panel renders read-only.
2. Opens "Lifecycle history" → `GET /api/risks/:id/lifecycle/events` (full from→to, actor, comment, evidence, approval refs).
3. Opens approvals → read-only decisions with rationale + approver + timestamp.
4. All mutation endpoints return 403 for viewer (`requireNotViewer`).

---

## 6. Section 5 — API surface

**Conventions (existing):** all routes mount at `/api`, chain
`requireApiKey → attachOrganizationContext → requireEntitlement("premium") → asTenant`
(`routes/index.ts:447-450`). Lifecycle routes add two middlewares: `requireRiskLifecycle`
(404 when the flag is off, mirroring vendor assurance) and, on approval endpoints,
`requireActorIdentity` (403 `actor_identity_required` when `req.userId` is unset —
i.e. API-key-only). Router: new `src/api/routes/riskLifecycle.ts` +
`src/api/routes/riskApprovals.ts`.

Error envelope: `{ error: "<machine_reason>", message: "<human>" , ...context }`.
Gate failures are **409** with a machine-readable `reason` from §3.3.

| # | Method + path | Purpose | Request | Success | Errors | Perms | Idempotency |
|---|---|---|---|---|---|---|---|
| 1 | `GET /api/risks/:id/lifecycle` | Current state + gates + allowed transitions | — | `200 { lifecycle_state, gates:{owner,evidence,score,...}, allowed_transitions:[...] }` | 404 | any (read) | safe |
| 2 | `POST /api/risks/:id/lifecycle/transitions` | Execute a transition | `{ transition, to_state, expected_from_state, comment (required), evidence_ids?[] }` | `200 { lifecycle_state, event }` | 409 `state_conflict` (expected_from ≠ current), 409 gate reasons, 422 `invalid_transition`, 403 viewer | A/X per matrix | `expected_from_state` gives optimistic concurrency; replay with stale from → 409 |
| 3 | `GET /api/risks/:id/lifecycle/events` | Append-only event stream | `?cursor=&limit=` | `200 { events:[{from,to,transition,actor_user_id,comment,evidence_ids,approval_id,created_at}], next_cursor }` | 404 | any (read) | safe |
| 4 | `POST /api/risks/:id/approvals` | Request approval for the active plan | `{ kind:'treatment_plan'|'risk_acceptance', treatment_id?, rationale?, expires_at? }` | `201 { approval }` | 409 `approval_already_open`, 409 `treatment_required` | A (proposer); `actor_identity` | `ON CONFLICT` on one open approval per risk → `approval_already_open` |
| 5 | `GET /api/risks/:id/approvals` | List approvals for a risk | `?status=` | `200 { approvals:[...] }` | 404 | any (read) | safe |
| 6 | `POST /api/risks/:id/approvals/:approvalId/decision` | Approve / reject | `{ decision:'approved'|'rejected', rationale (required) }` | `200 { approval, lifecycle_state }` | 409 `separation_of_duties`, 409 `already_decided`, 403 `actor_identity_required`, 403 viewer | X (approver); `actor_identity` | decision idempotent on `already_decided`; state advance guarded by `expected` current decision `pending` |
| 7 | `GET /api/approvals` | Org-wide pending-approvals queue | `?status=pending&domain=&rating=&cursor=&limit=` | `200 { approvals:[{risk_id, title, residual_rating, requested_by, requested_at, is_self_proposed}], next_cursor }` | — | X (approver-visible) | safe |
| 8 | `POST /api/evidence` (extend) | Attach evidence to a risk directly | `{ source_type:'risk', source_id, title, evidence_type, ... }` | `201 { evidence }` | 404 `source_record_not_found`, 422 validation | A; `requireNotViewer` | multiple evidence rows allowed (existing behavior) |
| 9 | `DELETE /api/evidence/:id` (new, soft) | Detach evidence | — | `200 { evidence }` (soft `deleted_at`) | 404, 409 if gate would break | A | idempotent (already-deleted → 200) — **contract change, see §10** |
| 10 | `POST /api/risks/lifecycle/bulk-archive` | Bulk archive closed risks | `{ risk_ids:[...] }` | `200 { results:[{id, outcome}] }` | 422 | A | per-id idempotent (already-archived → `no_op`) |

All list endpoints exclude `archived` by default; add `?include_archived=true` or
`?lifecycle_state=archived` to include. The existing `GET /api/risks` (`risks.ts:445`)
gains an optional `lifecycle_state` filter **only when the flag is on** (additive,
default behavior unchanged when off).

---

## 7. Section 6 — Database entities

All new tables: `organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`,
written only inside `withTenant`, shipped with the inert RLS scaffolding
(`*_tenant_isolation` policy, `NOT FORCE`) per `20260703_risk_treatments_rls.sql:17-23`.

### 7.1 `risks` — modified (additive)
```sql
ALTER TABLE risks
  ADD COLUMN IF NOT EXISTS lifecycle_state TEXT NULL;
-- CHECK added separately so pre-flag rows (NULL) are legal:
ALTER TABLE risks
  ADD CONSTRAINT risk_lifecycle_state_check CHECK (
    lifecycle_state IS NULL OR lifecycle_state IN (
      'draft','scoping','treatment_selection','pending_approval',
      'mitigation','validation','residual_review','closed','archived'
    ));
CREATE INDEX IF NOT EXISTS idx_risks_org_lifecycle
  ON risks (organization_id, lifecycle_state);
```
- `NULL` = "not lifecycle-managed" (all rows before the flag is enabled; and the
  default for rows created while the flag is off). When the flag is on, new risks
  are created in `draft`; existing `NULL` rows are treated as `draft` by the read
  layer and lazily set on first transition. **No backfill migration** — additive,
  zero behavior change when off.
- Legacy `status` remains authoritative for posture when the flag is off; when on,
  `status` is a **derived mirror** of `lifecycle_state` (§3.5).

### 7.2 `risk_lifecycle_events` — new (append-only audit stream)
```sql
CREATE TABLE IF NOT EXISTS risk_lifecycle_events (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  risk_id          UUID        NOT NULL REFERENCES risks(id) ON DELETE CASCADE,
  from_state       TEXT        NULL,          -- NULL for the first event
  to_state         TEXT        NOT NULL,
  transition       TEXT        NOT NULL,       -- e.g. 'approve','reject','validation_fail'
  actor_user_id    UUID        NULL REFERENCES users(id),  -- NULL on API-key path
  comment          TEXT        NULL,
  evidence_ids     UUID[]      NOT NULL DEFAULT '{}',
  approval_id      UUID        NULL,           -- FK-in-spirit to risk_approvals
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rle_org_risk_created
  ON risk_lifecycle_events (organization_id, risk_id, created_at DESC, id DESC);
```
- **Written inside the same `withTenant` transaction as the state change** — this
  is the deliberate improvement over the fire-and-forget `security_audit_log`
  projection (§1.1). If the event insert fails, the transition rolls back.
- Append-only: no `UPDATE`/`DELETE` route; enforce with an RLS/trigger guard as in
  the immutability pattern used elsewhere (A08-G1).
- Mirrors to `security_audit_log` (post-commit, best-effort) so the global
  `/api/audit-log` feed still sees transitions — but the table here is authoritative.

### 7.3 `risk_approvals` — new (subsumes RR-8)
```sql
CREATE TABLE IF NOT EXISTS risk_approvals (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  risk_id              UUID        NOT NULL REFERENCES risks(id) ON DELETE CASCADE,
  treatment_id         UUID        NULL REFERENCES risk_treatments(id) ON DELETE SET NULL,
  kind                 TEXT        NOT NULL,   -- 'treatment_plan' | 'risk_acceptance'
  decision             TEXT        NOT NULL DEFAULT 'pending', -- pending|approved|rejected
  requested_by_user_id UUID        NOT NULL REFERENCES users(id),
  approver_user_id     UUID        NULL REFERENCES users(id),
  request_rationale    TEXT        NULL,
  decision_rationale   TEXT        NULL,       -- required when decided
  expires_at           DATE        NULL,       -- RR-8 acceptance expiry
  decided_at           TIMESTAMPTZ NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT risk_approval_kind_check     CHECK (kind IN ('treatment_plan','risk_acceptance')),
  CONSTRAINT risk_approval_decision_check CHECK (decision IN ('pending','approved','rejected')),
  -- Separation of duties, enforced at the row level:
  CONSTRAINT risk_approval_sod_check      CHECK (approver_user_id IS NULL OR approver_user_id <> requested_by_user_id)
);
-- One open (pending) approval per risk:
CREATE UNIQUE INDEX IF NOT EXISTS idx_risk_approvals_one_open
  ON risk_approvals (organization_id, risk_id) WHERE decision = 'pending';
CREATE INDEX IF NOT EXISTS idx_risk_approvals_org_pending
  ON risk_approvals (organization_id, decision, created_at DESC);
```
- RR-8's `acceptance_rationale`/`acceptance_approver_user_id`/`acceptance_expires_at`
  map to `request_rationale`+`decision_rationale`/`approver_user_id`/`expires_at`
  with `kind='risk_acceptance'`. RR-8 is thereby realized, not duplicated.
- The dormant `risk_treatments.reviewer_uuid` (§1.1) is **denormalized** from the
  approved approval's `approver_user_id` for read convenience (optional).

### 7.4 `risk_settings` — modified (additive; approver-model + evidence gate)
```sql
ALTER TABLE risk_settings
  ADD COLUMN IF NOT EXISTS approval_threshold_score INTEGER NULL, -- score-threshold model (Section 7 option b)
  ADD COLUMN IF NOT EXISTS require_evidence_gate    BOOLEAN NOT NULL DEFAULT FALSE;
```
- `approval_threshold_score NULL` → **all** treatment plans require approval
  (designated-approver model, option a). Set (e.g. 50) → only risks with
  `residual_score >= threshold` require the `pending_approval` state; below it,
  `treatment_selection → mitigation` is permitted directly. This makes option (b)
  a pure config layer over (a) — no schema rework later.

### 7.5 `evidence` — modified (additive)
```sql
-- add 'risk' to the source_type CHECK (drop/re-add pattern per 20260427):
ALTER TABLE evidence DROP CONSTRAINT evidence_source_type_check;
ALTER TABLE evidence ADD CONSTRAINT evidence_source_type_check CHECK (
  source_type IN ('control_test','vendor_review','ai_review','obligation_review',
                  'dependency_review','risk_treatment','finding','risk')
);
-- soft-detach support (see §10 open question on write-once contract):
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;
```
- Also fix the validation drift (§1.2) so `evidenceValidation.ts` and the DB CHECK
  agree (add `risk`, reconcile `ai_governance_review`/`policy_review`) — small,
  additive, and folded into R4.

### 7.6 Migration list (filename-keyed)
Dates chosen after the latest existing migration (`20260706`) and after today
(2026-07-02); intra-day lexical order verified (`.` < `_`, table before its `_rls`):

| Migration file | Epic | Purpose |
|---|---|---|
| `20260714_risk_lifecycle_state.sql` | R1 | `risks.lifecycle_state` column + CHECK + index |
| `20260714_risk_lifecycle_events.sql` | R1 | `risk_lifecycle_events` table + append-only guard |
| `20260714_risk_lifecycle_events_rls.sql` | R1 | inert RLS policy |
| `20260715_risk_approvals.sql` | R2 | `risk_approvals` table + SoD CHECK + indexes |
| `20260715_risk_approvals_rls.sql` | R2 | inert RLS policy |
| `20260715_risk_settings_approval.sql` | R2 | `approval_threshold_score` + `require_evidence_gate` |
| `20260716_evidence_source_type_risk.sql` | R4 | add `risk` to evidence CHECK + `deleted_at` |

**RLS compatibility:** the two `_rls.sql` files follow the inert scaffolding
pattern exactly (§1.5) and land ahead of the `DATABASE_URL` → `app_request`
cutover without effect (owner bypasses; `NOT FORCE`). `risk_lifecycle_events` and
`risk_approvals` both carry `organization_id NOT NULL` and are only written inside
`withTenant`.

---

## 8. Section 7 — Permissions model

### 8.1 Current roles (verified)
`users.role` with inconsistent vocab across layers: DB default `member`, invite
default `analyst`, code checks `admin`/`analyst`/`viewer` (§1.4). `requireRole`,
`requireAdminRole`, `requireNotViewer` exist; **API-key requests bypass all role
guards** and carry **no user identity**.

### 8.2 What's needed for executive approval
1. An **approver authority** — none exists (`admin` is the only privileged role).
2. **Actor attribution** on approval — impossible on the API-key path (`req.userId`
   is `null`); approval endpoints must require a JWT session (`requireActorIdentity`
   → 403 `actor_identity_required`).
3. **Approval state** — the `risk_approvals` state machine (`pending → approved|rejected`).

### 8.3 Separation of duties (proposer ≠ approver)
Enforced at three layers (defense in depth):
- **DB:** `risk_approval_sod_check` CHECK (`approver_user_id <> requested_by_user_id`).
- **App:** the decision handler rejects `approver == requester` with 409
  `separation_of_duties` before writing.
- **UI:** the approvals queue disables Approve/Reject on self-proposed rows
  (`is_self_proposed`).

### 8.4 Approver model — both options (Simmee decides; this is Open Question #1)

**Option (a) — designated approver role (recommended to build first).**
Approval authority is role-based. Ship with approver = users whose `role = 'admin'`
(no new role required), routed through a single pluggable predicate
`canApprove(user, risk)` in `src/api/lib/riskApprovalAuthority.ts`. If a dedicated
`approver` role is later desired, add it to the role vocab and to `canApprove` — no
schema change. **All** treatment plans require approval when
`approval_threshold_score IS NULL`.

**Option (b) — score-threshold rule (layer on later, no rework).**
`risk_settings.approval_threshold_score` (§7.4). When set, only risks with
`residual_score >= threshold` enter `pending_approval`; below-threshold risks may
transition `treatment_selection → mitigation` directly (gate
`approval_not_required`). Because the column ships in R2 (nullable, default null =
option a), enabling (b) is a config change, not a migration.

**Recommendation:** build (a) now with `canApprove` as the single authority seam
and the threshold column present-but-null; enable (b) when a customer asks. This
satisfies "allow (a) now and (b) later without schema rework."

### 8.5 Role → capability matrix

| Capability | viewer | analyst / member (owner) | admin (approver) |
|---|---|---|---|
| Read lifecycle / events / approvals | ✓ | ✓ | ✓ |
| Create risk, assign owner, attach evidence, score | ✗ | ✓ | ✓ |
| Propose treatment, request approval | ✗ | ✓ | ✓ |
| Execute non-approval transitions | ✗ | ✓ | ✓ |
| Approve / reject | ✗ | ✗ | ✓ (if `canApprove` and not self-proposed) |

---

## 9. Section 8 — Non-functionals

- **Audit completeness:** every state change writes exactly one
  `risk_lifecycle_events` row **inside the transition transaction** (not
  fire-and-forget). No transition path may bypass the event write; enforced by
  routing all transitions through one `applyTransition()` service.
- **Tenant isolation:** all new tables `organization_id NOT NULL`, written only via
  `withTenant`, with inert RLS scaffolding matching the A04-G1 pattern. No new
  cross-org read path; the pending-approvals queue is org-scoped by
  `asTenant`.
- **Feature flag:** `SECURELOGIC_RISK_LIFECYCLE_ENABLED`, off by default.
  Module `src/api/lib/riskLifecycleFeatureFlag.ts` (`riskLifecycleEnabled(env)`
  → `env["SECURELOGIC_RISK_LIFECYCLE_ENABLED"] === "true"`). `render.yaml` declares
  it **explicitly on every relevant service** (engine web + workers, staging +
  prod) with a literal `value: "false"` at launch. **Zero behavior change when
  off:** lifecycle routes 404 (`requireRiskLifecycle`), `lifecycle_state` is never
  read or written, the treatment→status sync behaves as today, and `GET /api/risks`
  ignores the `lifecycle_state` filter.
- **Entitlement gating:** `premium` (rank 4), Bucket A — identical to the rest of
  the risk family (§1.5). **Known limitation:** `requireEntitlement` collapses
  `teams`/`platform`/`platform_annual` into `premium`, so this cannot be gated
  "Platform-only" without new machinery; gating `premium` (which also admits Team)
  is consistent with every existing risk feature and is the recommended scope.
  Finer gating is Open Question #5.
- **API-key access implications:** read endpoints (1, 3, 5, 7) work via API key.
  **Approval endpoints (4-request is analyst-only-attributable, 6-decision)
  require a JWT user** — API-key-only requests get 403 `actor_identity_required`,
  because SoD and "who approved" are unsatisfiable without a human identity.
  Non-approval transitions may run via API key but record `actor_user_id = null`
  (audited as an org/API-key actor); customers wanting full attribution should use
  user sessions. This is documented, not silently degraded.

---

## 10. Section 9 — Implementation epics

Tests: engine logic is covered by **vitest** slices (state machine, gates, SoD,
flag off/on). The app has **no test runner** (`app/` — noted gap); UI epics rely on
type-check + manual/operator verification.

### R1 — Schema + state machine + transition API + audit  *(scope L)*
- **Files:** `db/migrations/20260714_risk_lifecycle_state.sql`,
  `…_risk_lifecycle_events.sql`, `…_events_rls.sql`;
  `src/api/lib/riskLifecycleStateMachine.ts` (states, matrix, gate predicates),
  `src/api/lib/riskLifecycleFeatureFlag.ts`,
  `src/api/middleware/requireRiskLifecycle.ts`,
  `src/api/routes/riskLifecycle.ts` (endpoints 1-3, 10), `applyTransition()` service;
  `render.yaml` (flag, all services, `"false"`).
- **Migrations:** the three above.
- **Tests (vitest):** transition matrix legality; each gate reason; optimistic
  `expected_from_state` 409; event written transactionally (rollback on failure);
  flag-off → routes 404 and no `lifecycle_state` read/write; treatment→status sync
  reconciliation (§3.5) both flag states.
- **Acceptance:** with the flag off, every existing risk test passes unchanged and
  `lifecycle_state` stays `NULL`. With the flag on, a risk walks
  `draft→…→closed` only through legal, gated transitions, each producing one
  `risk_lifecycle_events` row in the same tx.
- **Depends on:** nothing (extends `risks.ts`).

### R2 — Approvals + roles  *(scope M)*
- **Files:** `db/migrations/20260715_risk_approvals.sql`, `…_risk_approvals_rls.sql`,
  `…_risk_settings_approval.sql`; `src/api/routes/riskApprovals.ts` (endpoints
  4-7), `src/api/lib/riskApprovalAuthority.ts` (`canApprove`),
  `src/api/middleware/requireActorIdentity.ts`; wire `pending_approval` transitions
  into R1's `applyTransition()`.
- **Migrations:** the three above.
- **Tests (vitest):** SoD at all three layers (DB CHECK, app 409, self-proposed);
  `actor_identity_required` on API-key approval; one-open-approval unique index →
  409 `approval_already_open`; `already_decided` idempotency; threshold model
  (null → always require; set → below-threshold skips `pending_approval`); approve
  → `mitigation`, reject → `treatment_selection`.
- **Acceptance:** an approver ≠ proposer with a JWT can approve; the proposer
  cannot; API-key approval is refused; RR-8 acceptance (`kind='risk_acceptance'`,
  `expires_at`) records correctly.
- **Depends on:** R1.

### R3 — UI  *(scope L)*
- **Files (app):** `components/risks/LifecyclePanel.tsx`,
  `LifecycleTransitionButtons.tsx`, `TransitionModal.tsx`, `LifecycleEventStream.tsx`,
  `RiskEvidenceSection.tsx`; new pages `app/src/app/approvals/page.tsx`,
  `app/src/app/risks/[id]/residual-review/`; additions to `RiskDetailClient.tsx`
  and `risks/page.tsx` (archived filter); Next.js proxy routes under
  `app/src/app/api/risks/[id]/lifecycle/*` and `app/src/app/api/approvals/*`;
  client fns in `app/src/lib/api.ts`; a small shared pill/badge module extracted
  from the duplicated styles.
- **Migrations:** none.
- **Tests:** type-check + operator walkthrough (app test-runner gap).
- **Acceptance:** the 12-stage rail renders with correct gate checkmarks; disabled
  transitions show their machine reason; approvals queue mirrors `SuggestionList`
  with SoD-disabled self-rows; archived view excluded by default; all mutations
  hidden for viewers.
- **Depends on:** R1, R2.

### R4 — Evidence gating + notifications  *(scope M)*
- **Files:** `db/migrations/20260716_evidence_source_type_risk.sql`; extend
  `evidence.ts` (attach `source_type='risk'`, soft `DELETE`), reconcile
  `evidenceValidation.ts` drift; enforce `evidence_required`/`require_evidence_gate`
  in the state machine; notifications on `pending_approval` (to approvers),
  rejection/validation-fail (to owner) reusing the alerting batcher seam
  (`createAlertBatcher`, `SECURELOGIC_MATCHER_ALERTS_ENABLED` sibling pattern).
- **Migrations:** the one above.
- **Tests (vitest):** evidence attaches to a risk; soft-detach idempotency; the
  evidence gate blocks `scoping→treatment_selection` when enforced; notification
  emitted once per transition (batched).
- **Acceptance:** evidence gate is enforceable per org; approvers are notified of
  pending work; owners are notified of rejection/validation-fail; the evidence
  write-once contract change is documented.
- **Depends on:** R1-R3.

**Epic dependency chain:** R1 → R2 → R3, with R4 layering after R3 (R4's schema is
independent of R2/R3 and could land right after R1 if evidence gating is
prioritized, but its notifications depend on R2's approval events).

---

## 11. Section 10 — Open questions

| # | Question | Options | Recommendation |
|---|---|---|---|
| **1** | **Approver model** | (a) designated approver role; (b) score-threshold rule | Build **(a)** now via a `canApprove` seam with the threshold column present-but-null; enable **(b)** as config later. No schema rework either way. |
| 2 | **API-key approvals & SoD strictness** | (i) require JWT for approval (403 API-key); (ii) allow API-key approval with `actor=null`; (iii) bind API keys to a user | **(i)** — approval must be attributable; API-key approvals are refused. Revisit (iii) if programmatic approval is a real customer need. |
| 3 | **`lifecycle_state` vs legacy `status`** | (i) coexist, `status` derived from `lifecycle_state` when flag on; (ii) replace `status` | **(i)** coexist — additive, posture keeps reading `status`, zero behavior change when off. Reconcile the treatment→status sync per §3.5. |
| 4 | **Evidence write-once contract** | (i) add soft-detach (`deleted_at`); (ii) keep strictly write-once (no detach); (iii) supersede-flag | **(i)** soft-detach, mirroring the link-table `deleted_at` pattern; preserves audit. This changes evidence's documented write-once contract — confirm. |
| 5 | **Platform-vs-Team gating** | (i) gate `premium` (admits Team, like all risk features); (ii) build a finer Platform-only capability | **(i)** for launch — consistent with the whole risk family; (ii) only if Team must be excluded, which needs new entitlement machinery. |
| 6 | **Auto-creation of risks from findings/signals** | (i) out of scope (manual creation only, as today); (ii) auto-derive risks | **(i)** defer — this is RR-10 territory and orthogonal to the lifecycle; the `source_type`/`score_basis` seams are ready when it's prioritized. |
| 7 | **Re-approval after a material re-score** | (i) always re-approve after loop-back to `scoping`; (ii) re-approve only if the new score crosses the threshold | **(ii)** when option 1(b) is active; **(i)** when only 1(a) is active. |
| 8 | **Archival & reopen semantics** | (i) `closed → archived`, un-archive → `closed`; (ii) allow archive from any state; (iii) no un-archive | **(i)** — archive only closed (and `residual_review` as a shortcut), un-archive to `closed`. |

---

## Appendix — files this spec touches (for R-phase prompts)

**Engine (extend):** `src/api/routes/risks.ts`, `riskTreatments.ts`, `evidence.ts`;
`src/api/lib/riskScore.ts`, `riskCadence.ts`, `auditLog.ts`; `render.yaml`;
`scripts/runMigrations.ts` (no change — convention only).
**Engine (new):** `src/api/routes/riskLifecycle.ts`, `riskApprovals.ts`;
`src/api/lib/riskLifecycleStateMachine.ts`, `riskLifecycleFeatureFlag.ts`,
`riskApprovalAuthority.ts`; `src/api/middleware/requireRiskLifecycle.ts`,
`requireActorIdentity.ts`; 7 migrations (§7.6).
**App (new/extend):** `app/src/app/risks/[id]/RiskDetailClient.tsx`,
`risks/page.tsx`, new `approvals/` and `risks/[id]/residual-review/` pages,
`components/risks/Lifecycle*.tsx`, `RiskEvidenceSection.tsx`, proxy routes under
`app/src/app/api/risks/[id]/lifecycle/*` and `api/approvals/*`, `app/src/lib/api.ts`.

---

## Decisions (R1 build authorization, 2026-07-02)

The following resolve the open questions in §11 so R1 can proceed. These are
binding for the R-phase build; the rest of §11 remains open for later epics.

- **Q1 — Approver model → (a) designated approver, now.** Build the designated
  approver model via the `canApprove(user, risk)` seam (R2). The score-threshold
  column `risk_settings.approval_threshold_score` **ships in R1 as `NULL`/unused**
  (per §7.4) so model (b) layers on later with zero schema rework. While it is
  `NULL`, all treatment plans require approval under model (a) (approval execution
  itself is R2).
- **Q2 — API-key approvals → 403, non-approval transitions attributed-or-null.**
  Approval decision endpoints (R2) require a JWT user identity; API-key-only
  requests get **403 `actor_identity_required`**. For R1: non-approval transitions
  are permitted via API key and record `actor_user_id = NULL` (audited as an
  org/API-key actor); JWT requests record `actor_user_id = req.userId`. The
  `risk_lifecycle_events.actor_user_id` column is therefore nullable (§7.2).
- **Q3 — `lifecycle_state` coexists; `status` derived.** `risks.lifecycle_state`
  is a **net-new nullable column** (§7.1). Legacy `risks.status` is retained and,
  when the flag is on, kept as a derived mirror of `lifecycle_state` per §3.5.
  When the flag is **off**, `lifecycle_state` is never read or written and every
  existing risk route behaves exactly as today (inert).
- **Q5 — Entitlement gate = `premium` (rank 4).** The lifecycle is gated
  `requireEntitlement("premium")`, identical to the rest of the risk family
  (Bucket A). The `teams`/`platform` collapse (§9) is accepted for R1; finer
  Platform-only gating stays deferred (§11 Q5 remains open).

**R1 scope boundary.** R1 ships: the `lifecycle_state` column; the
`risk_lifecycle_events` append-only, in-transaction audit stream;
the `risk_approvals` + `risk_settings` **schema scaffolding** (no approval
execution — that is R2); the pure transition state machine (9 states, full
matrix incl. loop-backs, terminal semantics, gate predicates incl. an
unknown/garbage-state fail-safe); the transition-execution and lifecycle-event
read endpoints; the `SECURELOGIC_RISK_LIFECYCLE_ENABLED` flag (default off →
routes 404/disabled), `render.yaml` declaration, and `premium` entitlement gate.
Transitions that require an approved approval (e.g. `pending_approval →
mitigation`) are recognized by the machine but not satisfiable until R2.
