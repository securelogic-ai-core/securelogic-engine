# Finding Lifecycle — Engineering Specification (RATIFIED)

- **Status:** RATIFIED 2026-07-10. Governs Phase 3–4 (finding re-root) of the
  Enterprise Risk Graph convergence (`docs/architecture/proposals/CONVERGENCE-ROADMAP.md`).
- **Authority:** product-owner rulings of 2026-07-10 (two-axis model + R3 no-auto-advance).
- **Companion:** `ENTERPRISE-RISK-GRAPH.md` (R1–R3), `risk-lifecycle-spec.md` (the Risk
  register machine this generalizes), `CONVERGENCE-ROADMAP.md`.

Implementation of any structural Phase 3–4 change MUST conform to this spec.

---

## 0. Purpose

Give the **Finding** the guarded, audited discipline the Risk register already has,
under **two orthogonal axes**, so that (a) the same condition can never be shown
inconsistently across screens, (b) the system automates only what it has authoritative
evidence for, and (c) governance decisions stay human. This spec is the durable fix for
the free-set `status`/`decision_state` defect (`findings.ts:951-1103`).

## 1. The two axes (single writer each)

### 1.1 `operational_status` — SYSTEM-DERIVED (AMENDED 2026-07-12)
A pure function of **governance, the legacy compat axis, and objective workflow
events** — the linked Actions and Evidence — recomputed in the same transaction that
changes any of them. **No route, edit form, dropdown, or applicability result writes it
directly.** It is derived, never hand-set (§7 is unchanged).

Evaluated in this priority order:

| Value | Derivation |
|---|---|
| `closed` | `decision_state = 'resolved'` (governance closure), **or** legacy `status` is terminal (`closed`/`accepted`) — the **compat bridge**, below |
| `in_progress` | ≥1 linked Action is `in_progress`/`blocked` |
| `remediated` | every linked Action is terminal (`closed`/`accepted`) and ≥1 existed; evidence gate satisfied if org-enforced |
| `open` | no linked Action has started |

`remediated` is **not** closure — remediation completed, **awaiting validation /
governance closure**. It remains ACTIVE. Closure is a governance decision (§1.2).

**AMENDMENT (product ruling 2026-07-12).** The axis previously had no terminal state,
which made the canonical enterprise metric — `Active Finding = operational_status <>
'closed'` — vacuously true: every closed finding would have counted as Active. `closed`
is therefore added here, and the derivation now consumes the governance decision. The
axis remains system-derived; what changed is its *inputs*, not its discipline.

**The compat bridge.** Legacy `status` (`open`/`in_progress`/`closed`/`accepted`) is
still directly writable (PATCH, importers, flag-off callers) and is the only closure
signal those writers have. `operational_status` therefore also derives `closed` from a
terminal legacy `status`, so the two axes **cannot contradict each other about
closure** — enforced in the database by `findings_closure_axes_agree`. Writing either
axis across the closure boundary carries the other with it, in the same statement. The
bridge retires when `status` does.

**Reopen** needs no persistent state: clearing the closure inputs makes the derivation
fall through to the Actions, so a reopened finding lands on its *real* state
(`open`/`in_progress`/`remediated`).

**Legacy `status`** is retained as a **derived projection** (§3) so existing readers
(posture, exports, dashboard) are byte-identical until they migrate.

### 1.2 `decision_state` — HUMAN-GOVERNED (the system never writes it except the initial value)
The management judgment. Set only through the guarded governance endpoint by an
entitled user; every transition writes an audit event and obeys permissions/approvals.

| Value | Meaning | Writer |
|---|---|---|
| `needs_review` | awaiting a human decision (also the **initial** system-generated value) | system may set the INITIAL value only (R3); thereafter human |
| `mitigating` | leadership accepted the remediation plan | human |
| `accepted_risk` | leadership formally accepts the risk (governance override) | human |
| `resolved` | leadership closes the finding — the only path to derived `status='closed'` | human |

### 1.3 Reconciliation rule (reconciled with R3)
- The system **advances `operational_status`** from workflow evidence (Actions/Evidence) only.
- When `operational_status = remediated`, the finding **surfaces in a "ready for
  decision" queue** — a *query* over `operational_status='remediated' AND decision_state
  NOT IN (terminal)`. The system **does NOT write `decision_state`** to route it; it
  only exposes the prompt. A human makes the governance decision.
- A governance decision inconsistent with evidence (e.g. `resolved` while work is open)
  is permitted **only** via an explicit, audited override (`accepted_risk`).
- **The system never auto-marks a finding reviewed, accepted, in-progress, remediated
  (as a decision), approved, or closed** — remediated is an *operational* derivation,
  not a governance act.

## 2. Applicability integration (R1–R3) — how an assessment touches a finding

An `applicability_assessment` (the Observed Condition, from `ApplicabilityEngineV1`)
MAY, on write:
- create or **refresh** a finding, placing a **new** finding at its **initial
  system-generated state** — `operational_status='open'`, `decision_state='needs_review'`;
- update: **applicability state, confidence, matched tenant assets, supporting
  evidence, calculated business impact, recommended action, and audit history.**

It MUST NOT:
- advance `operational_status` (that is derived from Actions/Evidence only), or
- write `decision_state` for any **existing** finding (no auto reviewed/accepted/
  in-progress/remediated/approved/closed) — **R3**.

`affected` is **evidence-gated (R2)**: an assessment reaches `affected` only with
authoritative technology-identifying evidence **and** a high-confidence explainable
tenant-asset match; otherwise `potentially_affected`/`needs_review`/`unknown`. Vendor
identity alone never yields `affected`. This threshold is specified in the governing
applicability spec and enforced identically in services, APIs, UI, and tests.

## 3. Derived legacy `status` (compat projection)

```
status = (decision_state = resolved)      → 'closed'
       | operational_status = in_progress → 'in_progress'
       | operational_status = remediated   → 'in_progress'   (work done; not closed by a human)
       | else                              → 'open'
```

## 4. State-transition table (canonical)

| From (op / decision) | Trigger | Actor | Auto | Guard | To | Audit |
|---|---|---|---|---|---|---|
| — | applicability creates finding | system | ✅ | evidence-gate (R2) | op:open / decision:needs_review (INITIAL only) | `finding.created` |
| op:open | first Action → in_progress | system | ✅ | — | op:in_progress | `finding.operational.advanced` |
| op:in_progress | last Action → terminal | system | ✅ | evidence gate | op:remediated | `finding.remediated` |
| op:remediated | (surfaced in ready-for-decision queue) | — | query only | — | (no write) | — |
| decision:needs_review | accept plan | human | ❌ | entitlement | decision:mitigating | `finding.decision.mitigating` |
| any | accept risk | human | ❌ | entitlement | decision:accepted_risk | `finding.decision.accepted_risk` |
| op:remediated / decision:needs_review | close | human | ❌ | entitlement; op=remediated OR decision=accepted_risk | decision:resolved (→ status closed) | `finding.decision.resolved` |
| decision:resolved | reopen | human | ❌ | entitlement | decision:needs_review | `finding.reopened` |
| any | new evidence / re-assessment | system | ✅ | — | op recomputed; applicability updated | `finding.operational.recomputed` |

No system-triggered transition writes `decision_state` except the **initial** value on
finding creation.

## 5. Child→parent cascade

`PATCH /api/actions/:id` (any Action status write) recomputes the parent Finding's
`operational_status` in the same transaction when `source_type='finding'`, emitting the
audit event. Direct fix for "closed remediation on an open finding" and "action_count
includes closed actions" (count semantics move to open-Action-only for work surfaces).

## 6. Migrations (additive — Phase C6)

1. `findings.operational_status` enum (default `open`, backfilled from current `status`).
2. `finding_lifecycle_events` append-only audit stream (mirrors `risk_lifecycle_events`).
3. `status` becomes a derived projection (§3) in a later reader-migration package; no
   destructive change to `status`/`decision_state` now.
4. **20260906 — the reader migration (ruling 2026-07-12).** `operational_status` gains
   terminal `closed`; `finding_lifecycle_events` widened to record it; every row
   backfilled deterministically from existing lifecycle evidence; the canonical
   predicate (`metricDefinitions.sqlFindingActive`) rebased onto the operational axis;
   `findings_closure_axes_agree` added so the two axes can never disagree about closure.
   The backfill preserves the pre-migration Active population **exactly** — the new
   predicate and the old one select the identical set, so no customer-facing number
   moved. Proved by `test/isolation/findingOperationalClosure.test.ts`.

   *Open product decision:* legacy `status='accepted'` is backfilled to `closed`, which
   is what today's readers already do (it is excluded from Active). That is in tension
   with the two-axis model, where `decision_state='accepted_risk'` explicitly does NOT
   close a finding. Reconciling them is a POPULATION change and awaits a ruling.

## 7. Guards / non-negotiables

- `operational_status` never hand-set; `decision_state` never computed (except initial).
- Applicability never advances operational or governance state (R3).
- Every governance transition is entitlement-gated + audited; separation-of-duties where
  the Risk lifecycle requires it.
- Flag-off (`DECISION_WORKSPACE` off) is byte-identical to the legacy finding detail.

## Appendix — CANONICAL_DOMAIN_MODEL.md amendment (applied in the C0 doc-sync)

Record on the Finding: `operational_status` (system-derived `open|in_progress|remediated`),
`decision_state` (human `needs_review|mitigating|accepted_risk|resolved`), legacy `status`
as a derived projection, and `finding_review_marks` as a per-user cursor (not a lifecycle
state). Invariant: *operational_status is never hand-set; decision_state is never
computed except its initial value.*
