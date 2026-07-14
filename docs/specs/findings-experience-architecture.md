# Findings Experience — Product Architecture Review

> **Status:** THINKING ARTIFACT — read-only architecture review. **No build mandate.**
> Nothing here authorizes implementation, a migration, a flag, a route, a component, a
> ticket, or a branch. It informs **post-launch** direction only. It does **not** modify the
> July 15 launch scope; IQP and the pre-launch promotion own the calendar. It does **not**
> pause, redirect, or touch the IQP or EAR/ERIP workstreams.
> **Author:** Principal Product Architect pass, 2026-07-09. Grounded in code + governing docs at `develop`.

---

## 0. The reconciliation that reframes this whole review (read first)

The brief asked me to reconcile against three programs — the Canonical Domain Model, the
Enterprise Asset Registry (EAR), and the Intelligence Quality Program (IQP). I did. But the
**single most relevant in-flight program was not named in the brief**, and per the brief's own
rule — *"a recommendation that silently ignores in-flight architecture is a defect, not a
vision"* — I have to surface it before anything else:

> **The exact review you are asking for has largely already been done, ratified, and shipped
> dark.** It is called the **ERIP Enterprise Risk Workspace / Decision Workspace** (ERIP
> Package 3). It rests on the same premise you opened with — that today's Findings page "feels
> like a vulnerability management tool instead of an Enterprise Risk Intelligence Platform" —
> reaches largely the same conclusions, and is **already implemented behind
> `SECURELOGIC_DECISION_WORKSPACE_ENABLED` (default off)**.

Evidence (verified in code and docs, not asserted):

- **Diagnosis already on record.** `docs/architecture/erip/ERIP-ENTERPRISE-RISK-WORKSPACE-MEMO.md`
  §2 states four structural problems, of which **P1** is *"The canonical intelligence object is
  invisible and disconnected… the ERIP spine — Intelligence Event → affected asset/vendor →
  generated Finding → Action → posture change, every hop explainable — exists in data but is
  invisible in the product. This is the single biggest gap."* That is your thesis, verbatim.
- **The redesign is designed and approved.** `docs/architecture/erip/PACKAGE-3-DECISION-WORKSPACE-DESIGN.md`
  is marked *"APPROVED (2026-07-09) with modifications — IN IMPLEMENTATION."* It renames the
  Finding detail to **Decision Workspace**, reframes the Finding as *"the enterprise decision
  object — the unit of work the whole platform orbits."*
- **It has shipped dark.** Git history shows PRs **#559–#574** (Enterprise Risk Workspace IA →
  Finding Context Resolver → business impact → `decision_state` → Decision Workspace UI →
  Intelligence-Event drill-through → Remediation tab → Findings decision queue → Brief→Decision
  flow). Code confirms: `findings.decision_state` (migration `20260829`, 5-value enum
  `needs_review · accepted_risk · in_progress · mitigating · resolved`), `finding_review_marks`
  (per-user "What's Changed"), `intelligence_events` + children (`20260822`),
  `findings.source_type` extended with `intelligence_event` (`20260823`), and the flag gating
  the read-only `GET /api/findings/:id/context` resolver in `render.yaml`.

**What this means for this document.** This is not a greenfield "what should Findings be"
question. The honest answer to *"have we been solving the wrong problem?"* is: **the platform
team already concluded yes, and is mid-flight fixing it.** So my job is not to re-invent the
Decision Workspace. My job is to (1) tell you where the in-flight direction is **right** and
should be trusted, (2) **challenge** the specific new pipeline you floated, because parts of it
would *reverse* good rulings the platform has already made, and (3) fill the genuine gaps the
in-flight work does **not** yet answer — chiefly the **Day-0 lifecycle** and the **relevance
gate that decides when a Finding is even allowed to exist**.

Everything below is labeled **TODAY** (shipped, cited), **IN-FLIGHT** (EAR/IQP/ERIP, dark), or
**NET-NEW** (my proposal). I never blur them.

---

## 1. Current state — what the Findings experience is TODAY

**Shipped and live (flag-independent):**

- **The `findings` object is real and canonical.** `findings` table (`001_securelogic_platform.sql`,
  extended by `20260410_platform_primitives.sql` and later). Columns include `severity`, `domain`,
  `status` (`open/in_progress/closed`), `priority`, `owner_user_id` (FK → users), `due_date`,
  `confidence`, and the polymorphic `(source_type, source_id)`. `source_type` now spans 13 values
  (assessment, control_test, vendor_review, ai_review, ai_governance_review, vendor_cycle_review,
  obligation_review, dependency_review, cyber_signal, signal, intelligence_event, manual, risk,
  applicability_assessment). This is a genuine shared join point — every workflow on the platform
  funnels into it. It is **not** a vuln-management table; it is the platform's convergence object.
- **Findings are created from many sources, correctly.** Auto-creation fires from the cyber-signal
  matcher (`cyberSignalProcessingService.ts`), the five assessment workflows (on finding-triggering
  status transitions), the applicability dispatcher (ECL R2/Slice 6), and manual entry. Findings
  feed the posture engine (`DomainRiskAggregationEngineV2`).
- **The current Findings *page*** (`app/src/app/findings/`) is, per the ERIP audit and your own
  description: KPI/severity tiles + filters + search + a grouped list, with a detail page at
  `/findings/[id]`. The ERIP page-verdict grades it **"Partial — 'Which findings need work?'"**
  and flags that the UI *"never renders or links"* the finding's `source_id` — no drill-through to
  intelligence, no affected asset/vendor, no business impact, no owner display.

**Shipped but DARK (flag off — not what a customer sees today):**

- **Decision Workspace** (`SECURELOGIC_DECISION_WORKSPACE_ENABLED`): `decision_state`, the
  `GET /api/findings/:id/context` resolver (`findingContextResolver.ts`), the Zone A–F detail
  rebuild, the Intelligence-Event drill-through (`/intelligence/[id]`), the Remediation tab, and
  the decision-queue list with attention tiles + urgency grouping.
- **Intelligence Events** corroboration layer (`SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED`):
  `intelligence_events` + `intelligence_event_sources` + `intelligence_event_timeline`.
- **EAR Asset Registry** (`SECURELOGIC_ASSET_REGISTRY_ENABLED`): `asset_registry_v`, unified
  asset context.

**The accurate one-sentence current state:** *Flag-off, a customer sees a flat, source-blind
severity list — which reads like vuln management. Flag-on (dark, not yet enabled), the Decision
Workspace already turns each finding into a decision record with impact, affected context,
evidence, and a drill-through to its intelligence. The gap you feel is real for the shipped
product and mostly closed in the dark product.*

---

## 2. Challenge: your proposed pipeline is half-right, and the wrong half would violate the domain model

You floated: **Signals → Correlation → Insights → Findings → Decisions → Actions → Outcomes**,
and explicitly asked me to interrogate *"whether intermediate stages are genuine customer-facing
concepts or system plumbing dressed up as product objects."* Good instinct. Here is the verdict,
stage by stage, against what actually exists.

| Your stage | Real object today | Verdict | Why |
|---|---|---|---|
| **Signals** | `cyber_signals` (global, `org_id IS NULL`) | ✅ **Keep — but as PLUMBING, invisible** | Correct as a stage; a raw signal must never be a customer-facing surface (PRODUCT_VISION: *"not a generic alert feed"*). |
| **Correlation** | normalize + dedup + `intelligence_events` corroboration | ✅ **Real, but PLUMBING** | This is exactly "plumbing dressed up as product." Corroboration is a data-quality operation, not a decision the customer makes. Do **not** promote it to a product noun. |
| **Insights** | *nothing* | ❌ **Cut it** | There is no durable "Insight" object, and there should not be. What you mean by "insight" already lives in two places: the **Brief item** (editorial "why it matters") and the finding's **Executive Decision Summary** (Decision Workspace Zone A). A new `insights` object would be a parallel concept the Canonical Domain Model forbids ("one concept, one object"; "outputs consume, not define"). |
| **Findings** | `findings` (canonical) | ✅ **The spine** | The org-contextualized "this affects you." Correct and load-bearing. |
| **Decisions** | `findings.decision_state` (shipped, `20260829`) | ⚠️ **Not a separate object — it's a STATE on the Finding** | The platform already ruled this: Decision is a *business-decision state* on the finding (`needs_review → accepted_risk/in_progress/mitigating → resolved`), deliberately separate from operational `status`. A standalone `decisions` table would duplicate the finding and split the audit trail. **Do not build it.** |
| **Actions** | `actions` (canonical) | ✅ **Keep** | Downstream remediation unit; already exists, already links `(source_type='finding')`. |
| **Outcomes** | posture snapshot delta + evidence + audit | ⚠️ **Not a separate object — it's MEASURED, not stored** | "Outcome" = the posture-score movement after an action closes, plus the evidence and the audit trail that make it defensible. Those are three existing objects. An `outcomes` table would fake a durable entity out of a computed delta. |

**The through-line of the challenge:** your seven-stage pipeline conflates **plumbing**
(Signals, Correlation) and **derived state/measurement** (Decisions, Outcomes) with **genuine
customer objects** (Finding, Action). Four of the seven "stages" should never be nouns the
customer manages, and two of them (`Insights`, and standalone `Decisions`/`Outcomes` objects)
would actively **violate** the "one concept, one object / outputs consume, not define" rulings
that the whole platform is built on. If we implemented your pipeline literally, we would
re-introduce precisely the parallel-object sprawl the Canonical Domain Model exists to prevent.

**The pipeline that is actually correct** — and that the platform has already largely
converged on — is narrower. Only **four nouns** are ever customer-facing, and only **one** is
the object of work:

```
   (plumbing, invisible)         (the decision)        (the work)      (the proof of impact)
 Signal ─► Correlation ─► Intelligence Event ─► FINDING ─► Action ─► Posture / Outcome
 (cyber_    (dedup +        (corroborated,        (decision   (remedi-   (score delta +
  signals)   intelligence    drill-through only)   object)     ation)     evidence + audit)
             _events)              │                  ▲
                                   └── Applicability / Suggested Link ──┘
                                       (the RELEVANCE gate that decides
                                        whether a Finding is born at all)
```

- **Customer-facing nouns:** Intelligence Event (drill-through only), **Finding** (the object
  they manage), Action, Posture. That's it.
- **The Finding *carries* the decision** (`decision_state`), the **impact** (composed at read,
  ERIP-AD-19), the **evidence**, and links to its **intelligence** and **affected assets** — it
  is not one bead on a chain of seven equal beads. It is the center of gravity.
- **The one concept you were reaching for with "Insights" already exists and is better-named:**
  it is the **relevance decision** — the Applicability Assessment / Suggested Link — the thing
  that exists *before* a Finding and decides whether the Finding is even allowed to be born
  (Section 4). Your instinct that "something belongs before Findings" is correct. It is not an
  Insight. It is applicability.

---

## 3. Start with the customer — the Day-0 CVE lifecycle (the centerpiece)

New Platform Pro customer, Day 0: onboarded, three vendors added — Microsoft, Adobe, Cisco. No
findings. The platform knows Vendors, Assets, AI Systems, Business Units, Controls, Frameworks,
Owners. Next morning Microsoft publishes a critical CVE. Here is what the platform **should** do —
grounded in what exists TODAY, what is IN-FLIGHT, and where the genuine NET-NEW gaps are.

### Stage 1 — Ingestion & correlation (invisible; the customer sees nothing, correctly)
The CVE arrives via the NVD / CISA-KEV adapters → normalized → deduped → `cyber_signals` (global,
`org_id IS NULL`). If KEV and NVD both carry it, correlation collapses them into one
**Intelligence Event** with corroborating sources (IN-FLIGHT, `intelligence_events`, dark).
**The customer is shown nothing at this point, and that is correct** — a raw global signal is not
their problem yet. *(IQP caveat, TODAY: the recency and per-org relevance gates are the exact
defects IQP Q3/Q4 are fixing before launch. This lifecycle assumes those gates land — they are
launch-blocking and owned by IQP, not this review.)*

### Stage 2 — Relevance / applicability (THE decisive gate — "does it affect me?")
The matcher runs **per org**. Microsoft is a monitored vendor → the signal matches. The
*intended* design has two clean branches, and the distinction is the most important design point
in the whole experience:

- **High-confidence, unambiguous match** → an **Applicability Assessment** resolves `affected`
  (with a confidence band and a WORM, hash-chained reasoning trace — EAR/ECL, shipped dark) →
  **a Finding is created.**
- **Ambiguous / lower-confidence match** → a **Suggested Link** lands in the **Review Suggested
  Links** queue (`signal_match_suggestions`, shipped; `/queue`, ratified) for a human to accept
  or dismiss.

> **Honest note on shipped mechanics (TODAY, verified in code — do not blur with the ideal):**
> the platform does **not** yet run this as one governed gate. There are *four* finding-creation
> paths that each decide "born or not" their own way: the cyber-signal matcher
> (`cyberSignalProcessingService.ts`) creates a `cyber_signal` finding **directly at match time**;
> intelligence-event reconciliation (`eventFindingStore.ts`) **upserts one finding per (org,
> event)**; the applicability dispatcher (`applicabilityWorkflowDispatcher.ts`) creates
> `applicability_assessment` findings; and **accepting a Suggested Link writes a `signal_*_link`,
> not a finding** — the link then surfaces as *affected context* on whatever finding exists. So
> "when is a finding born" is currently **implicit and inconsistent across paths**. That
> inconsistency is precisely why the explicit relevance gate below is the top NET-NEW
> recommendation, not a nice-to-have.

> **This answers your sharpest questions directly:**
> - *"Should a finding be created immediately?"* — **No.** Not at ingest.
> - *"Should the system first determine relevance?"* — **Yes. Relevance is the gate.**
> - *"Is there another concept that should exist before a finding?"* — **Yes, and it already
>   exists:** the Intelligence Event (the corroborated what-happened) and the Applicability
>   Assessment / Suggested Link (the is-it-mine decision). This is the "Insight" you were
>   reaching for — already built, and correctly named for a GRC/audit platform.
> - *"When does a 'finding' actually come into existence?"* — **When relevance clears** — either
>   applicability = `affected`, or a human accepts a suggested link. A Finding is the *result of
>   a relevance decision*, never a mirror of a raw signal.

Why this matters commercially: creating a finding per CVE-times-vendor is how you rebuild a
vulnerability scanner and drown the CISO. Creating a finding only when *this org's* context is
implicated is how you become an intelligence platform. The gate is the product.

### Stage 3 — The Finding is born as a decision record (not an alert)
The moment relevance clears, the Finding exists as the org-contextualized decision object,
carrying (Decision Workspace, IN-FLIGHT dark, §2 of the Package-3 design — 20 of 21 fields are
EXISTS/DERIVE/COMPOSE from canonical data, **no new tables**):
title/severity/domain; **Executive Decision Summary** ("actively-exploited RCE in a payments-path
vendor — decide escalation now"); **Business Impact** (revenue/operational/regulatory/customer/
third-party, composed from affected-entity criticality + Epic-3 risk propagation); **affected
vendor** = Microsoft (→ affected assets/AI/processes/controls/obligations that depend on it, via
the EAR graph); **owner** + **SLA/due date**; **evidence & sources** (KEV, NVD, advisory);
**confidence**; **recommended action**; `decision_state = needs_review`.

### Stage 4 — Discovery (how the customer first meets the issue)
Three legitimate entry points, in priority order — **never** an event feed:
1. **Dashboard "what needs attention now"** (the operational home) → deep-links into the finding.
2. **The weekly Intelligence Brief** (the editorial wedge) → the brief item links to its
   Intelligence Event → the findings it generated (Brief→Decision flow, IN-FLIGHT, PR #572).
3. **The Findings decision queue** — attention tiles (Critical / Overdue SLA / Unassigned /
   Awaiting approval) + urgency grouping (IN-FLIGHT, PR #571), not a flat severity list.

### Stage 5 — The decision the customer is actually making
Not "read this alert." The four decisions the Decision Workspace is built to drive:
**(a) Triage** — is it real and ours, how urgent? **(b) Impact** — what business is exposed, how
much? **(c) Action** — Accept Risk / Remediate / Escalate, with an owner and SLA. **(d) Proof** —
the evidence, sources, and reasoning that make it defensible. `decision_state` moves
`needs_review → in_progress / accepted_risk / mitigating → resolved`; operational `status` tracks
the workflow separately. For a risk that warrants formal governance, it can be promoted into the
**Risk Register** and run the shipped **9-state risk lifecycle** (approvals, SoD, evidence —
`risk-lifecycle-spec.md`).

### Stage 6 — Action → Outcome (measured, not stored as an entity)
An **Action** (request Microsoft's remediation SLA; apply a compensating control on the payments
path) is created, owned, tracked. On close, **evidence** is attached; the **posture snapshot**
recomputes; the **audit trail** records every transition. The "**Outcome**" is that posture
movement + the evidence + the audit record — the answer to *"I can prove why we acted"* — not a
new table.

**What's genuinely NET-NEW / not-yet-built in this lifecycle** (candidates, not mandates —
see §10 and Decisions): (a) an **explicit relevance threshold policy** that decides auto-finding
vs. suggested-link vs. suppress, per source and per org — today this is implicit in matcher
branches and the IQP Q4 interim gate; (b) **finding de-duplication / clustering** so re-published
or re-corroborated CVEs update one finding instead of spawning duplicates (IQP defect #8 is the
signal-side analog); (c) a first-class **"suppress / not-relevant" decision** on the finding that
is itself auditable (accepting that "we looked and it doesn't apply" is a defensible GRC output).

---

## 4. Core entities and how they relate (reconciled with EAR + Canonical Domain Model)

No new canonical object is proposed. The relationships that matter for this experience, all
existing:

```
cyber_signals (global)
   └─(normalize+dedup+corroborate)─► intelligence_events ──────────┐  ALIGNS (shipped dark)
                                          │  (drill-through only)   │
   matcher (per-org, at ingest) ─► signal_match_suggestions ─► signal_*_links   ALIGNS (shipped)
                                          │  (Review Links /queue)  │
   applicability engine (ECL) ─► applicability_assessments (WORM) ──┘  ALIGNS (shipped dark)
                                          │  (the RELEVANCE decision)
                                          ▼
Organization ─► FINDING  (source_type/source_id → the thing above)   ALIGNS (canonical)
   │  carries: decision_state · owner · SLA · confidence · severity · domain
   │  composes (read-time): business impact, risk score  ← Epic-3 propagation (ERIP-AD-19)
   │  resolves (read-time): affected assets/vendors/AI/processes/controls/obligations
   │                         ← EAR asset_registry_v + enterprise_relationships graph
   ├─► Action  (source_type='finding')                               ALIGNS (canonical)
   ├─► Evidence (source_type='finding')                              ALIGNS (canonical)
   ├─► (promote) Risk (register) ─► 9-state lifecycle + approvals     ALIGNS (shipped)
   └─► Posture Snapshot (recomputed)  = the "Outcome"                 ALIGNS (canonical)
```

- **EAR reconciliation (ALIGNS):** the finding's affected-context (assets, and the cloud/
  endpoint/app/process assets that depend on the affected vendor) resolves through
  `asset_registry_v` and the `enterprise_relationships` graph (EAR-AD-2/AD-3/AD-4). The Decision
  Workspace's "affected context" zone is exactly the consumer the EAR federation was built to
  serve. **This review adds no requirement to EAR and reverses none of its rulings.**
- **"Decision" and "Outcome" as objects (CONTRADICTS your pipeline, ALIGNS with the platform):**
  Decision is `findings.decision_state`; Outcome is a posture delta + evidence + audit. Neither
  becomes a table.

---

## 5. The purpose of the current Findings workspace

**What it is for:** the single place a risk/GRC operator converts *externally- and
internally-sourced intelligence about their organization* into an **owned, evidenced, defensible
decision and remediation** — and can prove, to leadership and auditors, why they acted. It is the
platform's **convergence surface**: every domain (vendor, AI, compliance, threat intel, internal
assessment, applicability) produces the same `findings` object, so the operator works one queue,
not seven module-specific lists.

**What it is NOT (and where the flat list misleads):** it is not a vulnerability list, not an
alert inbox, not a database table browser. The current flag-off page reads like the first because
it renders findings as source-blind severity rows. The Decision Workspace fix is not cosmetic —
it changes the *unit* from "an alert to read" to "a decision to make and defend."

---

## 6. Is "Findings" the correct name?

**Split answer — and this is a real, non-cosmetic decision (see Decision 3).**

- **Keep the canonical *object* named `Finding`.** In GRC/audit, "finding" is the defensible,
  auditor-recognized term for "an identified issue requiring disposition." Renaming the domain
  object would churn 13 `source_type` values, the API, the DB, the posture engine, and every
  workflow — for negative benefit. The Canonical Domain Model's "one concept, one object" makes
  this the anchor noun. **Do not rename the object.**
- **Reframe the customer *surface*.** The problem was never the word on the object; it was that
  the *surface* presents findings as a flat list. The in-flight direction already resolves this:
  the **detail** is the **"Decision Workspace"** and the **list** is a **decision queue** with
  attention framing. My recommendation: keep "Findings" as the object and the list label (audit
  credibility), and let "Decision Workspace" carry the decision framing on the detail — which is
  exactly what Package 3 shipped. If leadership wants the *nav label* to read less like vuln
  management, "Risk Decisions" or "Risk Queue" is defensible — but that is a marketing/label
  decision, not an architecture one, and it must not rename the object.

---

## 7. Information architecture that best supports the decisions

The ERIP memo already specifies this and it is sound; I endorse it rather than reinvent it, with
one addition. The IA that serves the four decisions (triage → impact → proof → action) on one
page, with progressive disclosure so one page serves both executive and analyst:

- **Zone A — Decision Header** (always on): title · Executive Decision Summary · Priority ·
  Business Impact headline · **Decision State** · Operational Status · Owner · SLA · Risk Score ·
  Confidence. Primary actions: Assign · Status · Accept Risk · Escalate.
- **Zone B — What's Changed** since last review (powered by `finding_review_marks`).
- **Zone C — Business Impact** (own zone): revenue / operational / regulatory / customer /
  third-party.
- **Zone D — Affected Context** (expandable): assets · vendors · AI · business processes ·
  controls · obligations, each deep-linking out (EAR graph).
- **Zone E — Evidence & Intelligence** (expandable): supporting Intelligence Events
  (drill-through) · sources · evidence · confidence · timeline.
- **Zone F — Recommendation & Action** (always on): recommendation + remediation actions.
- **Zone G — Context rail:** related findings · activity.

**My one addition (NET-NEW, candidate):** Zone A should show a **relevance/why-this-is-yours
line** sourced from the applicability reasoning — one plain sentence ("matched because Microsoft
is a monitored vendor in your payments path; confidence 92"). It closes the "why am I seeing
this?" question that separates intelligence from noise, and it is composable from data that
already exists (applicability `reasoning_steps`). No schema change.

---

## 8. How search should work and what it should return

**Principle: search returns *decisions and the things you act on*, not database rows.** A CISO
searching "Microsoft" is asking *"what is my Microsoft exposure and what do I need to decide"* —
not "grep the findings table."

- **Scope:** cross-object, org-scoped, entitlement-aware. One query should return, grouped:
  **Findings** (open decisions), the **Vendor/Asset/AI/Obligation** entities themselves,
  **Intelligence Events** that mention it (drill-through), and **open Actions**.
- **Rank by decision-urgency, not recency or string score:** open + high-severity + overdue-SLA +
  unassigned float to the top; resolved/accepted-risk sink. Reuse the same attention signals the
  decision queue already computes.
- **Return the decision affordance inline:** a result row shows owner/SLA/decision-state and links
  into the Decision Workspace — the operator can act from the result, not just navigate.
- **Honest scoping caveat (TODAY):** there is no cross-object search service today; this is a
  **NET-NEW** capability, and a real one (candidate, not a mandate). It should be built on the
  *existing* objects and org-scoping, never as a new index that re-stores finding content
  (that would re-create the "outputs define" anti-pattern). Deferred — see §10.

---

## 9. Relationship modeling — reconciled against the EAR relationship model

The finding-to-everything relationships this experience needs are **already modeled**; this
review requires **no new edge types and no new tables**:

- **Finding → source intelligence:** `findings.(source_type, source_id)` → `intelligence_events`
  / `cyber_signals` / assessment records. ALIGNS (shipped).
- **Finding → affected vendors / AI / controls / obligations:** via `signal_*_links` (typed,
  authoritative — ECL AD-13) and applicability affected-entities. ALIGNS (shipped).
- **Finding → affected assets / business units / processes (the dependency blast radius):** via
  `asset_registry_v` + `enterprise_relationships` recursive resolver (EAR-AD-2/3/4). ALIGNS
  (shipped dark). This is where "Microsoft CVE → the *assets and business processes that depend on
  Microsoft*" is answered — the EAR graph is precisely that dependency substrate.
- **Finding → business impact / risk score:** composed at read-time from affected-entity
  criticality + Epic-3 propagation (ERIP-AD-19: *compose, never store*). ALIGNS.
- **Finding → Action / Evidence / Risk / Posture:** canonical `(source_type, source_id)` +
  promotion to the risk register. ALIGNS.

**The single reconciliation rule for this whole experience:** the Decision Workspace is a
**read/compose layer** over canonical objects (Package-3 design §8: *"no new tables are
required"*). Any future temptation to give a finding its own copy of asset names, criticality, or
impact scores must be refused — read it through the registry/graph/propagation, exactly as EAR-AD-2
refuses attribute duplication. The moment a finding *stores* what it should *resolve*, we have
re-created the drift the entire EAR federation exists to prevent.

---

## 10. Do Not Build Yet (promising, explicitly OUT of implementation scope until approved)

These are recorded so they are not silently smuggled into a build. **None is authorized.**

1. **An `insights` object / "Insights" stage.** Cut from the pipeline (§2). What it means already
   lives in the Brief and the finding's Executive Summary. A new object would violate "one concept,
   one object."
2. **Standalone `decisions` and `outcomes` tables.** Decision = `decision_state` (shipped);
   Outcome = posture delta + evidence + audit. Do not table-ify derived state.
3. **A customer-facing Intelligence Events *list* / nav page.** Explicitly **rejected** in the
   Package-3 design §6 (recreates the alert feed PRODUCT_VISION forbids). Intelligence Events stay
   **drill-through only**. Reopen only if a threat-intel-analyst persona is proven — and then as a
   saved view, not a top-level page.
4. **"Correlation" as a customer surface.** It is data-quality plumbing. Never a product noun.
5. **Cross-object decision search** (§8) — genuinely valuable, genuinely NET-NEW, but a real
   engineering effort and post-launch. Design before build; build on existing objects, never a
   content re-store.
6. **Explicit per-source/per-org relevance-threshold policy** (auto-finding vs. suggested-link vs.
   suppress) and **finding clustering/dedup** (§3) — the correct long-term home for "when is a
   finding born," but they touch the matcher and must not be conflated with the launch-blocking IQP
   Q4 interim relevance gate. Post-launch, own memo.
7. **Auditable "not-relevant / suppress" disposition** on a finding (§3) — promising GRC output;
   design later.
8. **Any GATE B production enablement** of Decision Workspace, Intelligence Events, EAR, or the
   risk lifecycle. Out of scope for this review entirely; owned by the operator and the enablement
   runbooks.

---

## 11. Recommendations for the evolution into a true Enterprise Risk Intelligence Platform

Ordered smallest-correct-first, all post-launch, all reconciled with in-flight work:

1. **Trust and finish the in-flight Decision Workspace direction — do not fork a competing
   redesign.** It already encodes this review's conclusions. The highest-leverage next step is
   *staging validation and eventual enablement* of the flags that are already dark, not new design.
2. **Make the relevance gate explicit and first-class** (§3, §10.6) — this is the true dividing
   line between "intelligence platform" and "vuln scanner," and it is the one place the current
   architecture is implicit rather than designed.
3. **Complete the clickable signal→finding→action→posture spine end-to-end** (ERIP P1) so every
   hop is explainable — the EAR graph and applicability reasoning make this achievable without new
   objects.
4. **Add the "why this is yours" relevance line and cross-object decision search** (§7, §8) as the
   two features that most change the *felt* product from "records" to "investigation."
5. **Hold the domain-model line under pressure:** every new domain (privacy, operational risk,
   future) should produce the *same* `findings` object and be *composed* into the same Decision
   Workspace — never a new parallel list. That discipline, more than any UI, is what makes this one
   unified intelligence experience instead of a feature pile.

---

## DECISIONS FOR SIMMEE

Every item that would change shipped behavior, rename a customer-facing concept, or redirect a
roadmap. **Nothing here self-authorizes; each needs an operator ruling.** All are **post-launch**;
none touches July 15 scope, IQP, or EAR.

**Decision 1 — Does this review supersede or duplicate the in-flight ERIP Decision Workspace?**
The Decision Workspace (Package 3, PRs #559–#574) already implements most of what this review would
recommend. *Options:* (a) **Ratify that ERIP Decision Workspace is the canonical answer to
"fix Findings," fold this review's net-new items (relevance gate, why-yours line, search) in as
post-launch candidates under ERIP, and do NOT open a competing redesign** *(recommended)*;
(b) treat this as an independent redesign track (risks duplicating/forking an approved, shipped-dark
program — I advise against). **My recommendation: (a).**

**Decision 2 — Reject the `Insights` / `Decisions`-object / `Outcomes`-object stages of the
proposed pipeline?** They would create parallel objects the Canonical Domain Model forbids.
*Options:* (a) **Adopt the narrower spine — Intelligence Event → Finding(+decision_state) →
Action → Posture — and formally drop Insights/Decisions/Outcomes as objects** *(recommended)*;
(b) keep exploring them as objects (I advise against — it reverses "one concept, one object" and
"outputs consume, not define"). **My recommendation: (a).**

**Decision 3 — Naming.** *Options:* (a) **Keep the object `Finding`; keep the list labeled
"Findings"; let "Decision Workspace" carry the decision framing on the detail** *(recommended —
matches shipped Package 3, preserves auditor language, zero domain-model churn)*; (b) relabel the
nav/list to "Risk Decisions"/"Risk Queue" (marketing decision; object still `Finding`); (c) rename
the object (rejected — high-churn, negative benefit). **My recommendation: (a).**

**Decision 4 — Make the relevance gate an explicit, governed policy (post-launch).** Today "when
is a finding born" is implicit in matcher branches + the IQP interim gate. *Options:* (a)
**Commission a post-launch design memo for a per-source/per-org relevance-threshold + finding-dedup
policy, explicitly downstream of and non-interfering with launch-blocking IQP Q4** *(recommended)*;
(b) leave it implicit (accepts ongoing "vuln-scanner-feel" risk as coverage grows). **My
recommendation: (a), scheduled after launch.**

**Decision 5 — Authorize (later, separately) the two genuinely NET-NEW capabilities:** cross-object
decision search (§8) and the auditable "not-relevant/suppress" finding disposition (§3). *Options:*
(a) **park both in "Do Not Build Yet," require a design memo each before any build** *(recommended)*;
(b) authorize design now (premature pre-launch). **My recommendation: (a).**

---

*Prepared as a read-only thinking artifact. No code, migration, flag, route, component, test, or
ticket was created. Awaiting operator rulings on Decisions 1–5 before any of the net-new items are
designed, and explicitly deferring to IQP and the pre-launch promotion for the July 15 calendar.*
