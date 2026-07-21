# ERIP Package 3 — The Decision Workspace (design)

Status: **APPROVED (2026-07-09) with modifications — IN IMPLEMENTATION.** Governance:
dark, additive, GATE B, `develop`-only, per-PR CI 8/8. Feature flag
**`SECURELOGIC_DECISION_WORKSPACE_ENABLED`** (default off). "Decision Workspace" is the
name throughout; the route remains `/findings/:id`. Findings are the enterprise **decision
object**; Intelligence Events remain the canonical backend object and a **drill-through
only** (no customer-facing Intelligence Events page — §6).

## 0. Approved modifications (governing delta, 2026-07-09)

These operator modifications supersede the original §2/§3 where they differ:

1. **Rename** "Finding Detail" → **Decision Workspace** throughout (route stays `/findings/:id`).
2. **Decision Header** carries: Finding title · **Executive Decision Summary** (1–2 line "why
   this requires attention") · Priority · **Business Impact** · **Decision State** ·
   **Operational Status** · Owner · SLA · Risk Score · Confidence. Primary actions: **Assign ·
   Status · Accept Risk · Escalate**.
3. **Business Impact is its own decision zone** (not buried in the summary): Revenue ·
   Operational · Regulatory · Customer · Third-party impact.
4. **Rename** zone "Why" → **Evidence & Intelligence**: Supporting Intelligence Events ·
   Sources · Evidence · Confidence · Timeline.
5. **New section "What's Changed"** — what changed since the user's previous review (new
   affected assets/vendors/AI, severity increased, exploit observed, KEV added, new
   corroborating source, recommendation updated, business impact changed, or "No changes").
6. **Separate Business Decision from Operational Status.**
   - **Business Decision (`decision_state`, NEW additive column):** `needs_review` ·
     `accepted_risk` · `in_progress` · `mitigating` · `resolved`.
   - **Operational Status (`status`, existing):** `open` · `in_progress` · `closed` ·
     `accepted` — unchanged.

Schema impact of the modifications (both additive, GATE B, flag-gated writes):
- `findings.decision_state TEXT` + CHECK (default `needs_review`; backfill derived from
  `status`). Additive `ALTER TABLE`; legacy UI never reads it (flag-off byte-identical).
- `finding_review_marks (organization_id, finding_id, user_id, last_reviewed_at)` — per-user
  "last reviewed" marker powering "What's Changed". Org-scoped, RLS, `dataClassification`.

Retained exactly as designed: Finding-centric / Asset-context IA · Intelligence Events
drill-through only · progressive disclosure (Executive: Header + Executive Summary +
Business Impact + Recommendation always expanded; Analyst: Evidence & Intelligence +
Affected Context + Timeline expandable) · dedicated flag default OFF · dark launch ·
byte-identical flag-OFF.

Foundation reused (verified present): `findings`/`actions` primitives; `evidence`
(`source_type` already includes `'finding'`); `intelligence_events` + child
`intelligence_event_sources` + `intelligence_event_timeline`; `signal_vendor_links` /
`signal_ai_system_links` / `signal_control_links` / `signal_obligation_links`;
`applicability_assessments` + `applicability_affected_entities` + `applicability_evidence`;
Epic-3/E4 reuse APIs (`/risk/dimensions`, `/executive/risk-summary`, asset
risk-propagation, graph blast-radius); `asset_registry_v`; `audit_events`;
`enterprise_entities` (incl. `business_process` type). The workspace is a **read/compose
layer over these** — see §8: **no new tables are required**.

---

## 1. What business decision does a Finding help the customer make?

A Finding is not an alert to read — it is a **decision record**. The customer must decide,
per finding:

> **"Is this our problem, how bad is it for the business, who owns it, and what do we do —
> and can I prove why we decided that?"**

Concretely the Finding must drive four decisions: **(a) Triage** — is this real and ours,
and how urgent? **(b) Impact** — what business assets/vendors/AI/processes/obligations are
exposed, and how much? **(c) Action** — accept the risk, remediate, or escalate, with an
owner and an SLA. **(d) Proof** — the evidence, sources, and reasoning that make the
decision defensible to leadership and auditors.

This reframes the object: today's Finding is an *intelligence/assessment record*; the
Decision Workspace makes it the **enterprise decision object** — the unit of work the whole
platform orbits (the primary-object thesis from the audit).

## 2. What must be on one page (no navigating elsewhere)

Every item the customer needs to make the four decisions, on one screen. For each, the
**data source today** and a **build classification**:

- **EXISTS** — a field/row already returned or trivially selected.
- **DERIVE** — composable from existing tables via a new read/join (no schema change).
- **COMPOSE+REUSE** — computed by reusing an existing Epic-3/E4 engine/endpoint.
- **NEW-SCHEMA** — needs a migration (called out explicitly; there is only one optional one).

| # | Section | Answers | Source today | Class |
|---|---|---|---|---|
| 1 | **Finding summary** | What happened? | `findings.title/severity/domain/description` | EXISTS |
| 2 | **Executive impact summary** | Why do I care (1–2 lines)? | compose severity + impact + affected count | DERIVE |
| 3 | **Business impact** | What's the business cost of exposure? | affected-entity criticality + Epic-3 risk propagation | COMPOSE+REUSE |
| 4 | **Risk score** | How bad, numerically? | compose severity/priority/confidence + asset criticality | COMPOSE+REUSE |
| 5 | **Priority** | How urgent? | `findings.priority` | EXISTS |
| 6 | **Status** | Where in the lifecycle? | `findings.status` | EXISTS |
| 7 | **Owner** | Who is accountable? | `findings.owner_user_id` → `users` join | DERIVE |
| 8 | **SLA** | By when? | `findings.due_date` (+ derived overdue/at-risk) | EXISTS |
| 9 | **Timeline / activity** | What changed, when, by whom? | `audit_events` filtered to the finding | DERIVE |
| 10 | **Affected assets** | Which cloud/endpoint/app assets? | `source_id`→`signal_*_links`/`applicability_affected_entities`→`asset_registry_v` | DERIVE |
| 11 | **Affected vendors** | Which third parties? | `signal_vendor_links` / vendor-sourced `source_id` | DERIVE |
| 12 | **Affected AI systems** | Which AI systems? | `signal_ai_system_links` / ai-sourced `source_id` | DERIVE |
| 13 | **Affected business processes** | Which operations? | `enterprise_entities` (type `business_process`) via applicability/graph | DERIVE |
| 14 | **Affected controls** | Which controls? | `signal_control_links` / control-test `source_id` | DERIVE |
| 15 | **Affected obligations** | Which regulatory duties? | `signal_obligation_links` / obligation `source_id` | DERIVE |
| 16 | **Supporting Intelligence Events** | What's the intelligence behind this? | `source_type='intelligence_event'`→`intelligence_events`; or `cyber_signal`→`intelligence_event_sources` | DERIVE |
| 17 | **Sources** | Who reported it? | `intelligence_event_sources` (source/external_id) or assessment record | DERIVE |
| 18 | **Evidence** | What proof do we hold? | `evidence` where `source_type='finding'` (+ applicability_evidence) | EXISTS |
| 19 | **Confidence** | How sure are we? | `findings.confidence` / event.confidence / applicability band | EXISTS |
| 20 | **Recommended actions** | What should we do? | `findings.recommendation` + `actions` (`source_type='finding'`) | EXISTS |
| 21 | **Related findings** | What else is connected? | same event / same affected entity / same domain | DERIVE |

**The headline design fact:** 20 of 21 sections are EXISTS/DERIVE/COMPOSE from canonical
data already in the database. The Decision Workspace is a **composition problem, not a
data-modeling problem** — which is exactly what "outputs consume, never define" demands.

## 3. Information architecture (how the sections organize)

Ordered by the decision flow (triage → impact → proof → action), with progressive
disclosure so one page serves both executive and analyst. Reflects the §0 modifications:

```
ZONE A — DECISION HEADER            (always visible)
  #1 title · Executive Decision Summary (#2) · Priority (#5) · Business Impact (headline, #3)
  · DECISION STATE (business decision) · OPERATIONAL STATUS (#6) · Owner (#7) · SLA (#8)
  · Risk Score (#4) · Confidence (#19)
  Primary actions: [Assign] [Status] [Accept Risk] [Escalate]

ZONE B — WHAT'S CHANGED             (always visible — new, §0.5)
  changes since the user's last review, or "No changes"

ZONE C — BUSINESS IMPACT            (always visible — own zone, §0.3)
  Revenue · Operational · Regulatory · Customer · Third-party

ZONE D — AFFECTED CONTEXT           (expandable — "analyst")
  #10 assets · #11 vendors · #12 AI systems · #13 business processes · #14 controls · #15 obligations
  each row → deep-links to that object's page

ZONE E — EVIDENCE & INTELLIGENCE    (expandable — "analyst", renamed from "Why", §0.4)
  #16 supporting Intelligence Events (drill-through) · #17 sources · #18 evidence
  · #19 confidence · #9 timeline

ZONE F — RECOMMENDATION & ACTION    (always visible)
  #20 recommended action + remediation actions (the merged Actions "Remediation" tab)

ZONE G — CONTEXT RAIL               (side)
  #21 related findings · #9 activity/timeline
```

**Business Decision vs Operational Status (§0.6):** the Decision Header shows BOTH — the
*business decision* (`decision_state`: Needs Review / Accepted Risk / In Progress /
Mitigating / Resolved) is what leadership owns; the *operational status* (`status`: open /
in_progress / closed / accepted) is the workflow state. They are distinct controls.

**Executive vs analyst is one page, not two builds:** Zones A/B/C/F are always expanded
(the executive read — header, what's changed, business impact, recommendation); Zones D/E
are collapsed summaries that expand for the analyst. Identical DOM/data — no forked surface.

## 4. Low-fidelity wireframes

### 4.1 Finding List (executive-framed, grouped — evolves today's list)
```
┌ Findings ─────────────────────────────────────────── [Saved views ▾] [Export] ┐
│ What needs attention now                                                        │
│ ┌ Open 42 ┐ ┌ Critical 6 ┐ ┌ Overdue SLA 4 ┐ ┌ Unassigned 9 ┐ ┌ Awaiting appr 3┐│
│                                                                                 │
│ Group by: (•) Priority  ( ) Affected asset  ( ) Vendor  ( ) Domain  ( ) Status │
│                                                                                 │
│ ▾ IMMEDIATE (6)                                                                 │
│  ● Critical  RCE in Acme Gateway affects 3 vendors      Impact: High  ▸        │
│    Owner: J. Lee   SLA: overdue 2d   [Open]                                     │
│  ● Critical  KEV exploited — Ivanti in payments path    Impact: Critical ▸     │
│    Owner: —        SLA: due today    [Assign]                                   │
│ ▾ NEAR-TERM (14)  …                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 The Decision Workspace (`/findings/:id`)
```
┌ ← Findings ──────────────────────────────────────────────────────────────────┐
│ A  Critical RCE in Acme Gateway                          [Assign ▾] [Status ▾] │
│    Decision: NEEDS REVIEW   ·   Operational: Open           [Accept Risk][Escalate]
│    ● Critical · Business impact: HIGH · Owner J.Lee · SLA overdue 2d           │
│    Risk 84/100 · Confidence High                                               │
│    "Actively-exploited RCE in a payments-path vendor — decide escalation now." │
├───────────────────────────────────────────────────────────────────────────────┤
│ B  What's changed since your last review                                       │
│    + Exploit observed (added to CISA KEV)   + 1 new affected vendor (DataCo)   │
│    ↑ Severity High → Critical                                                  │
├───────────────────────────────────────────────────────────────────────────────┤
│ C  Business impact                                                             │
│    Revenue: card settlement at risk · Operational: gateway path · Regulatory:  │
│    PCI-DSS 6.2 · Customer: checkout · Third-party: 3 vendors                   │
├──────────────────────────────────────────┬────────────────────────────────────┤
│ D  Affected context            (expand ▾) │ G  Related findings                │
│  Assets(2)▸ Vendors(3)▸ AI(0)             │  • Acme TLS misconfig (open)       │
│  Processes(1)▸ Controls(2)▸ Obligations(1)│  • KEV: Ivanti (in progress)       │
│ E  Evidence & Intelligence     (expand ▾) │  Activity                          │
│  Supporting Event▸ "Acme RCE CVE-2026-…"  │  09:12 created (matcher)           │
│  Sources: CISA KEV, NVD, advisory         │  09:40 severity→Critical           │
│  Confidence 92 · Evidence(2)▸ · Timeline▸ │  10:05 assigned → J.Lee            │
├───────────────────────────────────────────────────────────────────────────────┤
│ F  Recommendation & action                                                     │
│    "Request remediation SLA from Acme; isolate gw path if unpatched in 72h."   │
│    Remediation:  [+ Add action]  ☐ Open vendor ticket  ☐ Compensating control  │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 Executive view (same page, collapsed to the decision)
```
┌ Critical RCE in Acme Gateway ─────────────────────────────────────────────────┐
│ ● Critical · Open · Owner J.Lee · SLA overdue 2d · Risk 84/100                 │
│ Impact: 3 vendors + card-settlement process exposed; actively exploited.       │
│ Decision needed: escalate + 72h vendor remediation.   [Escalate] [Accept risk] │
│ ▸ affected context   ▸ why / evidence   ▸ actions                              │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 4.4 Analyst investigation view (same page, everything expanded + evidence focus)
```
Zones A–F all expanded; Zone D leads with the Intelligence Event drill-through
(sources, timeline, matched-on), evidence viewer inline, and the reasoning chain
from applicability (when the finding is applicability-sourced). No page hop:
asset/vendor/control rows link OUT for editing, but read-context stays here.
```

## 5. Integration with the rest of the platform

- **Intelligence Events** — surfaced *inside* the Finding (Zone D) as a drill-through
  panel/`/intelligence/[id]` view showing the event's title, severity, sources, timeline,
  exploited/patched flags. The Finding is the entry point; the Event is context. (See §6.)
- **Review Suggested Links** — accepting a suggestion writes a `signal_*_link`; that link is
  exactly what Zone C resolves, so an accepted link **shows up as affected context on the
  resulting finding**. Add a reciprocal link: Review Links → "view resulting finding."
- **Asset Registry** — Zone C asset rows resolve through `asset_registry_v` and deep-link to
  `/assets/[id]`; business impact reuses the asset's criticality + Epic-3 propagation.
- **Vendor Management** — affected vendors link to `/vendors/[id]`; vendor-sourced findings
  already exist, so the Decision Workspace is the same object the vendor detail lists.
- **Compliance** — affected controls/obligations link to their detail; control-test /
  obligation-review findings render identically here (one finding object, many sources).
- **Dashboard** — FindingsDonut / Recent Findings / OpenItemsAging deep-link into the
  Decision Workspace instead of a flat list; the dashboard becomes the "attention" funnel.
- **Briefs** — a brief item links to its supporting Intelligence Event, which links to the
  findings it generated — closing the brief→event→finding→action spine the audit found broken.

## 6. Do customers need a customer-facing Intelligence Events *page*?

**Recommendation: NO primary-navigation Intelligence Events page. Intelligence Events
remain a drill-through** (reachable from a Finding, Review Links, or a Brief) via a light
`/intelligence/[id]` detail view — not a top-level list.

Reasoning (not "yes because it's the backend object"):
1. **The customer manages Findings, not events.** The primary-object thesis (audit §2) is
   that the Finding is the unit of work. An event only matters *as it affects me* — which is
   precisely the Finding. The Finding is the correct abstraction; the raw event is an input.
2. **A standalone events list recreates the alert feed** PRODUCT_VISION explicitly rejects
   ("not a generic alert feed", "not an alert viewer"). A global, org-agnostic event list is
   noise; the value is org-contextualized, and that context *is* the Finding.
3. **Every legitimate need is served by drill-through.** "What's the intelligence behind this
   finding?" → Zone D. "What did this brief item generate?" → brief → event → findings. "What
   does this accepted link mean?" → Review Links → resulting finding. None require an events
   list in nav.
4. **It avoids a fourth intelligence surface.** Briefs (editorial), Review Links (triage),
   applicability (audit) already exist; a fifth top-level "Events" list adds a rollup without
   a decision. The drill-through view reuses the same data with zero nav sprawl.

This **refines the earlier memo**, which had floated `/intelligence` as a nav item — the
validation evidence says drill-through, not primary nav. (If demand later appears — e.g. a
threat-intel analyst persona — reopen as a filtered saved-view, not a new top-level page.)

## 7. Pages that become redundant once the Decision Workspace exists

| Page | Recommendation | Why |
|---|---|---|
| `/actions` (standalone) | **Merge** → "Remediation" tab in the Finding (Zone E) + a cross-finding "My actions" saved view in the Findings list | Actions are downstream of findings; the standalone page is a dead-end (rows link nowhere). Keep `/actions` as a redirect. |
| `/intelligence` (proposed) | **Do not build as nav** → drill-through only | §6. |
| Dashboard "Recent Findings" widget | **Remain (re-point)** | Still a useful funnel; deep-link into the Workspace. |
| `/enterprise-context/applicability/[id]` | **Remain (move emphasis)** | Stays as the deep audit/reasoning + WORM record surface; the Finding now surfaces affected-entities/evidence for routine work, so customers stop needing Context for day-to-day. Consider positioning Context as audit/admin. |
| `/vendors/[id]` open-findings, `/controls/[id]` open-findings, AI/obligation finding lists | **Remain (re-point)** | Same finding object; their in-context lists link into the Workspace rather than a separate detail. |
| `/posture` | **Consolidate (separate track)** | Not Package-3 core; flagged for the rollup-consolidation slice. |

No hard deletes. The Decision Workspace **absorbs** the Actions dead-end and **demotes**
Context from routine use to audit use.

## 8. Phased implementation plan (Package 3 — proposed, not started)

Feature flag: reuse **`SECURELOGIC_RISK_WORKSPACE_ENABLED`** (the Decision Workspace is the
substance behind the IA already shipped) — or a dedicated `SECURELOGIC_DECISION_WORKSPACE_ENABLED`
if the operator wants independent staging. Recommendation: **dedicated flag** so the nav IA
(already validated) can enable independently of the heavier detail work. Business-impact/
risk-score bits additionally gate on `SECURELOGIC_RISK_INTELLIGENCE_ENABLED` (Epic-3 reuse).

### Phase 3.0 — Finding Context Resolver (engine, read-only)
- **Scope:** a pure/read service that, given a finding, resolves Zone C/D data: affected
  entities (via `source_type`/`source_id` + `signal_*_links` + `applicability_affected_entities`
  → `asset_registry_v`/vendors/ai_systems/enterprise_entities/controls/obligations), supporting
  Intelligence Events + sources + timeline, evidence (`source_type='finding'` + applicability),
  related findings, owner name, and activity (`audit_events`). Org-scoped, `asTenant`.
- **Files:** `src/api/lib/findingContextResolver.ts` (pure core + store), `src/api/routes/findings.ts`
  (new `GET /api/findings/:id/context`), `src/api/routes/index.ts` (mount).
- **Migrations:** **none required.** Optional additive index
  `CREATE INDEX CONCURRENTLY ... ON findings (organization_id, source_type, source_id)` if
  the reverse lookups warrant it (measure first).
- **Flags:** endpoint 404s unless the workspace flag is on (two-switch).
- **Tests:** unit (resolver composition per source_type) + **cross-org isolation** (context
  never leaks another org's entities/events/evidence; verified against real Postgres).
- **Rollout:** dark; additive; no UI yet.
- **Operator:** none.
- **Risks:** the resolver crosses many tables — isolation test is mandatory; keep it read-only.

### Phase 3.1 — Business impact + risk score composition
- **Scope:** compose Zone B/#3/#4 by reusing Epic-3 asset risk-propagation + criticality for
  resolved assets; deterministic finding risk score (severity × priority × confidence ×
  max-affected-criticality), explainable. No stored score (compose-at-read, ERIP-AD-19).
- **Files:** extend `findingContextResolver.ts` (compose), reuse `graphRiskPropagation.ts` /
  `riskDimensionRollup.ts`; no route change beyond the context payload.
- **Migrations:** none.
- **Flags:** business-impact fields gate additionally on `SECURELOGIC_RISK_INTELLIGENCE_ENABLED`;
  degrade to severity/priority-only when off.
- **Tests:** unit (score determinism, degradation when Epic-3 off) + isolation.
- **Risks:** avoid implying a computed score when Epic-3 data is absent — show "based on
  severity/priority" honestly.

### Phase 3.2 — Decision Workspace UI (Finding Detail redesign)
- **Scope:** rebuild `app/src/app/findings/[id]` into Zones A–F consuming the context endpoint;
  owner display + assign, SLA state, activity timeline, affected-context groups with deep links,
  intelligence drill-through, evidence, related findings. Dark; flag-off = today's detail.
- **Files:** `app/src/app/findings/[id]/page.tsx` + new components under
  `app/src/components/findings/` (DecisionHeader, ExecutiveImpact, AffectedContext,
  IntelligencePanel, EvidencePanel, RelatedFindings, ActivityTimeline); `app/src/lib/api.ts`
  (context fetcher). Reuse `assetKit`, `FindingCard`.
- **Migrations:** none.
- **Tests:** app typecheck; component/SSR smoke for flag-on vs flag-off; nav/lang tests extended.
- **Rollout:** dark behind the workspace flag; flag-off byte-identical.
- **Risks:** progressive-disclosure complexity — keep executive zones always-on.

### Phase 3.3 — Intelligence Event drill-through + Remediation tab — **SHIPPED (dark)**

Delivered on `develop` across PRs **#565–#569** (2026-07-09), all dark. Operator
decisions D1–D5 (below) and the three-flag reality govern it.

- **Scope delivered:** `/intelligence/[id]` drill-through view (event + sources +
  timeline + recommended actions + related findings); clickable Finding→event
  (Zone E) and Queue reciprocal link; Finding **Remediation tab**; `/actions`
  redirect + minimal **My Actions** view.
- **Files:** `app/src/app/intelligence/[id]/` (new — drill-through only, **NOT a
  list**), `app/src/lib/api.ts` (`getIntelligenceEvent`), `app/src/lib/intelligenceLinks.ts`,
  `findings/[id]/DecisionWorkspace.tsx` + `decisionTabs.ts` (tab), `queue`
  reciprocal link, `actions/page.tsx` + `myActions.ts`.
- **Migrations:** none. **No render.yaml, no new flag.**

**Operator decisions (approved 2026-07-09):**
- **D1 — reuse the existing engine route** `GET /api/intelligence/events/:id`
  (no new engine route, no migration).
- **D2 — app gating:** the drill-through surface, Remediation tab, and `/actions`
  redirect are behind `SECURELOGIC_DECISION_WORKSPACE_ENABLED`; the Queue
  reciprocal link rides the `SECURELOGIC_RISK_WORKSPACE_ENABLED` reskin branch.
- **D3 — Remediation is a tab** (re-layout of the existing always-on section; no
  new remediation logic); executive zones A–C stay always-visible above the tabs.
- **D4 — minimal My Actions** as the `/actions` redirect destination — a single
  session-scoped filter, **NOT** the P3.4 saved-views system; no Findings list redesign.
- **D5 — Brief → drill-through link DEFERRED** (the brief item view carries no
  event id; resolving the `cyber_signal_id → event_id` bridge is out of P3.3
  scope, awaiting a dedicated Brief-workflow package).

**Three-flag reality (staging validation):** the app surface needs
`RISK_WORKSPACE` (queue reskin + IA) **and** `DECISION_WORKSPACE` (finding detail,
drill-through, Remediation tab, `/actions`). The engine baseline is
`DECISION_WORKSPACE`; the drill-through enriches from the events route only when
the pre-existing `SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED` is also on, and
degrades honestly otherwise (renders from finding-context, or an honest
"unavailable" state) — it never blocks.

- **Tenant isolation (R5):** My Actions ownership derives from the session
  identity, never request input; fails closed to empty on missing identity.
- **Nav guard:** `applicationKnowledgeIndex.test.ts` asserts `/intelligence/[id]`
  carries `navLabel: null`, appears in no primary-nav destination, and has no
  `/intelligence` index route — Intelligence Events stay drill-through only (§6).
- **Test strategy:** pure-helper unit tests (fetcher, resolver, links, tabs, My
  Actions) + the nav guard. DOM/tab interaction is a documented RTL follow-up —
  the app has no RTL harness and none was faked.

### Phase 3.4 — Finding List redesign (executive + analyst framing)
- **Scope:** executive-framed list (attention tiles: overdue SLA, unassigned, awaiting
  approval; group-by asset/vendor/domain; saved views); links into the Workspace.
- **Files:** `app/src/app/findings/page.tsx`, `FindingsList.tsx`, new saved-view helpers.
- **Migrations:** optional `finding_saved_views` table **(the only candidate NEW-SCHEMA)** —
  or store views in existing `dashboard_preferences`-style JSON to avoid a table. Decide at
  phase start; default to reusing preferences (no migration).
- **Tests:** unit (grouping/filters), isolation if a table is added.
- **Risks:** if a saved-views table is added, it needs org scoping + RLS + dataClassification.

**Sequencing rationale:** resolver → impact → detail UI → drill-through/merge → list. Data
and composition first (provably org-safe), then presentation, then integration, then the
list. Each phase is independently dark and shippable; the program can stop after any phase.

---

## 9. Risks & tradeoffs (program level)

| Risk | Mitigation |
|---|---|
| Resolver crosses many tenant tables | Read-only + mandatory cross-org isolation test in 3.0 before any UI |
| Business impact implies precision it lacks when Epic-3 is off | Degrade honestly ("based on severity/priority"); gate impact on `risk_intelligence` |
| Progressive disclosure over-engineered | One page, executive zones always-on, no forked build |
| Scope creep into Package 4 | Brief-engine convergence, bulk Review Links, rollup consolidation stay OUT |
| Saved-views tempts a new table | Default to reusing preferences JSON; a table only with RLS+isolation |
| `/ai-systems` entitlement gap (open) | Track as the separate security slice; not folded into Package 3 |

## 10. What this design deliberately excludes

Package 4 and separate tracks — NOT in Package 3: brief-engine convergence; bulk Review
Links workflow; `/vendors`+`/vendors/risk` merge; `/posture` + Context-dashboard
consolidation; the `/ai-systems` entitlement fix + `getMe()` gating normalization (security
slice). A customer Intelligence Events **list** is rejected outright (§6).

---

*Design only. No engineering performed. Awaiting operator approval of scope, the phased plan,
and the §6 "drill-through, not nav" ruling before implementation.*
