# Formal Architecture Review — ENTERPRISE_CONTEXT_ARCHITECTURE.md

> **Companion to** `ENTERPRISE_CONTEXT_ARCHITECTURE.md`. This is the adversarial review
> of the v1 blueprint. Its findings are captured **exactly as produced** and are not to
> be edited. The v2 blueprint incorporates every Critical and High finding; see its
> "Resolved Review Findings" section for the mapping.
>
> **Reviewer stance:** Principal Architect, decade-horizon, thousands of enterprise
> tenants (incl. Fortune 500 / government / critical infrastructure).
> **Objective:** challenge, not approve.
> **Method:** independent red-team pass verified against the live code, synthesized
> with the reviewer's own findings; severity and block classifications owned by the
> reviewer.

**Disposition:** **NOT APPROVED AS DRAWN — CONDITIONAL.** The connective-tissue framing
(AD-1/AD-3/AD-6 anti-duplication) is sound and should be ratified. But the blueprint is
**strongest where code already exists and weakest exactly where the new strategic value
lives**: the new entities' domain model, the legal-defensibility contract, the scale
substrate, and the enterprise access model. Four Critical findings must be resolved
before **any** slice is authorized.

**Severity legend:** **Critical** = will force a redesign of the strategic core / legal
or tenant-safety exposure · **High** = will force rework of a slice or a scale wall
within the growth horizon · **Medium** = correctness/quality risk, fixable within slice
scope · **Low** = hygiene.

---

## Verification summary (what is actually true in the code)

- Matcher is strictly **per-org**: `runMatcherForSignal(orgId, signal)` writes findings,
  `signal_match_suggestions`, and `exposure_flagged` scoped to one org
  (`src/api/lib/cyberSignalProcessingService.ts:440,580,812`). The N-org fan-out the doc
  leans on is real.
- `enforceEntityLimit` counts **exactly `vendors + ai_systems`** against
  `max_monitored_entities` (`src/api/lib/entityLimit.ts:44-49`). ECL entities are
  genuinely invisible to it.
- Jobs poll is a **single global `UPDATE … ORDER BY scheduled_for FOR UPDATE SKIP LOCKED
  LIMIT 1`** on `pgElevated` (`src/api/workers/dataRightsWorker.ts:112-130`); indexes are
  `idx_jobs_status_scheduled` and `idx_jobs_type_status`
  (`db/migrations/20260621_gdpr_foundations.sql:145,151`).
- RLS is on **≥27 tables**, all **NOT FORCE + INERT** (e.g.
  `db/migrations/20260630_vendor_assessments_rls.sql:21`;
  `20260619_findings_rls_pilot.sql:30`). Doc says "~22" — minor undercount.
- **Zero `WITH RECURSIVE` anywhere in the repo.** The graph resolver would be the team's
  first recursive CTE in production.
- `evidence(source_type, source_id)` polymorphic table exists as claimed
  (`db/migrations/20260420_evidence_primitives.sql:20`). That current-state claim is
  accurate.
- `signal_*_links` carry `organization_id NOT NULL`, but `cyber_signals` is
  org-NULL/global (`db/migrations/20260420_cyber_signals_allow_null_org.sql:36`).
  Relevant to the graph seam (AR-4/F6).

---

## Area 1 — Domain Model

### AR-1 · Critical · Load-bearing, regulator-relevant attributes live in unconstrained `metadata JSONB` · BLOCKS S1
- **Why it matters:** The typed columns (§4 AD-1) are all *generic*
  (name/owner/status/criticality/confidence/provenance). Every *type-specific* attribute
  — a `data_store`'s data-classification/residency/retention, an `asset`'s IP/OS, a
  `business_service`'s RTO/RPO/tier — falls into an untyped blob: unvalidated,
  unconstrained, unindexed. Those are precisely the fields a regulatory blast-radius
  query needs. Violates the platform's own anti-pattern rule ("no canonical object as a
  JSON blob").
- **Impact:** The IAE cannot answer "which *regulated* data is in the blast radius" — the
  answer lives in a field it can't constrain or index. Retrofitting typed columns later
  is a migration over live customer data.
- **Recommended solution:** Push the doc's own seam ("rich workflow → typed; inventory →
  generic") one level deeper: a shared `enterprise_entities` header + **per-type child
  tables** (or, minimally, typed constrained columns for `data_store` first).
  `metadata JSONB` may hold genuinely-freeform custom fields only, never
  compliance-load-bearing attributes.
- **Blocks:** Yes — S1.

### AR-2 · High · The design defers the exact entity types its flagship engine requires · BLOCKS S4 planning
- **Why it matters:** §4 defers `data_classification`, identity, `cloud_resource`,
  `network` "until a consumer exists." The IAE (§6) *is* the consumer, in the same
  blueprint. Regulatory blast radius (HIPAA/GDPR) is impossible without data-classification
  + residency nodes; cyber blast radius is impossible without identity/access nodes.
- **Impact:** S4 either ships on a graph that can't answer its justifying questions, or
  forces an emergency taxonomy expansion mid-sequence (schema churn on a live table).
- **Recommended solution:** Invert the gate — the taxonomy is driven by the IAE's input
  requirements, not lazy instantiation. Promote `data_classification` and `identity` into
  the S1/S2 taxonomy. Keep `network`/`geographic_location` deferred.
- **Blocks:** Yes — S4 design; forces an S1 taxonomy decision.

### AR-3 · Medium · Per-*signal* assessment granularity flattens a per-*entity* reality · fixable in S4
- **Why it matters:** One assessment row per (signal, org) with `affected_nodes JSONB`
  cannot answer "show every entity currently affected by an unresolved signal" without
  scanning JSONB. Blast radius is inherently per-affected-entity.
- **Impact:** The most valuable operational query (entity-centric exposure) is
  unindexable.
- **Recommended solution:** Normalize the blast radius into a queryable child table
  `applicability_affected_entities(assessment_id, node_type, node_id, contribution)`;
  keep the decision header in `applicability_assessments`.
- **Blocks:** No — but decide before S4 schema.

---

## Area 2 — Relationship Graph

### AR-4 · High · Read-time UNION over 6+ heterogeneous edges + first-ever recursive CTE is an unproven correctness bet · BLOCKS the S2 resolver
- **Why it matters:** The resolver (§5) unions `enterprise_relationships` with
  `dependencies`, `ai_system_vendor_dependencies`, four `signal_*_links`, and
  `risk_*_links` — different soft-delete columns, different semantics, different node-id
  domains. One `signal_*_links` endpoint is the **global org-NULL `cyber_signals`** row,
  so "org predicate at every level" (§14) must special-case signal nodes or silently drop
  them. §24 Q5 openly admits the authority-conflict rule (generic `depends_on` vs typed
  `ai_system_vendor_dependencies`) is **undecided** — shipping the resolver first ships a
  known-inconsistent read. Verified: **zero `WITH RECURSIVE` precedent** in the repo —
  first production recursive CTE, at enterprise graph sizes.
- **Impact:** Inconsistent/incorrect blast-radius reads (the core product output), plus an
  unproven traversal pattern at scale.
- **Recommended solution:** Resolve §24 Q5 (recommend: typed-edge-authoritative,
  generic-additive) **before** S2; load-test the CTE with realistic Fortune-500 fan-out;
  special-case global signal nodes explicitly; consider a materialized/denormalized
  adjacency table if traversal latency fails the test.
- **Blocks:** Yes — S2 resolver (S2 table can land first).

### AR-5 · Low · The typed-vs-generic split is otherwise correct
- The decision to keep `vendors`/`ai_systems`/typed edges authoritative and add a generic
  edge only for genuinely-new relationships is right and well-defended. No change. Future
  relationship types (temporal "was_dependent_on", weighted/probabilistic edges) are
  accommodated by adding `relationship_type` values + edge attributes — the model extends
  cleanly. **No block.**

---

## Area 3 — Applicability Engine

### AR-6 · High · Append-only + reassessment fan-out = write amplification on an unpartitioned hot table with no "latest" path · BLOCKS S4
- **Why it matters:** Growth is O(orgs × signals × edge-churn). One CMDB connector sync
  churning thousands of edges fires thousands of `reassessment` jobs (§16) → thousands of
  rows, each carrying four JSONB blobs + narrative. Indexed only on
  `(organization_id, signal_id)` (§9) with **no `is_latest` flag** — so "current
  applicability of signal X for org Y" sorts over all historical versions. No
  partitioning. §24 Q6 punts retention to "keep-all until measured"; at target scale
  that's measured in weeks.
- **Impact:** Table bloat, degrading "current state" reads, storage blow-up — on the
  subsystem's most-read table.
- **Recommended solution:** Add a latest-pointer (partial index on `is_current`),
  partition by org-hash or time, and define retention/archival **before** first write.
- **Blocks:** Yes — S4.

### AR-7 · Medium · Underengineered for novel signals; the rule corpus is an undesigned black box
- **Why it matters:** For genuinely novel signals the deterministic core returns
  `unknown`/`needs_review` and the LLM only narrates — the system is least useful exactly
  when intelligence value (novelty) is highest. Separately, the blueprint specifies
  nothing about how deterministic rules are *authored, tested, versioned, or governed*
  beyond an `engine_version` string. The rule corpus **is** the product quality.
- **Impact:** Ceiling on differentiation; ungoverned rule changes silently alter
  customer-facing risk decisions with no test harness or change-audit.
- **Recommended solution:** Keep deterministic-decision/LLM-narration as the *default* but
  define (a) an escalation path where the LLM *proposes* a decision that a human ratifies
  for novel classes (assisted, still explainable), and (b) a rule-authoring contract:
  rules as versioned, unit-tested data with golden-case regression and a change-audit. Do
  **not** let AI make the unratified decision.
- **Blocks:** No — but the rule-governance model should be designed before S4.

---

## Area 4 — Explainability & Legal Defensibility

### AR-8 · Critical · The evidence model is neither immutable nor reproducible nor queryable — it fails the stated "auditor/regulator/court" use case · BLOCKS S4/S5
- **Why it matters (three defects):**
  1. **Immutability is a convention, not a guarantee.** Nothing prevents UPDATE/DELETE on
     `applicability_assessments` — no FORCE RLS (all RLS is NOT FORCE + INERT, and
     owner/`pgElevated` bypasses it), no revoked DML, no append-only trigger. "Prove this
     decision was never altered" is unanswerable. §19's "the decision *is* the audit" is
     overstated.
  2. **By-reference evidence isn't reproducible.** `evidence_used` points at *mutable*
     rows via `{ref_table, ref_id}` (§7). Vendor criticality changes; edges soft-delete.
     The promise to "re-derive the 2026 decision years from now" (§7/§20) **fails** —
     pointers resolve to *today's* values. Only `reasoning_steps` stores inputs by value;
     the model is internally inconsistent about snapshot-vs-pointer.
  3. **JSONB evidence is hostile to audit queries.** "Every decision that used vendor X as
     evidence" = unindexed JSONB containment scan over an unbounded table.
- **Impact:** For Fortune 500 / government / critical infrastructure — the stated market —
  the explainability record is not legally defensible. This is the single biggest gap
  versus the strategic mandate.
- **Recommended solution:** (a) By-**value** evidence snapshots (capture evidence values at
  decision time, not pointers); (b) DB-enforced immutability (append-only trigger +
  revoked UPDATE/DELETE, or WORM storage) — designed to survive the eventual
  `app_request`/FORCE-RLS flip; (c) a tamper-evidence hash chain (or signing) over the
  decision record; (d) typed evidence child rows + GIN/FK indexing for audit queries and
  legal hold. Reproducibility requires the engine be able to replay `reasoning_steps`
  against snapshotted inputs and reach the identical decision.
- **Blocks:** Yes — S4 (write path) and S5 (surface).

---

## Area 5 — Workflow Model

### AR-9 · Medium · `applicability_assessments` and `signal_match_suggestions` risk becoming two parallel truths · fixable in S6
- **Why it matters:** Both are per-org, per-signal "does this apply?" records. The doc
  *adds* assessments **and** *extends* suggestions without defining their relationship —
  the exact duplication the blueprint elsewhere forbids. Plus the unreconciled
  `findings.source_type` `cyber_signal`-vs-`signal` split (§24 Q4) is live debt.
- **Impact:** Drift between the engine's decision and the human-review queue; contradictory
  customer-facing state.
- **Recommended solution:** Define the suggestion as the **human-review projection of an
  assessment** (one direction of truth): the engine writes the assessment; a suggestion is
  derived for the accept/dismiss surface and carries the `assessment_id`. Reconcile
  `source_type` in the same slice. Otherwise the workflow separation is correct — keep it.
- **Blocks:** No — resolve at S6 design.

---

## Area 6 — Enterprise Scale (50-user → Fortune 500 → government → critical infrastructure)

- **50-user orgs:** fine as drawn; the empty-graph problem (AR-13) actually bites *small*
  orgs hardest.
- **Fortune 500 / government / critical infrastructure:** the design does **not** hold
  without AR-1 (typed regulated attributes), AR-6/AR-12 (partitioning), AR-8 (defensible
  evidence), and — decisively — **AR-11 (the access model)**. See AR-11; it is the deepest
  scale collision and is entirely absent from the document.

---

## Area 7 — Multi-Tenant Design

### AR-10 · High · The single-poll `jobs` table is where this falls over first · BLOCKS S4
- **Why it matters:** The queue was sized for *rare, human-triggered* jobs. The IAE
  repurposes it for *machine-triggered per-signal × per-org fan-out*: 10k orgs × M
  signals/day × edge-churn → millions of jobs/day through one
  `UPDATE … WHERE job_type = ANY(...) AND ((status='queued' AND scheduled_for<=now()) OR
  (status='processing' AND locked_at<…)) ORDER BY scheduled_for FOR UPDATE SKIP LOCKED
  LIMIT 1`. The **OR'd status predicate defeats the `(status, scheduled_for)` index**
  (bitmap-OR + sort); every worker competes at the same `scheduled_for` head, so
  `SKIP LOCKED` walks locked tuples and contention rises with worker count. §15's
  "inherits all of it" is throughput-false — it inherits the mechanism, not the headroom.
- **Impact:** This bottleneck hits *before* entity volume or traversal cost. Missed/delayed
  applicability = stale customer risk state.
- **Recommended solution:** Before S4 — shard/partition the queue by org-hash, add a
  dedicated covering index for machine job_types, split machine jobs onto their own
  worker+table, and design real backpressure. Consider that per-signal fan-out to *all*
  orgs is wasteful; gate fan-out to orgs whose context could plausibly match (pre-filter).
- **Blocks:** Yes — S4.

### AR-11 · Critical · The flat tenant model collides with the org-structure the ECL introduces — no business-unit/department access scoping exists · BLOCKS the enterprise story
- **Why it matters:** `TENANT_ISOLATION_STANDARD` is explicitly flat: "one user, one org,
  no team-within-org, no nested tenant." Yet the ECL introduces `business_unit` and
  `department` as first-class entities. A Fortune 500 with tens of thousands of staff
  **cannot** give every user visibility into the entire org's risk posture; they require
  BU-scoped access, delegated administration, and segregation of duties *within* the org.
  The platform is modeling org structure as *data* while the authorization model remains
  flat and org-wide — and the standard currently *forbids* the sub-org scoping enterprises
  will demand. **Not mentioned in the document.**
- **Impact:** Either a tenant-model redesign (hierarchical/sub-org access) or a new
  row-level access layer scoped to `business_unit` — neither exists, and the governing
  standard prohibits it. Discovering this after ECL ships means re-architecting
  authorization on live enterprise data. Deepest architectural collision in the design.
- **Recommended solution:** Decide the sub-org access model *now*, as a governing-doc
  question, before modeling `business_unit`/`department`. Options: (a) keep BU/department
  as descriptive metadata only (no access semantics) and set that expectation explicitly;
  (b) design an additive per-BU access-scope layer (not nested tenancy — an intra-org RBAC
  dimension) and amend `TENANT_ISOLATION_STANDARD`. Do not model org structure as data
  while implying access semantics the platform can't enforce.
- **Blocks:** Yes — blocks modeling `business_unit`/`department` (S1 taxonomy) and the
  "enterprise" positioning.

### AR-12 · High · Index & partitioning strategy is under-specified for the growth horizon · BLOCKS S4
- Rolls up AR-6 + AR-10: no partitioning anywhere, single-column-pair indexes on the hot
  tables, JSONB where query predicates will land. **Recommended:** partition
  `applicability_assessments` (and the affected-entities child) and the machine `jobs`;
  covering/partial indexes for "current" reads; GIN only where JSONB containment is
  genuinely needed. Design before S4. **Blocks:** Yes — S4.

*(Positive: intra-org isolation via `organization_id NOT NULL` + per-query scoping + the R5
fan-out test pattern is correctly specified. The isolation model is right; the scale
substrate under it is not.)*

---

## Area 8 — Commercial Product Strategy

### AR-13 · High · The moat is real but contingent — and the design undermines its own differentiator via the empty-graph problem
- **Why it matters:** The incumbents each already own a piece: **ServiceNow GRC** has
  CMDB + CSDM (a mature entity+relationship graph); **Archer** has a deeply configurable
  data model; **OneTrust** owns data-mapping/data-inventory — the *exact*
  data-classification/data-store nodes this blueprint defers (AR-2);
  **AuditBoard/Hyperproof/LogicGate** are control-and-workflow centric. On a pure
  entity+relationship+workflow basis, this design does **not** differentiate — it partially
  re-implements ServiceNow CSDM and OneTrust data-mapping. **The genuine, durable moat is
  the one thing none of them do:** continuous *external* intelligence → per-customer
  *applicability* with an *audit-grade explainable blast radius*. That is defensible. But
  it is undermined by exactly the weak findings: without rich typed context (AR-1/AR-2) the
  blast radius is shallow, and without defensible evidence (AR-8) the explainability is not
  enterprise-grade — so the moat collapses into "another GRC graph."
- **The strategic trap the doc ignores — the empty CMDB.** ServiceNow's CSDM is a
  cautionary tale: a generic entity+relationship model that took years and armies of
  consultants to populate, and most customers never fully do. The IAE's differentiator
  *depends on customers populating context they historically refuse to enter by hand*. The
  "connectors deferred, manual-first" stance (AD-10) maximizes this risk.
- **Recommended solution:** (a) Lead the moat with external-signal applicability +
  defensible explainability, not the graph itself; (b) **mitigate the empty-graph problem**
  by seeding the graph from what the platform *already has* — the resolver's union of
  `vendors`/`ai_systems`/`dependencies` means the graph is *not* empty on day one (credit
  the design for this) — and prioritize a small number of high-yield connectors (identity +
  CMDB + cloud) *specifically as graph-population accelerants*, ahead of the general
  "connectors deferred" posture; (c) make defensible explainability (AR-8) the
  enterprise-tier headline capability.
- **Blocks:** No — but reframe positioning before build; treat AR-1/AR-2/AR-8 as
  moat-critical, not merely technical.

---

## Area 9 — Missing Enterprise Features

### AR-14 · High (aggregate) · Table-stakes enterprise capabilities are absent from the blueprint
Enterprise buyers (and their security reviews) will expect, and the document omits:
- **Sub-org RBAC / delegated administration / SoD** — see AR-11 (Critical).
- **SCIM provisioning / deprovisioning** — SSO JIT exists (seat-cap enforcement was
  shipped) but SCIM lifecycle is unaddressed; enterprises require it.
- **Data residency / sovereignty** — government and critical-infrastructure buyers require
  per-tenant region control; `render.yaml` pins regions globally, not per tenant.
- **Customer-managed keys / BYOK** — absent; expected in regulated procurement.
- **Audit-log export / SIEM streaming** — `security_audit_log` exists but no tenant-facing
  export/stream.
- **Legal hold / configurable retention** — collides with the append-only retention gap
  (AR-8, §24 Q6).
- **Custom fields / extensibility** — enterprises always demand them; ironically this is
  the *legitimate* use of `metadata JSONB` (tension with AR-1 — separate freeform custom
  fields from load-bearing typed attributes).
- **Maker-checker / approval workflows on context changes** — high-criticality entity edits
  should be approvable (the risk-lifecycle SoD pattern already exists to borrow).
- **Bulk/async API + per-tenant rate limits** — the current in-memory rate limiter is
  per-replica; enterprise API volume needs a real quota model.
- **Point-in-time / historical reporting** — "what did our posture look like at audit date
  X."
- **Recommended solution:** Add an explicit "Enterprise Readiness" section enumerating
  these as sequenced, mostly-post-foundation packages; resolve residency, sub-org RBAC, and
  retention *as design constraints now* because they are hard to retrofit.
- **Blocks:** RBAC/residency/retention decisions block the enterprise positioning; the rest
  are High/Medium backlog.

---

## Area 10 — Technical Debt

### AR-15 · High · Metering is sequenced one slice too late · BLOCKS S1
- **Why it matters:** Verified — `enforceEntityLimit` counts only `vendors + ai_systems`.
  ECL entities and every graph edge are **unmetered storage + unbounded traversal input**.
  The doc flags it (R-2) but sequences the fix at S3 (CSV import). Wrong slice: **S1 already
  opens the manual write path**, and IAE traversal cost (S4) scales with edge count.
  Metering gates S1's commercial safety, not S3's throughput.
- **Recommended solution:** Resolve §24 Q1 and land a metering/row-limit decision **in S1**,
  not S3.
- **Blocks:** Yes — S1.

**Debt roll-up:** *Overengineering* — 25-section blueprint pre-first-code is appropriate
given strategic weight; the entity taxonomy breadth is *not* overengineered (it's
under-instantiated, AR-2). *Underengineering* — evidence model (AR-8), queue (AR-10), rule
governance (AR-7), access model (AR-11). *Migration risk* — JSONB→typed retrofit (AR-1),
partitioning-after-the-fact (AR-6/12). *Governance gaps* — explainability standard,
feature-flag/rollback standard, sub-org access standard (AR-11 not flagged in the doc).
*Operational complexity* — first recursive CTE, first machine-scale queue use, first
append-only immutability requirement — three net-new operational patterns landing together
in S4/S5; stage them.

---

## F8 · Critical · The entitlement model cannot express "Enterprise-only" for a design whose entire pitch is the enterprise upsell
- **Why it matters:** `requireEntitlement` rank tops out, and Team / Platform /
  Platform-Annual / Enterprise all collapse to `premium`. There is **no gate dimension** to
  make ECL Enterprise-differentiated. If "Enterprise Context Layer" is the enterprise tier's
  differentiator, the commercial model is undefined at the exact point it matters — ECL would
  ship available to every Platform-Professional customer.
- **Recommended solution:** Introduce a capability/feature-entitlement dimension distinct
  from `requireEntitlement` rank (per-org capability grants that Enterprise contracts
  enable), orthogonal to the rank system; do not rename internal keys.
- **Blocks:** Yes — resolve before any build (S0 decision).

---

## Area 11 — Implementation Roadmap Critique

### AR-16 · The sequence is directionally right (foundation-before-engine) but front-loads write paths before their safety rails. Recommended resequencing:

| Change | Rationale |
|---|---|
| **New S0 (decisions, not just docs):** resolve metering (Q1, AR-15), sub-org access model (AR-11), Enterprise-vs-Platform gating (F8), criticality vocabulary (Q3). These are **prerequisites**, not parallel questions. | Four of them block S1; deciding them post-facto means migrating live data. |
| **Reshape S1:** ship the entity *header* + **one typed child (`data_store`)** to prove the typed-per-type pattern (AR-1), with metering in-slice (AR-15). Do **not** ship a generic `metadata`-JSONB-only entity. | Proves the load-bearing pattern before it's replicated across types. |
| **Pull `data_classification` + `identity` forward** into S1/S2 taxonomy (AR-2). | They are IAE inputs, not "later" types. |
| **Insert S3.5 — queue & partitioning spike** before S4: shard/partition design + covering index + load test at target fan-out (AR-10/AR-12). | The scale wall is in the queue, and it's cheap to design pre-code. |
| **Fold the evidence contract into S4, not S5:** by-value snapshots + DB-enforced immutability + hash chain must exist *when the first assessment is written* (AR-8). | You cannot retrofit immutability onto records already written mutably. |
| **Gate the S2 resolver on §24 Q5** + a recursive-CTE load test (AR-4). | Don't ship a known-inconsistent read. |
| **Keep S6/S7 (D6/D7) as drawn** — workflow-extension and dependency/reassessment sequencing is correct. | The anti-duplication workflow model is the blueprint's strongest part. |

---

## Consolidated blocker gate

| Must resolve before… | Findings |
|---|---|
| **Any build (S0 decisions)** | AR-11 (sub-org access), AR-15 (metering), F8 (gating), AR-2 (bring data-classification/identity into taxonomy) |
| **S1** | AR-1 (typed regulated attributes), AR-15 (metering in-slice), AR-11 (BU/department access semantics) |
| **S2 resolver** | AR-4 (§24 Q5 authority rule + CTE load test) |
| **S4** | AR-6/AR-12 (partitioning + latest-pointer), AR-10 (queue scale), AR-8 (evidence immutability/reproducibility — write path), AR-3 (blast-radius normalization), AR-7 (rule governance) |
| **S5** | AR-8 (defensible explainability surface) |
| **S6** | AR-9 (assessment/suggestion truth model + `source_type` reconciliation) |

**Non-blocking / accept:** AR-5 (typed-vs-generic split is right), doc-accuracy nits (RLS
"~22" → ≥27; verified current-state claims otherwise accurate).

---

## Verdict

Ratify the **framing** (connective tissue over existing canonical objects; extend the
matcher; don't duplicate). **Do not authorize Slice 1** until the four Critical findings
(AR-1, AR-8, AR-11, and the gating finding F8, plus the S1-blocking metering finding AR-15)
are resolved, and do not authorize S4/S5 until the queue, partitioning, and
evidence-immutability designs exist. The blueprint successfully avoids the obvious mistake
(rebuilding what exists); this review's job was to catch the non-obvious ones, and the
load-bearing three — **the new entities' typed model, the legal-defensibility contract, and
the enterprise access collision** — would each force a redesign of the strategic core if
built as drawn.
