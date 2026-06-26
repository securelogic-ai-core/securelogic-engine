# Domain Model

The authoritative object model is `CANONICAL_DOMAIN_MODEL.md` at the repo root. This
file is a working companion: it summarizes the entities, the rules that bind them, and
the decisions you must not relitigate. **When they differ, `CANONICAL_DOMAIN_MODEL.md`
wins**, and you should update this file.

---

## 1. Governing principles (do not violate)

1. **One concept, one object.** `Finding` means Finding everywhere. Never create
   `issue_finding`, `brief_action`, `report_posture`, or any parallel concept.
2. **Organization-centricity.** Every customer-data object has
   `organization_id UUID NOT NULL`. Every query, rollup, and report is org-scoped.
3. **Outputs consume, never define.** Briefs, dashboards, and reports *read* canonical
   objects. They never become the source of truth for them.
4. **Structured over prose.** Findings, Actions, Vendors, AI Systems, Obligations,
   Controls, and Posture Snapshots are **structured records**. Storing them as free text
   or JSON blobs is a domain-model violation.
5. **Shared enums only.** Severity, priority, status, domain, and source_type are
   centrally defined (below). Never re-declare a divergent copy in a module.

To add a canonical object: define it in `CANONICAL_DOMAIN_MODEL.md` first → write the
migration → write org-scoped, entitlement-gated routes → add the table row with package
attribution → extend shared enums if needed.

---

## 2. Entity catalog

Each entity below is a real table (`db/migrations/`) with REST routes
(`src/api/routes/`). The format: **Purpose · Ownership · Key relationships · Lifecycle ·
Constraints.**

### Core platform objects

**Organization** (`organizations`)
- *Purpose:* the tenant. Root of all customer data; holds entitlement + context profile.
- *Ownership:* self (the tenant unit). Not org-scoped (it *is* the org).
- *Relationships:* parent of every customer-data table via `organization_id`.
- *Lifecycle:* created at signup (first user → `admin`); `status` active/…; soft tombstone
  for GDPR deletion (PII scrubbed in place, UUID preserved).
- *Constraints:* `entitlement_level` written only by Stripe webhook; context columns
  `regulated`/`handles_pii`/`safety_critical`/`scale` feed posture weighting;
  `max_monitored_entities` (default 50) caps vendors+AI systems.

**User** (`users`) · **API Key** (`api_keys`)
- *Purpose:* identity + credentials. `users.role` ∈ {viewer, analyst, admin}. API keys
  are SHA-256 hashed, admin-equivalent for the org.
- *Lifecycle:* JWT bridge swaps a session JWT for the org's most recent active API key.
  `password_changed_at` invalidates older JWTs. Tombstone-delete on erasure.

**Finding** (`findings`)
- *Purpose:* a discovered issue from any workflow or signal — the central posture input.
- *Ownership:* org. Optional `assessment_id`; `source_type` + `source_id` point to the
  originating record.
- *Relationships:* feeds posture; can spawn Actions and Evidence.
- *Lifecycle:* `status` open → in_progress → closed.
- *Constraints:* `source_type` CHECK enumerates every workflow origin (see §3).

**Action** (`actions`)
- *Purpose:* a remediation task. Org-scoped, owned, status-tracked, due-dated.
- *Relationships:* `source_type` + `source_id` link to finding/assessment/signal/risk/manual.
- *Lifecycle:* open → in_progress → blocked → closed/accepted; `completed_at` set on close.
- *Constraints:* priority + status enums (§3). Canonical route shape lives in
  `src/api/routes/actions.ts` — copy it for new CRUD routes.

**Posture Snapshot** (`posture_snapshots` + `domain_scores`)
- *Purpose:* point-in-time risk posture. One per org per day.
- *Relationships:* `domain_scores` children per domain; computed by the posture worker.
- *Lifecycle:* recomputed every 6h and on matcher events.
- *Constraints:* `overall_score` is **NULL** when zero open findings (insufficient data).
  `computation_rationale` carries the workflow signal breakdown.

**Assessment** (`assessments`) — generic assessment container feeding findings.

### Vendor & third-party risk

- **Vendor** (`vendors`) — third party. `criticality` ∈ critical/high/medium/low;
  `template_source` / `template_metadata` carry industry-template attribution.
- **Vendor Assessment** (`vendor_assessments`) — point-in-time, immutable → findings
  `source_type='vendor_review'`.
- **Vendor Review** (`vendor_reviews`) — *mutable* cyclical workflow → findings
  `source_type='vendor_cycle_review'`; finding-triggering statuses
  `concerns_identified`, `critical_issues`.
- **Vendor Assurance Documents** (`vendor_assurance_documents` + `_extractions` +
  `_extraction_spans` + `_review_decisions` + `_cuecs` + `_cuec_control_mappings`) —
  SOC-report intake. PDF in R2 at `org/{orgId}/vendor-assurance/{docId}/original.pdf`.
  Extraction is **one per document** (no re-extraction). Review decisions are
  **append-only** (current = latest by `decided_at`). Phase-1, staging-gated behind
  `SECURELOGIC_VENDOR_ASSURANCE_ENABLED`. Does **not** write findings/risks/vendor scores.

### AI governance

- **AI System** (`ai_systems`) — inventoried AI capability. `criticality` like vendors.
- **Governance Review** (`governance_reviews`) — point-in-time → findings `ai_review`.
- **AI Governance Assessment** (`ai_governance_assessments`) — mutable workflow →
  findings `ai_governance_review`; triggers on `non_compliant`, `partially_compliant`.
- **AI System Vendor Dependency** (`ai_system_vendor_dependencies`) — typed edge
  ai_systems ↔ vendors (`dependency_role`); the edge a future matcher-cascade traverses.

### Compliance: frameworks, controls, obligations

- **Framework** (`frameworks`) → **Requirement** (`requirements`) — control framework
  structure (SOC 2, NIST CSF, ISO 27001, custom).
- **Control** (`controls`) → **Control Mapping** (`control_mappings` → requirements) →
  **Control Assessment** (`control_assessments`, mutable) → findings `control_test`,
  `domain='General'`.
- **Obligation** (`obligations`) → **Obligation Mapping** (`obligation_mappings`) →
  **Obligation Assessment** (`obligation_assessments`) → findings `obligation_review`,
  `domain=obligation.domain`. UNIQUE `(organization_id, title)`.

### Risk operations

- **Risk** (`risks`) — risk register entry. `likelihood` + `impact` + `risk_rating`
  (Severity enum). `status` open/accepted/mitigated/closed/transferred. Open risks
  (`status='open'`) are mapped into posture as `source_type='risk'`.
- **Risk Treatment** (`risk_treatments`) — treatment of a risk. Terminal statuses
  (`mitigated`/`accepted`/`transferred`) **sync the parent `risks.status`**, dropping it
  from the next posture snapshot.
- **Risk ↔ Control / Obligation Links** (`risk_control_links`, `risk_obligation_links`) —
  soft-deleted junctions (`deleted_at`, partial unique).
- **Dependency** (`dependencies`) → **Dependency Assessment** (`dependency_assessments`,
  mutable) → findings `dependency_review`; triggers on `flagged`, `needs_remediation`.
- **Evidence** (`evidence`) — immutable metadata linking proof to a source record via
  `source_type` + `source_id`. Evidence is metadata only (the blob, if any, lives in R2).

### External signals

- **Signal / Cyber Signal** (`signals` legacy, `cyber_signals` canonical) — public-source
  intelligence. **Global** rows (`organization_id IS NULL`), deduped on a content hash.
- **Signal ↔ Vendor / AI System / Control / Obligation Links**
  (`signal_vendor_links`, `signal_ai_system_links`, `signal_control_links`,
  `signal_obligation_links`) — org-scoped junctions that *permit* a global signal id;
  soft-deleted, partial-unique.
- **Signal Match Suggestion** (`signal_match_suggestions`) — polymorphic matcher output
  over (target_type, target_id) ∈ vendors/ai_systems/controls/obligations. State
  pending/accepted/dismissed; `match_score` ∈ [0,100]. Primary surface is the `/queue`
  page. Partial unique on `(org, signal, target_type, target_id) WHERE pending` lets the
  matcher re-suggest after a dismissal.
- **Risk Scoring Weights** (`risk_scoring_weights`) — one row/org; three JSONB weight maps
  driving `computeRiskScore`. **Two-vocabulary by design** (severity PascalCase vs
  criticality lowercase) — do not conflate or "fix". Obligations use entity_w=1.0
  (neutral) by design.

### Platform plumbing (not customer-domain)

`jobs` (generic async queue) · `worker_runs` · `webhook_endpoints`/`_deliveries`/
`webhook_events_processed` · `security_audit_log` (append-only, immutability trigger) ·
`legal_consents` · `data_export_files` · `api_usage_daily` · `email_suppressions` ·
`feed_health` · `schema_migrations`.

---

## 3. Canonical enums (single source of truth)

Re-declaring a divergent copy is a violation. These live in `CANONICAL_DOMAIN_MODEL.md`
and are enforced by DB CHECK constraints.

- **Severity:** `Critical` · `High` · `Moderate` · `Low` (PascalCase).
- **Priority:** `immediate` · `near_term` · `planned` · `watch`.
- **Status (findings):** `open` · `in_progress` · `closed`.
- **Status (actions):** `open` · `in_progress` · `blocked` · `closed` · `accepted`.
- **Source Type (findings)** — DB CHECK is authoritative: `assessment`, `control_test`,
  `vendor_review`, `vendor_cycle_review`, `ai_review`, `ai_governance_review`,
  `obligation_review`, `dependency_review`, `signal`, `manual`, `risk`.
- **Source Type (actions):** `assessment` · `finding` · `signal` · `manual` · `risk`.
- **Domain:** `Access Management` · `Vendor Risk` · `AI Governance` · `Regulatory` ·
  `Vulnerability` · `Resilience` · `General` (non-exhaustive — extend deliberately).
- **Risk Likelihood:** `very_likely` · `likely` · `possible` · `unlikely` · `rare`.
- **Risk Status:** `open` · `accepted` · `mitigated` · `closed` · `transferred`.
- **Evidence Type / Source Type, Dependency Type/Status, Workflow statuses** — see
  `CANONICAL_DOMAIN_MODEL.md`. Note the **criticality** vocabulary is *lowercase with
  `medium`* (`critical`/`high`/`medium`/`low`) — distinct from Severity's
  `Moderate`. They are deliberately not unified.

A note on PascalCase Severity vs lowercase criticality: this lexical split is intentional
and load-bearing in `risk_scoring_weights` and `computeRiskScore`. Treating
`"Moderate" === "medium"` is a real bug surface the design prevents — keep them separate.

---

## 4. Locked package decisions (do not relitigate)

From `CANONICAL_DOMAIN_MODEL.md` §"Locked Package Decisions":

- **Mutable vs point-in-time workflows** are deliberately separate tables with separate
  `source_type`s. `vendor_reviews` (mutable, `vendor_cycle_review`) is distinct from
  `vendor_assessments` (immutable, `vendor_review`). Same split for AI governance
  (`ai_governance_assessments` vs `governance_reviews`).
- **Risk treatment terminal sync:** terminal treatment statuses update the parent risk's
  status and remove it from posture on the next snapshot.
- **Workflow→scoring integration is pure:** `workflowScoringIntegration.ts` has no DB
  access; all queries live in `posture.ts`. `computation_rationale` is enriched
  additively and must not change scoring behavior.
- **Posture context weighting is live** with fixed multipliers (regulated +0.2,
  safety_critical +0.3, handles_pii +0.2, scale Small 0 / Medium 0.1 / Enterprise 0.2 —
  the engine-internal V2 weights differ slightly; read the engine, don't guess).

---

## 5. Working with the model — checklist

When you touch any entity:

- [ ] Confirm the entity, its enums, and its relationships in `CANONICAL_DOMAIN_MODEL.md`.
- [ ] Reuse the canonical enum values — do not invent or alias.
- [ ] Keep it a structured record; never serialize a canonical object into a blob/output.
- [ ] Preserve the mutable-vs-point-in-time and `source_type` semantics.
- [ ] If a workflow status should create a finding, follow the existing
      first-transition-triggers-finding pattern, with the correct `source_type` + `domain`.
- [ ] If you add a canonical object or enum value, update `CANONICAL_DOMAIN_MODEL.md` (and
      this file) in the same change, with package attribution.
