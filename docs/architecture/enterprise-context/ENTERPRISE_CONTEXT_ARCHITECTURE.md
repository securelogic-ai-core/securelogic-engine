# Enterprise Context Architecture

> **Version 2 (post-review). Status: ARCHITECTURE DRAFT — FOR REVIEW.** DOCS-ONLY. This
> document authorizes **no** schema, migration, route, worker, SQL, or application code.
> It is the design blueprint for the Enterprise Context Layer (ECL), the Enterprise
> Relationship Graph, the Intelligent Applicability Engine (IAE), the Explainability
> Engine, and the Automated Workflow Engine. Nothing here is built until Priority 4
> completes and the operator authorizes a specific slice.
>
> **What changed in v2:** every **Critical** and **High** finding from
> `ARCHITECTURE_REVIEW.md` is now part of the architecture, not an appended note. The
> load-bearing changes are: (1) a **typed per-type entity model** replacing the
> generic-blob entity (AR-1); (2) a **by-value, immutable, hash-chained, reproducible
> evidence contract** (AR-8); (3) an explicit **intra-org access-scope model** resolving
> the flat-tenant collision (AR-11); (4) a **capability-based Enterprise gate** distinct
> from entitlement rank (F8); (5) **metering moved into S1** (AR-15); (6) a **dedicated,
> sharded applicability queue with fan-out pre-filtering** (AR-10/AR-12); (7)
> **partitioning + latest-pointer + normalized blast radius** on the decision store
> (AR-6/AR-3); (8) a **resolver-authority rule + materialized-adjacency fallback** for the
> graph (AR-4); (9) **data-classification and identity promoted into the taxonomy** as IAE
> inputs (AR-2); (10) the moat reframed around applicability + defensible explainability
> with an empty-graph mitigation (AR-13); and (11) an **Enterprise Readiness** section
> (AR-14). See "Resolved Review Findings" at the end for the full mapping.
>
> **Evidence labels:** **VERIFIED** = read in the repo · **RECOMMENDED** = proposed, not
> built · **DEFERRED** = out of scope for the current sequence. Architecture decisions are
> numbered **AD-n**. **Architectural Decision** call-outs marked *(resolves AR-x)* record
> where a review finding became design.

---

## 1. Executive architecture assessment

SecureLogic AI already contains, in working code, the skeleton of an applicability
engine. The `runMatcherForSignal` core (`src/api/lib/cyberSignalProcessingService.ts`)
takes a global signal, matches it against a single org's vendors / AI systems /
obligations, and already writes findings, flags risk exposure, and drafts remediation
actions. What it cannot do is the thing the mission asks for: **explain, in
organizational terms, why a signal matters — which business services, applications,
owners, data stores, and downstream (fourth-party) dependencies are in the blast radius —
and record that reasoning durably and defensibly enough that an auditor, a regulator, or
a court can trust it.** That gap is not a missing engine. It is a missing typed **context
model** for the engine to reason over, plus a missing **legally defensible decision
record** to make the reasoning explainable.

This blueprint therefore rejects "build a new intelligence subsystem beside the
platform." The correct framing is: **give the existing matcher a typed organizational
context graph to reason over, promote its implicit decisions into an explicit, immutable,
reproducible, explainable decision record, and route the consequences through the
workflow surfaces that already exist** (findings, `signal_match_suggestions`, the
`actions` engine, the `jobs` queue, the coalescing alert batcher). Every one of those is
already built and tenant-isolated. The differentiator is the reasoning layer and its
explainability contract — not a new database.

**Where the durable moat actually is (AR-13).** On a pure entity + relationship + workflow
basis, this design does *not* out-differentiate ServiceNow GRC (CMDB/CSDM), Archer,
OneTrust (data-mapping), AuditBoard, Hyperproof, or LogicGate — several already ship a
mature entity+relationship graph. The one capability none of them combine is **continuous
external intelligence → per-customer applicability with an audit-grade explainable blast
radius.** That is the moat. It is *contingent*: without rich **typed** context (§4) the
blast radius is shallow, and without **defensible** evidence (§7) the explainability is
not enterprise-grade. So the typed entity model and the evidence contract are not merely
technical hardening — they are moat-critical, and are treated as such in v2.

**The empty-graph risk, stated plainly (AR-13).** The IAE's value depends on customers
populating context they historically refuse to enter by hand (the "empty CMDB" that has
haunted every GRC/CMDB product). v2 mitigates this two ways: the graph resolver (§5)
*unions the context the platform already holds* (`vendors`, `ai_systems`, `dependencies`),
so the graph is non-empty on day one; and connector sequencing (§11) is reordered to lead
with identity + CMDB + cloud specifically as **population accelerants**.

**Verdict:** proceed — narrower, more typed, and more defensible than the v1 draft. Build
the context graph as *typed connective tissue over existing canonical objects*; build the
applicability engine as an *immutable, reproducible decision record* over the existing
matcher; and resolve the enterprise access and gating collisions *before* the first slice.

---

## 2. Current-state analysis (VERIFIED)

### 2.1 What already exists and is load-bearing

| Capability | Where | State |
|---|---|---|
| Global signal ingestion | `cyber_signals` (global, `organization_id` NULL for public rows), 6 RSS + 7 API adapters, `dedup_hash` + INERT `cluster_key` | VERIFIED live |
| Signal→entity matcher | `runMatcherForSignal` (3 sync invocation paths: brief scheduler, hourly worker, KEV poller); strictly per-org | VERIFIED live |
| Matcher targets | vendors, ai_systems (canonical-exact), obligations (`regulatory_change`, family-scored). Controls only via flag-gated LLM matcher. | VERIFIED |
| Per-org applicability queue | `signal_match_suggestions` (per-org, polymorphic `target_type ∈ {vendor,ai_system,control,obligation}`, `match_score` 0–100, 3-state accept/dismiss) | VERIFIED |
| Committed links | `signal_vendor_links`, `signal_ai_system_links`, `signal_control_links`, `signal_obligation_links` (real FKs, soft-delete) | VERIFIED |
| Signal→finding | matcher inserts `findings` with `source_type='cyber_signal'` (unconditional on entity match) | VERIFIED |
| Signal→risk | matcher `UPDATE risks SET exposure_flagged=TRUE` (unconditional; one-directional, never reset) | VERIFIED |
| Signal→action | GAP-3 engine: finding→action, risk→action, obligation→action; idempotent via partial unique indexes; flag `SECURELOGIC_ACTION_ENGINE_ENABLED` | VERIFIED |
| Scoring | pure V2 engines (`src/engine/scoring/v2/`) + live `postureComputation.ts`; posture overall NULL (not 0) on zero findings | VERIFIED |
| Notifications | per-finding `triggerFindingAlert` (wired) + `createAlertBatcher` coalescing service (**built, no production producer wired**) | VERIFIED |
| Background jobs | `jobs` table, `pgElevated`-poll + `withTenant`-execute, `FOR UPDATE SKIP LOCKED`, retry/backoff/dead-letter | VERIFIED |
| Metering | `enforceEntityLimit` counts **exactly `vendors + ai_systems`** vs `organizations.max_monitored_entities` | VERIFIED (`src/api/lib/entityLimit.ts:44-49`) |
| Tenant runtime | `pg` / `pgElevated` / `withTenant` / `asTenant`; RLS on **≥27 tables** but INERT (owner cred, NOT FORCE) | VERIFIED (v1's "~22" was an undercount) |
| Recursive traversal | **none** — zero `WITH RECURSIVE` in the repo today | VERIFIED |

### 2.2 What the prompt's entity list maps to (VERIFIED)

| Prompt entity | Existing home | Action |
|---|---|---|
| Vendors | `vendors` | **Keep as-is.** Do not migrate. |
| AI Systems | `ai_systems` | **Keep as-is.** Do not migrate. |
| Third Parties | `vendors` | **Already exists.** Do not create. |
| Owners | `users` (`owner_user_id` FK everywhere) | **Already exists.** Do not create an `owners` table. |
| Fourth Parties | `dependencies` (→`vendors`) | Partial; extend the existing nth-party edge. |
| Data Stores, Applications, Assets, Business Services, Business Units, Departments, **Data Classifications, Identities** | none | **Genuinely new** → ECL (typed model, §4). Data-classification + identity promoted per AR-2. |
| Cloud Resources, Networks, Geographic Locations | partial / none | **DEFERRED** until an IAE consumer requires them. |

### 2.3 Existing edges the graph must NOT duplicate (VERIFIED)

`signal_vendor_links`, `signal_ai_system_links`, `signal_control_links`,
`signal_obligation_links`, `risk_control_links`, `risk_obligation_links`,
`ai_system_vendor_dependencies` (9 `dependency_role`s), `dependencies`→`vendors`,
`control_mappings`, `obligation_mappings`, `signal_match_suggestions`. Each carries real
semantics; a generic edge table that *replaced* these would flatten it and force a risky
backfill.

### 2.4 Honest gaps (VERIFIED)

No signal/finding→risk *creation* (only `exposure_flagged`); actions one-directional; no
blast-radius reasoning (relationships not modeled); no stored decision record; vocabulary
splits (`cyber_signal` vs `signal`; criticality casing).

---

## 3. Recommended future-state architecture (v2)

```
  Enterprise Context Layer (NEW)     enterprise_entities  HEADER
        │                              └─ typed child tables per load-bearing type
        │                                 (enterprise_data_stores, …)      ← AR-1
        ▼
  Enterprise Relationship Graph (NEW)  enterprise_relationships (generic, additive)
        │   read-time resolver: typed-edge-AUTHORITATIVE, generic-ADDITIVE   ← AR-4
        │   + materialized adjacency fallback if CTE latency fails load test
        ▼
  Intelligent Applicability Engine     pure reasoning engine (like scoring/v2)
        │   fan-out PRE-FILTERED to plausibly-affected orgs                  ← AR-10
        ▼
  Explainability / decision record     applicability_assessments  (HEADER, immutable)
        │   ├─ applicability_evidence         (by-VALUE snapshots, typed)    ← AR-8
        │   ├─ applicability_affected_entities (normalized blast radius)     ← AR-3
        │   ├─ content_hash + prev_hash chain (tamper-evidence)             ← AR-8
        │   partitioned + is_current latest-pointer                          ← AR-6/AR-12
        ▼
  Automated Workflow Engine (EXTEND)   findings · signal_match_suggestions · actions · alerts
                (suggestion = human-review projection of the assessment)     ← AR-9

  Cross-cutting: intra-org ACCESS-SCOPE model (BU/department)                ← AR-11
                 capability-based ENTERPRISE gate (orthogonal to rank)       ← F8
                 dedicated, sharded APPLICABILITY QUEUE + worker             ← AR-10
```

**Load-bearing principle (unchanged):** the ECL and graph are *inputs* to reasoning. The
applicability assessment is the *only new source of truth*. Everything downstream stays in
its existing canonical home. This honors the ratified **D1** ("outputs consume, they don't
define") while the immutable decision record satisfies the explainability mandate.

---

## 4. Enterprise Context architecture

### AD-1 (revised) — `enterprise_entities` is a shared HEADER with typed per-type child tables. It is not a generic blob.

- **`enterprise_entities` header** (org-scoped, `organization_id UUID NOT NULL REFERENCES
  organizations(id)`, RLS-ready): the columns common to *every* context type —
  `entity_type` (controlled enum), `name`, `description`, `owner_user_id → users`,
  `status`, `criticality`, `confidence`, `source_type`/`source_id`, `provenance`,
  `external_ref`, `created_at`/`updated_at`.
- **Typed child table per load-bearing type** holding the type-specific, compliance-
  relevant, queryable attributes. Slice-1 ships the header + **one** child:
  `enterprise_data_stores` (`data_classification`, `residency_region`,
  `retention_policy`, `encryption_at_rest`, …) — the most regulator-load-bearing type.
  Later children: `enterprise_assets` (hostname/ip/os), `enterprise_business_services`
  (rto/rpo/service_tier), `enterprise_identities`.
- **`metadata JSONB` is restricted to genuinely-freeform customer custom fields**
  (AR-14's legitimate custom-field surface) — **never** compliance-load-bearing
  attributes. A load-bearing attribute lives in a typed column.

> **Architectural Decision — typed entity model** *(resolves AR-1, Critical)*
> - **Problem:** a single generic table pushed every type-specific, regulator-relevant
>   attribute (data classification, residency, retention, RTO/RPO, host/OS) into an
>   unvalidated, unindexed `metadata JSONB` blob — the exact "canonical object as a blob"
>   anti-pattern the platform forbids, and the fields a blast-radius query most needs.
> - **Chosen solution:** class-table-inheritance — a shared `enterprise_entities` header
>   plus a typed child table per load-bearing type; JSONB demoted to freeform custom
>   fields only. S1 proves the pattern with one child (`data_stores`) before it is
>   replicated.
> - **Why over alternatives:** *Pure single-table* (v1) is unconstrained and unqueryable
>   on the load-bearing fields. *One flat table per type with no shared header* loses the
>   uniform ownership/provenance/graph-node surface and forces N-way UNIONs everywhere.
>   *EAV* is worse on every axis. Header+children keeps a single node identity for the
>   graph while giving each type real, indexed, constrained columns.

### AD-1a — Taxonomy is driven by the IAE's input requirements, not lazy instantiation.

Slice-1/2 controlled `entity_type` taxonomy: `data_store`, `application`, `asset`,
`business_service`, `business_unit`, `department`, **`data_classification`**,
**`identity`**. `vendor`/`ai_system` are **not** valid types (they own their tables and
are *referenced*, never copied — AD-6). `network`, `geographic_location`,
`cloud_resource`, `fourth_party` remain **DEFERRED** until a consumer requires them.

> **Architectural Decision — promote data-classification & identity** *(resolves AR-2, High)*
> - **Problem:** v1 deferred `data_classification` and identity "until a consumer exists,"
>   but the IAE — in the same blueprint — *is* that consumer: no regulatory blast radius
>   without data-classification/residency nodes, no cyber blast radius without identity
>   nodes.
> - **Chosen solution:** invert the gate — the taxonomy is driven by the IAE's declared
>   inputs; `data_classification` and `identity` are first-class from S1/S2.
> - **Why over alternatives:** lazy instantiation would force an emergency taxonomy
>   expansion mid-sequence (schema churn on a live table) precisely when the flagship
>   engine ships. Promoting only the two engine-critical types (not all deferred types)
>   avoids the opposite error of over-instantiation (AR-5 stays respected).

### AD-2 — No backfill, no dual-write (matches BUILD_SEQUENCE Slice-1 approval)

Existing `vendors`/`ai_systems` rows stay put. `enterprise_entities` starts empty and
fills via manual entry / CSV / connectors. Read-surface unification is a separate later
decision.

### AD-1b — Metering lands in S1, decoupled from `max_monitored_entities`.

> **Architectural Decision — metering in S1** *(resolves AR-15, High)*
> - **Problem:** `enforceEntityLimit` counts only `vendors + ai_systems`, so ECL entities
>   and graph edges are unmetered storage *and* unbounded traversal input. S1 already opens
>   the manual write path, so deferring metering to S3 (CSV) leaves S1 commercially unsafe.
> - **Chosen solution:** a per-org row cap on `enterprise_entities` (+ a companion edge cap)
>   enforced at write time in S1, **decoupled** from `max_monitored_entities` (BUILD_SEQUENCE
>   explicitly excludes ECL entities from that counter). The cap *value* is derived from the
>   org's capability grant (AD-17); the exact numbers remain an operator decision (§24 Q1),
>   but the *mechanism* ships in S1.
> - **Why over alternatives:** folding ECL into `max_monitored_entities` would silently
>   consume the vendor/AI cap and break existing commercial expectations; leaving it
>   unmetered (v1) invites unbounded storage and traversal-cost blowups. A separate,
>   tier-derived cap enforced at the write path is the minimal safe mechanism.

---

## 5. Enterprise Relationship Graph

### AD-3 — A generic edge table for *new* relationships; the resolver UNIONS existing typed edges but never replaces them.

`enterprise_relationships` (org-scoped, polymorphic `from_type/from_id/to_type/to_id`,
controlled `relationship_type`, soft-delete). Endpoints may reference either
`enterprise_entities` or existing canonical tables (`vendor`, `ai_system`, `user`). Both
endpoints get the §12 same-org pre-flight; cross-org edges are structurally forbidden.

### AD-4 — Postgres, not a graph database (unchanged)

Adjacency edges + bounded recursive CTEs. Shallow traversals (2–4 hops); a second
datastore would add an un-isolated consistency domain and ops burden for no benefit.

### AD-13 — Resolver authority is fixed, global signal nodes are special-cased, and a materialized-adjacency fallback is designed in.

> **Architectural Decision — resolver correctness** *(resolves AR-4, High)*
> - **Problem:** the read-time UNION spans 6+ heterogeneous edges with different
>   soft-delete columns, semantics, and node-id domains; one `signal_*_links` endpoint is
>   the **global org-NULL `cyber_signals`** row; the authority rule for a generic
>   `depends_on` vs a typed `ai_system_vendor_dependencies` was undecided (v1 §24 Q5); and
>   the repo has **zero** recursive-CTE precedent — so v1 would ship a possibly-inconsistent,
>   unproven read at the core of the product.
> - **Chosen solution:** (1) **typed-edge-authoritative, generic-additive** — when a generic
>   edge contradicts a typed edge, the typed edge wins; the generic edge may only *add*
>   relationships the typed edges don't express. (2) **Global signal nodes are special-cased**
>   in traversal: a `cyber_signals` endpoint is matched by `organization_id = $org OR
>   organization_id IS NULL` (the existing global-signal asymmetry), never dropped by a bare
>   org predicate. (3) **Bounded** recursive CTE (default depth 4, visited-set,
>   per-level org predicate) is gated behind a **load test at realistic Fortune-500 fan-out**;
>   if it fails interactive latency, the fallback is a **maintained materialized adjacency /
>   closure table** refreshed on edge mutation.
> - **Why over alternatives:** *generic-authoritative* would let unverified manual edges
>   override curated typed semantics. *Dropping signal nodes* would silently truncate the
>   blast radius. *Committing to recursive CTE with no fallback* bets the core read path on an
>   unproven pattern; designing the materialized fallback now makes the scale risk a
>   configuration choice, not a redesign.

Future relationship types (temporal `was_dependent_on`, weighted/probabilistic edges) are
accommodated by adding `relationship_type` values + edge attributes — the model extends
cleanly (AR-5 accepted).

---

## 6. Intelligent Applicability Engine (IAE)

### AD-5 — The IAE is a *pure* reasoning engine (I/O-free, like `scoring/v2`) consuming matcher output + the graph. It does not re-implement matching.

Decision enum: `affected`, `potentially_affected`, `not_affected`, `needs_review`,
`unknown`, each with numeric `confidence` (0–100) + band. **Deterministic first, LLM
second** — the decision is produced by explicit rules over structured inputs; an LLM may
only *narrate* it (§7).

**Blast radius is the differentiator.** Once a signal matches a vendor/AI system, the IAE
walks `enterprise_relationships` outward to the affected applications / services / business
units / owners / data stores — the answer the flat matcher cannot give. This is why the
typed ECL + graph ship before the engine.

### AD-6 — `EnrichedSignal` stays a projection (ratified D1); the *decision* is the new source of truth.

The enriched *view* is assembled from `cyber_signals` + `signal_match_suggestions` +
links. The *applicability decision* is genuinely new truth, so it earns a table
(`applicability_assessments`). No contradiction.

### AD-14 — Fan-out is pre-filtered to plausibly-affected orgs, on a dedicated queue.

> **Architectural Decision — fan-out pre-filter** *(resolves AR-10, High — engine half)*
> - **Problem:** naive per-signal × per-org fan-out to *all* orgs (v1 §16) is millions of
>   jobs/day at 10k orgs, most of which the signal cannot possibly affect.
> - **Chosen solution:** the matcher already computes per-org candidate matches; **only orgs
>   with at least one candidate match (or a graph path to one) are enqueued** for
>   applicability assessment. Reassessment jobs are similarly scoped to orgs whose changed
>   edges touch a matched entity.
> - **Why over alternatives:** fanning out to all orgs wastes the majority of queue capacity
>   and worker time; the matcher's existing per-org candidate computation makes the pre-filter
>   nearly free. (Queue *substrate* changes are AD-19 in §17.)

### AD-7-support — Rule governance is a first-class design concern.

> **Architectural Decision — rule corpus governance** *(resolves AR-7, Medium — folded early)*
> - **Problem:** v1 specified nothing about how deterministic rules are authored, tested, or
>   versioned beyond an `engine_version` string, yet the rule corpus *is* the product
>   quality; and for genuinely novel signals the engine is least useful exactly when
>   intelligence value is highest.
> - **Chosen solution:** rules are versioned, unit-tested data with a golden-case regression
>   suite and a change-audit; `engine_version` pins the corpus that produced each decision.
>   For novel classes, the LLM may *propose* a decision that a human *ratifies* — assisted,
>   still explainable — never an unratified AI decision.
> - **Why over alternatives:** ungoverned rules silently alter customer-facing risk;
>   LLM-as-decider is unreproducible and indefensible. Deterministic-core + governed rules +
>   human-ratified novelty is the only combination that stays auditable.

---

## 7. Explainability Engine

The governing docs are silent on explainability storage (§24). This is the contract that
fills the gap and makes the record defensible to an auditor, a regulator, and a court.

### AD-7 (revised) — Structured, deterministic-first explanation; JSONB only for narration.

`applicability_assessments` (header) carries `decision`, `confidence`, `confidence_band`,
`reasoning_steps` (ordered deterministic rule trace by value), `narrative TEXT NULL`
(optional, per-org, fallback-safe LLM prose — a *rendering* of the structured reasoning,
never the source), `schema_version`, `engine_version`, `content_hash`, `prev_hash`,
`is_current`, `created_at`.

### AD-16 — Evidence is by-value, immutable, hash-chained, reproducible, and queryable.

> **Architectural Decision — defensible evidence contract** *(resolves AR-8, Critical)*
> - **Problem:** v1's evidence model failed the stated auditor/regulator/court use case on
>   three counts: (1) immutability was an unenforced *convention* (nothing blocked
>   UPDATE/DELETE; RLS is INERT and owner-bypassed); (2) evidence was stored *by reference*
>   to mutable rows, so "re-derive the 2026 decision" resolved to *today's* values —
>   non-reproducible; (3) JSONB evidence was unqueryable for audit ("every decision that
>   used vendor X").
> - **Chosen solution:**
>   1. **By-value snapshots** — a typed `applicability_evidence(assessment_id, evidence_type,
>      ref_table, ref_id, captured_value, weight)` child table stores the evidence *value at
>      decision time* alongside the pointer, with FK + targeted indexes for audit queries.
>   2. **DB-enforced immutability** — `applicability_assessments` and its children are
>      append-only: UPDATE/DELETE revoked + an append-only trigger, designed to hold *through*
>      the eventual `app_request`/FORCE-RLS flip (so it survives even elevated access).
>   3. **Tamper-evidence hash chain** — each decision carries `content_hash` over its
>      canonical content and `prev_hash` linking the org's decision sequence, so any
>      alteration or deletion is detectable; optional signing for higher assurance.
>   4. **Reproducibility** — the engine can replay `reasoning_steps` against the snapshotted
>      evidence values and reach the identical decision; `engine_version` + `schema_version`
>      pin the logic and shape.
>   5. **Normalized blast radius** — affected entities are a queryable child table (AD-15),
>      not a JSONB blob.
> - **Why over alternatives:** *convention-only append-only* cannot answer "prove it was
>   never altered." *Pointer-only evidence* is not reproducible. *JSONB-only* is not
>   auditable at query time. By-value + WORM + hash chain is the standard evidentiary pattern
>   for records that must survive legal scrutiny; typed child rows make it queryable and
>   support legal hold (§ Enterprise Readiness).

> **S4b as-built reconciliation (2026-07-03).** When Slice 4b built the three persistence
> tables, two statements in this document were found to conflict with 4b's own constraints
> and were reconciled (architect-reviewed) as follows — the tables as shipped are canonical:
> 1. **Non-partitioned at creation.** "Partition … established at table creation" (§ Enterprise
>    Readiness / L636-era) contradicts the **S3.5 gate** (a partitioning spike with load-test/
>    EXPLAIN data *before* S4 writes anything). Partitioning is a *scale* optimization, not an
>    evidentiary property (the AR-8/AD-16 defensibility is by-value + WORM + hash chain +
>    reproducibility, all preserved). The tables are empty through 4b and until the 4c writer, so
>    the convert-while-empty window is preserved; **the partition decision is deferred to S3.5
>    completion, before the first write.** (There is also zero partitioning precedent in the repo.)
> 2. **No `is_current` column.** AD-7-revised lists `is_current` on the header, but a mutable flag
>    **cannot coexist with WORM** (flipping a prior row true→false is a forbidden UPDATE). "Current"
>    is instead **derived** — the newest row per `(organization_id, signal_id, target_type, target_id)`
>    via a `created_at DESC` index. If that read ever profiles hot, the escape hatch is a separate,
>    non-WORM pointer table upserted by the worker — never a mutable column on the append-only record.
>
> Immutability is enforced by a `BEFORE UPDATE/DELETE` + `BEFORE TRUNCATE` **trigger** (fires
> regardless of role → survives the app_request/FORCE-RLS flip, unlike RLS), plus a REVOKE-of-DML
> grant (app_request gets SELECT,INSERT only) as defense-in-depth. The hash chain is fork-proofed by
> `UNIQUE (organization_id, prev_hash)`; the pure canonical-hash helper lives at
> `src/engine/applicability/v1/contentHash.ts` (write-time wiring is 4c).

---

## 8. Automated Workflow Engine

### AD-8 — Extend the four existing workflow surfaces; build no parallel workflow store.

Finding (extend `findings`, reconcile `source_type`), suggestion (extend
`signal_match_suggestions.target_type` with `enterprise_entity` and, per ratified D6,
`dependency`), task (reuse the GAP-3 `actions` pattern), notification (wire
`createAlertBatcher` as the first production producer), executive metric (feed posture +
`findings/summary`).

### AD-9 — Risk *creation* stays human/lifecycle-gated. The engine suggests, flags, drafts — it does not auto-open or auto-transition risks (collision with `risk-lifecycle-spec.md` SoD).

### AD-8a — The suggestion is the human-review projection of the assessment (one direction of truth).

> **Architectural Decision — assessment/suggestion truth model** *(resolves AR-9, Medium)*
> - **Problem:** `applicability_assessments` and `signal_match_suggestions` are both per-org,
>   per-signal "does this apply?" records; adding one while extending the other risks two
>   parallel truths — the duplication the blueprint elsewhere forbids.
> - **Chosen solution:** the engine writes the **assessment** (source of truth); a
>   **suggestion** is a *derived projection* for the human accept/dismiss surface and carries
>   `assessment_id`. Reconcile the `findings.source_type` `cyber_signal`/`signal` split in the
>   same slice.
> - **Why over alternatives:** letting the two tables accrue independent state guarantees
>   drift and contradictory customer-facing views. A derived projection keeps a single
>   authority while preserving the existing, well-tested accept/dismiss UX.

---

## 9. Canonical data model (RECOMMENDED — for `CANONICAL_DOMAIN_MODEL.md` registration *when built*; not modified by this doc)

New objects (all `organization_id NOT NULL`, RLS-ready, standard timestamps):

1. **`enterprise_entities`** (header) + **typed child tables** (`enterprise_data_stores`
   first; `enterprise_assets`, `enterprise_business_services`, `enterprise_identities`
   later) — AD-1.
2. **`enterprise_relationships`** — generic additive edge; typed edges remain authoritative
   (AD-3/AD-13).
3. **`applicability_assessments`** (append-only, partitioned, `is_current`, `content_hash`,
   `prev_hash`, `schema_version`, `engine_version`) + **`applicability_evidence`** (by-value
   snapshots) + **`applicability_affected_entities`** (normalized blast radius) — AD-15/AD-16.
4. **Extensions (later slices):** `signal_match_suggestions.target_type` gains
   `enterprise_entity` (+ `dependency` per D6); `evidence.source_type` and
   `findings.source_type` gain `enterprise_entity`.
5. **Access-scope** objects (§13, AD-18) and **capability-grant** objects (§10, AD-17) —
   sequenced as governed enhancements.

**Vocabulary reconciliations (decided in v2):** criticality vocabulary → **lowercase**
(consistency with the entity peers it sits beside; §24 Q3 resolved); `cyber_signal`/`signal`
`source_type` → reconciled in the workflow slice (S6).

---

## 10. API strategy

- Reuse the mandatory chain unchanged: `requireApiKey → attachOrganizationContext →
  requireEntitlement(<level>) → asTenant(handler)`; hand-written per-domain validators.
- Route families: `enterpriseEntities`, `enterpriseRelationships`, `enterpriseGraph`
  (read-only bounded traversal), `applicabilityAssessments` (read-only explainability
  surface). All `organization_id` from `req.organizationContext`; every reference gets the
  §12 same-org pre-flight.
- **Enterprise gating (F8, Critical) — a capability dimension orthogonal to entitlement rank.**

> **Architectural Decision — capability-based Enterprise gate** *(resolves F8, Critical)*
> - **Problem:** `requireEntitlement` rank collapses Team / Platform / Platform-Annual /
>   Enterprise all to `premium` (rank 4). There is **no** way to gate an Enterprise-only
>   capability against Platform Professional — yet ECL is pitched as the enterprise
>   differentiator, so v1 would ship it to every Platform customer.
> - **Chosen solution:** introduce an **org-level capability grant** (e.g. an
>   `enterprise_context` capability on the organization) checked *in addition to* the
>   entitlement rank — a new authorization dimension, not a change to the rank system.
>   Enterprise contracts enable the grant; combined with the global
>   `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED` flag it gives per-org Enterprise
>   differentiation. **Internal Stripe/entitlement keys are not renamed** (governing rule).
> - **Why over alternatives:** adding new entitlement ranks would ripple through Stripe
>   metadata, env vars, and every gate (high blast radius, explicitly discouraged);
>   overloading the flag alone can't express per-org grants. A separate capability dimension
>   is additive and leaves the rank system untouched. *(Requires a governing-doc note — see
>   §24; not made here.)*

---

## 11. Integration strategy (connectors)

### AD-10 (revised) — Design the connector *contract* now; build zero connectors now — but sequence identity + CMDB + cloud FIRST as graph-population accelerants.

Every connector (ServiceNow CMDB, Defender, CrowdStrike, Tenable, Rapid7, Wiz,
AWS/Azure/GCP, Jamf, Intune, CSV, spreadsheet, manual) normalizes into the **same**
`enterprise_entities` header + typed children + `enterprise_relationships` shape — no
connector-specific tables or paths. A `RawEntityItem → NormalizedEntity` staging contract
(analogous to `contracts.ts`) carries `provenance = connector:<name>` + `schema_version`.

> **Architectural Decision — population-first connector order** *(resolves AR-13, High — empty-graph half)*
> - **Problem:** the IAE's value depends on a populated graph, but enterprises historically
>   refuse to hand-enter context (the empty-CMDB failure that has sunk GRC/CMDB products).
>   v1's flat "connectors deferred, manual-first" posture maximized this risk.
> - **Chosen solution:** keep connectors *deferred as build*, but when they are built,
>   **sequence identity + CMDB + cloud first**, explicitly as population accelerants; and rely
>   on the resolver (§5) to seed the graph from existing `vendors`/`ai_systems`/`dependencies`
>   so it is non-empty on day one even with zero connectors.
> - **Why over alternatives:** manual-only guarantees a sparse graph and a hollow engine;
>   building all connectors up front violates the "no integration required" principle and the
>   slice discipline. Seeding from owned data + a prioritized population-connector order gets
>   value at "no integrations" while accelerating the graph where it matters most.

CSV/manual remains first-class (S1 manual, S3 CSV with the AD-1b row-limit). Connectors
upsert on `(organization_id, provenance, external_ref)`; provenance-precedence rules are
per-connector.

---

## 12. Security architecture

Tenant isolation (TENANT_ISOLATION_STANDARD wins): every new table `organization_id NOT
NULL` + org index; every query scoped from `req.organizationContext`; two-endpoint same-org
pre-flight on every polymorphic reference (`from_id`/`to_id`/`source_id`/`ref_id`); RLS
policy shipped per table with the NULLIF cast, INERT until the A04-G1 flip (not the live
defense). **Immutability (AD-16)** — decision + evidence tables are WORM via revoked DML +
append-only trigger, designed to hold through the FORCE-RLS flip. **LLM narration** —
single-org context, never cross-batched, persisted same-org, logged (org + model id +
prompt-hash); untrusted `raw_payload`/entity text treated as data, never instructions; the
deterministic decision never depends on LLM output. **Audit** — every mutation
`writeAuditEvent`. **SSRF** — connectors reuse the pinned-agent egress controls.

---

## 13. Multi-tenant strategy

Tenant unit remains `organizations.id`; no nested tenants. Global-in / per-org-out is
preserved (the IAE runs per-org inside `withTenant`, writing only per-org rows; extend
`test/isolation/r5PipelineIsolation.test.ts`).

### AD-18 — Intra-org access-scope: business_unit/department are descriptive-only in the foundation; a governed access-scope layer is designed as a sequenced enhancement.

> **Architectural Decision — sub-org access model** *(resolves AR-11, Critical)*
> - **Problem:** the tenant model is explicitly flat ("one user, one org, no team-within-org,
>   no nested tenant"), yet the ECL introduces `business_unit`/`department` as entities.
>   Fortune 500 / government orgs cannot give every user org-wide visibility; they require
>   BU-scoped access, delegated admin, and SoD *within* the org — which the standard currently
>   forbids. Modeling org structure as data while implying access semantics the platform can't
>   enforce is the deepest collision in the design, and v1 didn't mention it.
> - **Chosen solution:** two-phase. **Foundation:** `business_unit`/`department` are
>   **descriptive context metadata only, with NO access-control semantics** — documented
>   explicitly so enterprises are not misled that BU membership scopes visibility.
>   **Enhancement (governed, sequenced):** an **additive intra-org access-scope dimension** —
>   a per-user `access_scope` keyed to business_unit/department, layered *on top of*
>   org-level isolation (the tenant unit stays the organization; this is intra-org RBAC, not
>   nested tenancy). This requires a **`TENANT_ISOLATION_STANDARD` amendment**, which is
>   *flagged here, not made* (docs-only; §24).
> - **Why over alternatives:** *nested/hierarchical tenancy* would rewrite the platform's
>   core isolation invariant and violate the standard. *Silently implying BU-scoped access*
>   on descriptive data would be a security misrepresentation. *Ignoring it* forces a
>   re-architecture of authorization on live enterprise data later. Descriptive-first +
>   an additive, governed access-scope dimension preserves the org tenant unit while giving a
>   clean path to the access model enterprises will demand.

Enterprise deployment: shared-SaaS logical isolation; clean org-keying keeps a future
dedicated/residency-controlled deployment path open (§ Enterprise Readiness).

---

## 14. Performance strategy

Bounded graph traversal (depth cap + visited-set + per-level org predicate), with the
materialized-adjacency fallback (AD-13). Index discipline: `(organization_id, entity_type)`
on the header; typed-column indexes on children where predicates land; both endpoints on
relationships; `is_current` partial index + partition-local indexes on assessments;
targeted indexes (not blanket GIN) on `applicability_evidence`. Blast-radius memoization is
deferred until a measured hot-node problem exists.

---

## 15. Scalability strategy

The IAE runs on the existing fan-out, now **pre-filtered** (AD-14) and on a **dedicated,
sharded queue** (AD-19). Entity/edge volume is bounded by the S1 metering cap (AD-1b).
Decision-store volume is bounded by partitioning + retention (AD-15).

---

## 16. Event model

Event = an enqueued job (no broker; the queue *is* the durable, org-scoped, replayable
event log). Producers: the matcher enqueues a **pre-filtered** applicability job per
plausibly-affected org (AD-14); a graph mutation or high-severity signal enqueues
scoped `entity_reassessment` jobs (ratified D7 direction). Consumers run the IAE inside
`withTenant`, write the immutable assessment, and fan out workflow effects. Idempotency via
append-only versioning + partial-unique dedup on effects.

---

## 17. Queue architecture

### AD-19 — Machine-triggered applicability jobs run on a dedicated, sharded queue with a covering index — not the shared human-job path.

> **Architectural Decision — dedicated applicability queue** *(resolves AR-10 & AR-12, High — queue half)*
> - **Problem:** the shared `jobs` table was sized for rare, human-triggered jobs. The IAE's
>   machine-scale per-signal × per-org fan-out (millions/day at 10k orgs) runs through a
>   single `UPDATE … ORDER BY scheduled_for FOR UPDATE SKIP LOCKED LIMIT 1` whose **OR'd
>   status predicate defeats the `(status, scheduled_for)` index**, and every worker competes
>   at the same `scheduled_for` head — the canonical Postgres-as-queue contention wall. It
>   would fall over *before* entity volume or traversal cost.
> - **Chosen solution:** a **dedicated queue for machine job_types**, **sharded by org-hash**
>   (workers claim within a shard to avoid head contention), with a **covering index matching
>   the claim predicate** (no OR-defeat), explicit backpressure, and the fan-out pre-filter
>   (AD-14) cutting volume at the source. The retry/backoff/dead-letter *mechanism* is reused;
>   only the substrate and indexing change.
> - **Why over alternatives:** reusing the shared table (v1) inherits the mechanism but not
>   the throughput headroom and would starve human jobs (exports, deletions) under machine
>   load. A message broker (Kafka/SQS) violates "low operational overhead" and adds an
>   un-isolated system. Sharded Postgres queues with covering indexes are the proven
>   middle path within the existing stack.

---

## 18. Background processing strategy

### AD-11 (revised) — A dedicated `applicability-worker` service (mirrors `posture-worker`).

> **Architectural Decision — dedicated worker** *(supports AR-10, High)*
> - **Problem:** folding machine-scale applicability into an existing worker couples its
>   failure and scaling to unrelated human jobs.
> - **Chosen solution:** a dedicated `applicability-worker` Render service over a pure IAE
>   core, claiming from the sharded queue (AD-19) on `pgElevated`, executing in
>   `withTenant(orgId)`, failing via the existing `decideFailureState`. The reasoning core
>   stays a pure function, so the worker is a thin runner.
> - **Why over alternatives:** v1's "decide later / fold into an existing worker" understated
>   the throughput and failure-isolation need; a dedicated service is the platform's
>   established pattern for a distinct high-volume concern (posture-worker precedent).

---

## 19. Audit architecture

Entity/relationship mutations → `writeAuditEvent` (immutable `security_audit_log`).
**Decisions are self-auditing:** `applicability_assessments` is WORM, hash-chained, by-value,
reproducible (AD-16) — the object an auditor reads to answer "why did the platform conclude
this, on what evidence, could it have been altered." The hash chain answers tamper-evidence;
by-value snapshots answer reproducibility; the evidence child answers "which decisions used
X."

---

## 20. Versioning strategy

`schema_version` + `engine_version` on decisions (the rule corpus that produced them; AD-7
governance). Enum growth (entity_type, relationship_type, target_type, source_type) is
additive-only via migration + a `CANONICAL_DOMAIN_MODEL.md` update in the same slice.
Backwards compatibility: new columns nullable/defaulted; `vendors`/`ai_systems`/`cyber_signals`
shapes untouched; `dedup_hash` + its two unique indexes never touched.

---

## 21. Migration strategy

Additive, one migration per slice, timestamp-prefixed, filename-keyed (respect the F-1
gate). **Partition + WORM + latest-pointer are established at table creation** (AD-15/AD-16)
— never retrofitted. Inert-then-flip behind `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED`
(default off) + RLS INERT until the A04-G1 flip. No backfill (AD-2). Rollback = flag off;
tables sit inert; destructive DROP only pre-first-flip.

---

## 22. Risks (updated; resolved-in-design marked)

| # | Risk | Severity | Status in v2 |
|---|---|---|---|
| R-1 | Duplication of vendors/users/existing edges | High | Mitigated — AD-1/AD-3/AD-6/AD-13. |
| R-2 | Metering blind spot | High | **Resolved in design** — AD-1b (metering in S1). |
| R-3 | Tier-granularity ceiling (Enterprise gating) | Critical | **Resolved in design** — AD-17 capability gate. Needs commercial sign-off + doc note. |
| R-4 | Auto-risk collision with lifecycle SoD | High | Mitigated — AD-9 (suggest/flag/draft only). |
| R-5 | LLM-as-truth | High | Mitigated — AD-5/AD-7/AD-16 (deterministic decision; LLM narration only). |
| R-6 | Immature ingestion base | Medium | Sequenced after Priority 4 — unchanged. |
| R-7 | Graph tenant leak via polymorphic edges | High | Mitigated — §12 two-endpoint pre-flight + per-level org predicate + global-signal special-case (AD-13). |
| R-8 | Scope explosion (entity types / connectors) | Medium | Mitigated — AD-1a small taxonomy; AD-10 connectors deferred. |
| R-9 | Vocabulary drift (criticality, source_type) | Low | **Resolved** — lowercase criticality; source_type reconciled S6. |
| R-10 | Evidence not legally defensible | Critical | **Resolved in design** — AD-16 (by-value/WORM/hash chain/reproducible). |
| R-11 | Queue throughput wall | High | **Resolved in design** — AD-14/AD-19/AD-11. |
| R-12 | Decision-store bloat | High | **Resolved in design** — AD-15 (partition/latest/retention). |
| R-13 | Empty-graph adoption failure | High | Mitigated — AD-10 population-first + resolver seeding. |
| R-14 | Sub-org access collision | Critical | **Resolved in design** — AD-18 (descriptive-first + governed access-scope). |
| R-15 | Enterprise-readiness gaps | High | Tracked — § Enterprise Readiness; residency/RBAC/retention as design constraints now. |

---

## 23. Tradeoffs

- **Header + typed children vs single generic table.** Chosen for constrained, indexed,
  regulator-relevant attributes at the cost of a read surface that joins header+child and a
  per-type migration to add a child. Worth it — the load-bearing fields are the product.
- **WORM + hash chain vs mutable rows.** Chosen for legal defensibility at the cost of write
  volume and no in-place correction (corrections are new versions). Non-negotiable for the
  stated market.
- **Dedicated sharded queue vs shared `jobs` table.** Chosen to protect both human and
  machine jobs at the cost of a second queue surface. Required by the throughput math.
- **Descriptive-first BU/department vs immediate access-scope.** Chosen to ship foundation
  without a tenant-model rewrite, at the cost of telling enterprises "BU is descriptive for
  now." Honest and reversible.
- **Capability gate vs new entitlement ranks.** Chosen to avoid Stripe/env/gate blast radius,
  at the cost of a second authorization dimension to maintain.
- **Postgres graph vs graph DB / recursive CTE vs materialized adjacency.** Chosen to keep
  one datastore, with a designed fallback so the scale risk is a config choice, not a
  redesign.

---

## 24. Open architectural questions (post-v2)

Resolved in v2 and removed from "open": criticality vocabulary (→ lowercase); resolver
authority (→ typed-authoritative, AD-13); metering mechanism (→ AD-1b, *value* still
operator); Enterprise gating mechanism (→ AD-17, *commercial sign-off* still needed);
evidence retention (→ archive-not-destroy, AD-15). Still genuinely open:

1. **Metering values (§ Q1 residual).** The exact per-tier `enterprise_entities`/edge caps —
   operator + commercial decision.
2. **Governing-doc amendments required (docs-only, not made here):** (a) a
   `TENANT_ISOLATION_STANDARD` amendment for the intra-org access-scope dimension (AD-18);
   (b) a capability-gate note distinct from entitlement rank (AD-17); (c) an explainability /
   WORM-evidence standard; (d) a data-residency standard. Each needs a doc-sync decision.
3. **Data residency model.** Per-tenant region control for government / critical
   infrastructure — design constraint now, mechanism TBD (§ Enterprise Readiness).
4. **Provenance precedence** when a connector and a manual edit disagree on an entity
   (per-connector rules).
5. **CTE-vs-materialized cutover threshold** — the measured fan-out/latency point at which
   AD-13's fallback engages.

---

## 25. Recommended implementation sequence (resequenced per AR-16)

Each slice: independently deployable · feature-flagged
(`SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED`, default off) · production-inert · own migration ·
own rollback (flag-off) · own tests (unit + cross-org isolation + output-shape +
negative-path) · own `CANONICAL_DOMAIN_MODEL.md` update · backwards compatible. **All gated
on Priority 4 completion + explicit per-slice operator authorization.** This document
authorizes none of them.

| Slice | Scope | Resolves |
|---|---|---|
| **S0 — Decisions (docs)** | Resolve the S1-blocking prerequisites *before* any code: metering values (Q1), the intra-org access-scope decision (AD-18) + `TENANT_ISOLATION_STANDARD` amendment, the capability-gate note (AD-17), and confirm the taxonomy incl. `data_classification`/`identity`. Register the new objects in `CANONICAL_DOMAIN_MODEL.md`. | AR-11, F8, AR-15, AR-2 |
| **S1** | `enterprise_entities` header + **one typed child (`enterprise_data_stores`)** + RLS policy (inert) + minimal org-scoped CRUD + **metering in-slice**; BU/department **descriptive-only**. No import, no UI. | AR-1, AR-15, AR-11 |
| **S2** | `enterprise_relationships` + graph resolver (**typed-authoritative, global-signal special-case, gated on load test**; materialized fallback designed) + read-only graph route. `data_classification`/`identity` typed children as needed. | AR-4, AR-2 |
| **S3** | CSV / spreadsheet import (first-class) + hard row-limit (reuses S1 metering). | — |
| **S3.5 — Queue & partitioning spike** | Design + load-test the sharded machine queue, covering index, fan-out pre-filter, and decision-store partitioning at target fan-out **before** S4 writes anything. | AR-10, AR-12 |
| **S4** | IAE pure core + `applicability_assessments` (**partitioned, WORM, hash-chained, `is_current`**) + `applicability_evidence` (by-value) + `applicability_affected_entities` (normalized) + dedicated `applicability-worker` + pre-filtered fan-out + rule-governance harness. | AR-8, AR-6, AR-3, AR-10, AR-7 |
| **S5** | Explainability read surface over the immutable record + optional fallback-safe LLM narration. | AR-8 |
| **S6** | Workflow automation: extend findings + `signal_match_suggestions` (`enterprise_entity` target_type, suggestion = projection of assessment) + actions + wire `createAlertBatcher`; reconcile `source_type`. Risks stay human-gated. | AR-9 |
| **S7 (D6/D7)** | Dependency linkage (`signal_dependency_links` + `dependency` target_type) + reassessment triggers (scoped fan-out). | — |
| **Deferred** | Population-first connectors (identity → CMDB → cloud, then the rest), each its own authorized package; UI; extended taxonomy (`network`, `geographic_location`, `cloud_resource`, `fourth_party`); the intra-org access-scope enhancement build; Enterprise-Readiness packages (§ below). | AR-13, AR-14 |

---

## Enterprise Readiness (AR-14)

Table-stakes enterprise capabilities, tracked as sequenced packages; **residency, sub-org
RBAC, and retention are design constraints now** because they are hard to retrofit.

| Capability | Disposition |
|---|---|
| Sub-org RBAC / delegated admin / SoD | Designed as AD-18 access-scope enhancement (post-foundation). |
| SCIM provisioning/deprovisioning | Backlog package (SSO JIT + seat-cap already exist to build on). |
| Data residency / sovereignty (per-tenant region) | **Design constraint now** (clean org-keying preserved); mechanism §24 Q3. |
| Customer-managed keys / BYOK | Backlog; regulated-procurement expectation. |
| Audit-log export / SIEM streaming | Backlog over `security_audit_log`. |
| Legal hold / configurable retention | Aligned with AD-15 archive-not-destroy + AD-16 WORM. |
| Custom fields | The *legitimate* `metadata JSONB` surface (separated from typed load-bearing attributes, AD-1). |
| Maker-checker approvals on high-criticality entity changes | Backlog; borrow risk-lifecycle SoD pattern. |
| Bulk/async API + per-tenant rate limits | Backlog; current limiter is per-replica in-memory. |
| Point-in-time / historical reporting | Backlog; supported by WORM decision history. |

---

## Appendix — where this design diverges from the literal prompt (and why)

1. **No generic one-big-table entity model** — header + typed children (AR-1/AD-1).
2. **No 14-table entity model** — `Owners`=`users`, `Third Parties`=`vendors`,
   `Fourth Parties`⊂`dependencies`; network/geo/cloud deferred (AD-1a).
3. **The graph unions existing edges, typed-authoritative** — never replaces them
   (AD-3/AD-13).
4. **`EnrichedSignal` is not a table** — projection per D1; only the *decision* is stored
   (AD-6).
5. **The engine does not auto-create or auto-transition risks** — suggest/flag/draft only
   (AD-9).
6. **The LLM never makes the decision** — deterministic core + fallback-safe narration
   (AD-5/AD-7/AD-16).
7. **Evidence is by-value, immutable, hash-chained, reproducible** — not a JSONB pointer
   blob (AD-16).
8. **BU/department are descriptive-first** — access semantics are a governed enhancement,
   not an implied capability (AD-18).
9. **Enterprise gating is a capability dimension** — not a new entitlement rank (AD-17).
10. **Connectors designed, not built — but population-first when built** — CSV/manual
    first-class; graph seeded from owned data (AD-10).
11. **No graph DB, no broker, no ORM, no service-layer rewrite** — dedicated sharded
    Postgres queue instead (AD-4/AD-19).

---

## Resolved Review Findings

Every **Critical** and **High** finding from `ARCHITECTURE_REVIEW.md`, and where it became
part of the design. (Mediums/Lows folded where natural are noted; the rest remain tracked in
the review and §24.)

| Finding | Severity | Resolved by | Where |
|---|---|---|---|
| **AR-1** — load-bearing attrs in JSONB | Critical | Header + typed per-type child tables; JSONB = custom fields only | §4 AD-1; §9 |
| **AR-8** — evidence not immutable/reproducible/queryable | Critical | By-value snapshots + WORM immutability + hash chain + reproducibility + typed evidence child | §7 AD-16; §12; §19 |
| **AR-11** — flat tenant vs BU/department | Critical | Descriptive-first BU/department + governed intra-org access-scope enhancement (+ standard amendment flagged) | §13 AD-18; §24 Q2 |
| **F8** — no Enterprise-only gate | Critical | Org-level capability grant orthogonal to entitlement rank | §10 AD-17; §24 Q2 |
| **AR-2** — engine's entity types deferred | High | `data_classification` + `identity` promoted into S1/S2 taxonomy | §4 AD-1a; §25 S0/S2 |
| **AR-4** — resolver correctness / first CTE | High | Typed-authoritative rule + global-signal special-case + load-test gate + materialized fallback | §5 AD-13; §25 S2 |
| **AR-6** — append-only bloat / no latest path | High | Partitioning + `is_current` latest-pointer + retention-up-front | §7 AD-15; §21 |
| **AR-10** — single-poll queue throughput wall | High | Fan-out pre-filter + dedicated sharded queue + covering index + dedicated worker | §6 AD-14; §17 AD-19; §18 AD-11 |
| **AR-12** — index/partitioning under-specified | High | Partition + partial/covering indexes + targeted (not blanket) GIN | §7 AD-15; §14 |
| **AR-13** — moat contingent / empty-graph | High | Reframed moat (applicability + defensible explainability) + resolver seeding + population-first connectors | §1; §5; §11 AD-10 |
| **AR-14** — missing enterprise features | High | Enterprise Readiness section; residency/RBAC/retention as design constraints now | § Enterprise Readiness; §24 |
| **AR-15** — metering sequenced too late | High | Metering mechanism moved into S1, decoupled from `max_monitored_entities` | §4 AD-1b; §25 S0/S1 |
| *(folded)* AR-3 — per-signal vs per-entity granularity | Medium | Normalized `applicability_affected_entities` child | §7 AD-15 |
| *(folded)* AR-7 — rule-corpus governance | Medium | Versioned/tested rules + human-ratified novelty | §6 AD-7-support |
| *(folded)* AR-9 — assessment/suggestion duplication | Medium | Suggestion = derived projection of the assessment | §8 AD-8a |
| AR-5 — typed-vs-generic split | Low | Accepted as-is (no change) | §5 |

**STOP POINT.** This is the revised blueprint. No SQL, migration, or code has been written;
no governing document has been modified; nothing is committed. Awaiting operator resolution
of §24 and authorization of S0/S1 before any implementation begins.
