# ERIP — Enterprise Risk Workspace (design memo)

Status: **Packages 1 & 2 APPROVED (2026-07-08) and IMPLEMENTED DARK.** Packages 3
(page merges) and 4 (workflow/brief convergence) remain proposals — NOT authorized.
Packages 1+2 shipped behind `SECURELOGIC_RISK_WORKSPACE_ENABLED` (default off, GATE B):
Finding-centric / Asset-context IA + enterprise-workflow navigation + the "Review
Suggested Links" queue reskin + Ask demotion. Flag off = legacy UI byte-for-byte.
See the Enterprise Risk Workspace section of `docs/validation/erip-tracker.md`.

Evidence base: **`ENTERPRISE-RISK-WORKSPACE-AUDIT.md`** (complete per-page audit,
end-to-end workflow trace, primary-object determination, implementation-leak catalog,
current/recommended IA, page-ownership matrix, packages, migration, risks). Every
recommendation here is grounded there.

Roadmap: `enterprise-risk-intelligence-platform.md` — this is a **presentation-layer /
information-architecture** program that sits on top of Epics 1–7 (all shipped dark). Its
natural home is **Epic 4 — Executive Intelligence** (the deferred "executive surfaces
(UI)" leg) plus a new **Risk-Operations UX** slice. It introduces **no new canonical
object** and **no new engine capability** — it presents, links, and consolidates what
already exists.

Foundation reused (all present in the repo today): the canonical `findings` / `actions` /
`risks` primitives; the `cyber_signals` + dark `intelligence_events` layer
(`SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED`); the applicability WORM decisions
(`enterprise-context`); the Asset Registry (`SECURELOGIC_ASSET_REGISTRY_ENABLED`); the
Epic-3 risk-propagation / dimensional-rollup APIs; the Epic-4 executive dashboard (#537,
`SECURELOGIC_RISK_INTELLIGENCE_ENABLED`); the matcher + `signal_match_suggestions` (`/queue`,
ratified in `docs/queue-ui-design-decisions.md`); `navigation.ts` flag system; the shared
`assetKit` / `FindingCard` components; the single `engineFetch` client.

Governance: **GATE B** — everything dark behind flags (default off), additive-only,
backward-compatible, `develop`-only, per-PR CI 8/8, squash-merge. **Flag-off must render
byte-for-byte today's UI.** No production enablement is requested by this memo.

---

## 1. Objective

Determine whether **every customer-facing page** has (a) a clear purpose, (b) a real
enterprise decision it supports, and (c) a fit with the long-term ERIP vision — and then
recommend, concretely: what to **redesign**, **merge**, **remove/demote**, the
**navigation** and **information architecture** changes, the **user workflows** the
workspace must support, and the **implementation sequence**. This is an end-to-end
product-workflow review, not a Findings/Queue patch.

Method: read-only audit of all customer surfaces under `app/src/app/**` (Dashboard,
Briefs, Ask, Queue, Findings, Actions, Risk Register, Approvals, Executive, Context,
Assets, Vendors, AI Systems, Vendor Assurance, Controls, Frameworks, Policies,
Obligations, Getting Started) plus `navigation.ts`, the entitlement/flag layer, and the
governing docs. Findings below are grounded in code.

---

## 2. Core diagnosis (four structural problems)

**P1 — The canonical intelligence object is invisible and disconnected.**
Briefs, the Queue, applicability (Context), and signal-sourced findings all sit on the
*same* canonical object (`cyber_signals`, now with `intelligence_events` on top). Yet there
is **zero UI cross-linkage** between them:
- Findings carry `source_type ∈ {signal, intelligence_event, cyber_signal}` and a raw
  `source_id`, but the UI **never renders or links it** — no drill-through to intelligence,
  no evidence, no asset, no business impact, no owner display.
- The Queue shows raw `match_reason` codes (`vendor_name_ilike`) and truncated `signal_id`
  UUIDs as primary language; the list endpoint already returns Intelligence-Event
  enrichment (`event_title`, `event_severity`, …) but `SuggestionList` reads
  `signal_title`/`signal_severity` — a **field-name mismatch bug** that forces the raw-UUID
  fallback.
- Briefs and applicability both reference the signal (`cyber_signal_id` / `signal_id`) but
  link to neither each other nor findings.

The ERIP spine — **Intelligence Event → affected asset/vendor → generated Finding →
Action → posture change, every hop explainable** — exists in data but is invisible in the
product. This is the single biggest gap.

**P2 — Rollup sprawl: ~8 overlapping "what needs attention / posture" surfaces.**
Dashboard (posture + findings widgets), Executive (KPIs/heatmap/trend/predictive), Ask
(prose posture summary), Findings (severity tiles), Risk Register (stat tiles), Actions
(stat tiles), Vendors **and** Vendors/Risk (two vendor rollups over identical fetches),
and the Enterprise-Context dashboard (a fourth posture rollup). The severity color palette
alone is re-declared in ≥5 files. There is no clear hierarchy of *which surface answers
which question*.

**P3 — Structural twins and duplicated work.**
Controls ≈ Obligations (near-identical assess→finding, evidence, framework-map, risk-link
cards — the code literally calls them "mechanical mirrors"). Vendors ≈ AI Systems (same
findings-join + sidebar + actions shape). Vendors list ≈ Vendors/Risk (same three fetches).
Framework→control mapping is edited from both Controls and Frameworks. Three separate
"overdue" trackers (control cadence, policy review cycle, obligation due date). Asset
Registry is a deliberate superset of Vendors + AI Systems awaiting flag flip.

**P4 — Pipeline jargon, dead ends, and gating inconsistency.**
The Queue speaks operator language ("Matcher queue", raw reason codes). The Actions page is
a read-only dead end — its rows link nowhere. Entitlement gating is inconsistent:
`/ai-systems` (list **and** detail) **omit** the entitlement redirect every other platform
surface enforces (token-only) — a real authorization gap; Findings/Risks/Queue check via
authoritative `getMe()` while Executive/Context/Assets trust the session cookie; Controls
gates differently from Obligations. Two brief systems (legacy `NewsletterIssue` +
canonical `IntelligenceBrief`) share the `/briefs/[id]` routes.

---

## 3. Page-by-page verdict (every customer-facing surface)

Legend: **Keep** · **Redesign** · **Merge** · **Demote/Consolidate** · **Fix** (correctness).

| Surface | Purpose clear? | Decision supported | ERIP fit | Verdict |
|---|---|---|---|---|
| **Dashboard** `/dashboard` | Partial | "What's my posture?" | Operational home | **Redesign** → the single "what needs my attention now" home; shed rollups that belong to Executive |
| **Executive** `/executive` (#537) | Yes | Board-grade risk/posture rollups | Epic 4 UI | **Keep** as THE board surface; it is the command center |
| **Briefs** `/briefs` `/briefs/[id]` | Yes | "What to act on this week?" | The wedge | **Redesign (linkage)** + **Merge** the two brief engines; converge on canonical `IntelligenceBrief` |
| **Ask** `/ask` | Weak | Prose posture Q&A | Utility | **Demote** from primary nav to a global command/assist element |
| **Queue** `/queue` | No (jargon) | "Accept suggested signal↔entity links" | Ratified customer surface | **Redesign** → "Review Suggested Links" + **Fix** enrichment bug; move under Intelligence. **Do NOT remove** (ratified) |
| **Findings** `/findings` | Partial | "Which findings need work?" | Core risk-ops | **Redesign** → decision-grade work queue: owner/SLA, intelligence drill-through, asset/vendor linkage, business impact, saved filters |
| **Actions** `/actions` | No (dead end) | "What remediation is open?" | Core | **Merge** into Findings as a "Remediation" tab; wire rows to their source |
| **Risk Register** `/risks` | Yes | "Which risks + treatments?" | Core | **Keep**; add intelligence provenance on signal-sourced risks |
| **Approvals** `/approvals` | Yes | "Approve/reject treatment plans" | Risk lifecycle | **Keep** but **surface in nav** under Risk (today it is orphaned from nav) |
| **Context** `/enterprise-context` | Yes (operator) | "Which signals apply; blast radius" | Epic 1/3 | **Keep (dark)**; it is the applicability/reasoning surface |
| **Context › Dashboard** `/enterprise-context/dashboard` | No | Fourth posture rollup | — | **Demote/Consolidate** into Dashboard/Executive; stop duplicating posture tiles |
| **Asset Registry** `/assets` | Yes | "What do we own; open which asset" | Epic 1 | **Keep (dark)**; canonical inventory when flag flips |
| **Vendors** `/vendors` | Yes | "Which vendor is risky / needs review" | Vendor Risk domain | **Merge** with `/vendors/risk` (list + analytics tabs, one surface) |
| **Vendors › Risk** `/vendors/risk` | Partial (dup) | Portfolio risk analytics | — | **Merge** into `/vendors` |
| **AI Systems** `/ai-systems` | Yes | "Which AI systems under governance" | AI Governance | **Keep** + **Fix** missing entitlement gate |
| **Vendor Assurance** `/vendor-assurance/*` | Yes | "Review this SOC report" | Vendor Risk back-office | **Keep** but **surface discoverability** from Vendors/Assets |
| **Controls** `/controls` | Yes | "Which controls overdue/failing" | Compliance | **Keep**; consolidate shared components with Obligations |
| **Obligations** `/obligations` | Yes | "Which obligations due/compliant" | Compliance | **Keep**; structural twin of Controls — share components now, consider merge later. **Fix** cosmetic non-functional status tabs |
| **Frameworks** `/frameworks` | Yes | "Which frameworks; how ready" | Compliance | **Keep** |
| **Policies** `/policies` | Yes | "Which policies overdue for review" | Compliance | **Keep** |
| **Getting Started** `/getting-started` | Yes | "What setup step next" | Onboarding | **Keep** (secondary nav) |
| **Audit Log** `/audit-log` | Yes | Admin audit | Ops | **Keep** (admin) |

Net: **0 hard deletions** (every surface has real data and a user), **5 redesigns**,
**4 merges/consolidations**, **2 demotions**, **3 correctness fixes**, the rest kept. The
work is *consolidation and linkage*, not teardown.

---

## 4. Recommended information architecture & navigation

Today's primary nav (10 groups): Dashboard · Briefs · Ask · Queue · Assets · Context ·
Executive · Compliance · Risk · Audit Log. Queue is an odd top-level peer; Approvals and
Vendor Assurance are not in nav at all; Ask consumes a prime slot for a utility.

**Proposed primary nav — organized around the five PRODUCT_VISION operating domains, with
Executive/Home on top:**

```
Home            → /dashboard         (operational "attention now" home)
Executive       → /executive         (board reporting)              [dark: risk_intelligence]
Intelligence ▾                        (NEW group — the intelligence workflow)
  · Briefs               → /briefs
  · Intelligence Events  → /intelligence (NEW view over cyber_signals/intelligence_events) [dark]
  · Review Links         → /queue     (reskinned "Review Suggested Links")
Risk ▾
  · Findings             → /findings
  · Remediation          → /findings?tab=actions  (Actions merged in)
  · Risk Register        → /risks
  · Approvals            → /approvals (surfaced from orphan state)
Assets ▾                              (Asset Registry when flag on; Vendors/AI as types)
  · Asset Registry       → /assets    [dark: asset_registry]
  · Vendors              → /vendors    (list+risk merged)  [hidden when registry on]
  · AI Systems           → /ai-systems [hidden when registry on]
  · Vendor Assurance     → /vendor-assurance/queue (surfaced)
Compliance ▾
  · Controls · Frameworks · Policies · Obligations
Context         → /enterprise-context [dark: enterprise_context]
Audit Log       → /audit-log          [admin]
```

Changes vs today: (1) new **Intelligence** group that gathers Briefs + a unified
**Intelligence Events** view + **Review Links** (Queue moves in, renamed, plain language);
(2) **Approvals** and **Vendor Assurance** surfaced into their owning groups instead of
being nav-orphans; (3) **Ask** demoted to a global assist element; (4) **Actions** folded
into Findings as "Remediation"; (5) `/vendors/risk` folded into `/vendors`. Every new nav
entry carries a feature flag; **flag-off nav is byte-identical to today** (WS-AD-4).

---

## 5. Pages to redesign / merge / remove — the explicit list

**Redesign (5):**
1. **Findings** → decision-grade work queue. Keep domain grouping; add owner/assignee
   display + SLA, **intelligence drill-through** (dark), asset/vendor linkage, business
   impact (Epic-3 propagation), saved/priority filters, pagination. NOT a new command
   center — Executive already owns board rollups.
2. **Queue → "Review Suggested Links."** Plain language; humanized "why matched" +
   confidence + affected entity; fix the `event_*`/`signal_*` enrichment bug; no raw
   signal IDs. Honors the ratified queue decision (reskin, not removal).
3. **Dashboard** → the single operational "attention now" home; drill-downs to
   Findings/Queue/Approvals; stop duplicating Executive's board rollups.
4. **Briefs** → link each brief item to its Intelligence Event → affected assets
   (applicability) → generated findings; converge the two brief engines (see Merge #4).
5. **Intelligence Events (new view)** → the customer-facing presentation of the canonical
   `intelligence_events`/`cyber_signals` object: what happened, who's affected, linked
   findings/suggestions. This is the connective tissue P1 is missing (dark).

**Merge / consolidate (4):**
1. **`/vendors` + `/vendors/risk`** → one vendor surface (working list + risk-analytics
   tab) over a single fetch set.
2. **`/actions`** → a "Remediation" tab inside Findings; rows link to their source finding.
3. **`/enterprise-context/dashboard`** rollup tiles → folded into Dashboard/Executive.
4. **Two brief engines** → converge on the canonical `IntelligenceBrief`; retire the legacy
   `NewsletterIssue` rendering path (tech-debt reduction, additive migration of views).
5. *(Longer-term, flagged for a later slice, not this program):* **Controls + Obligations**
   share so much they should share an assessment-component library now, with a possible
   page-level merge evaluated later.

**Remove / demote (2, no hard deletes):**
1. **Ask** → demote from primary nav to a global assist element.
2. **Enterprise-Context dashboard** → demote from a standalone rollup to a thin Context
   landing (or remove once its tiles live in Dashboard/Executive).

**Correctness fixes (3):**
1. `/ai-systems` list + detail: add the platform entitlement redirect every peer enforces
   (authorization gap).
2. Normalize the entitlement check to authoritative `getMe()` across platform surfaces
   (Executive/Context/Assets currently trust the cookie).
3. `/obligations` list status tabs are cosmetic/non-functional — wire or remove.

---

## 6. User workflows the workspace must support

1. **"What needs my attention now"** — Home → prioritized findings + pending review links +
   approvals awaiting me → one click into the record.
2. **The ERIP spine (signal→action trace)** — Intelligence Event → affected
   asset/vendor (applicability) → generated Finding → Action → posture movement, every hop
   a link with its reasoning. This is the workflow that makes SecureLogic an *operating
   layer*, not a feed.
3. **Triage suggested links** — Review Links → understand why matched + confidence →
   accept (creates canonical link, appears in applicability/findings) or dismiss.
4. **Vendor risk review** — Vendors → assess (with threat-intel context) → finding →
   action → review cycle → posture.
5. **Compliance readiness** — Framework → requirements → control/obligation mapping →
   assessment → finding → evidence → readiness score.
6. **Executive readout** — Executive board summary → drill into any dimension → domain page.

---

## 7. Decisions (WS-AD-#)

> **WS-AD-1 — Outputs consume, never define.** The workspace adds no new canonical object.
> The customer-facing "Intelligence Event" is the existing `intelligence_events`/
> `cyber_signals`, *presented and linked*, not a new store. (Reaffirms ERIP-AD-19 /
> CANONICAL_DOMAIN_MODEL.)

> **WS-AD-2 — One rollup hierarchy.** Executive = board reporting; Dashboard = operational
> home; per-domain pages = drill-downs. No new rollup surfaces; retire duplicates (P2).

> **WS-AD-3 — Queue is kept, reskinned, and relocated — not removed.** Honors
> `docs/queue-ui-design-decisions.md` and CANONICAL_DOMAIN_MODEL (`/queue` = ratified
> customer surface). Removing it from customer nav would reverse a ratified decision and
> is explicitly *not* recommended.

> **WS-AD-4 — Dark, additive, no regression.** Every change ships behind a flag; flag-off
> renders today's UI byte-for-byte. Intelligence linkage is double-gated on
> `SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED` and degrades gracefully to today's behavior
> when off. GATE B: no production enablement requested.

> **WS-AD-5 — Fix, don't fork.** Reuse `assetKit`, `FindingCard`, existing engine
> endpoints; consolidate duplicated components (severity palettes, vendor fetches) rather
> than add parallel ones. No new engine capability is in scope.

> **WS-AD-6 — Language contract.** No raw pipeline vocabulary (signal UUIDs, `match_reason`
> codes) as primary customer language. Plain enterprise language everywhere.

> **WS-AD-7 — Normalize gating.** Every platform surface gates consistently via
> authoritative `getMe()`; the `/ai-systems` gap is closed. (Correctness, not cosmetics.)

---

## 8. Implementation sequence (proposed — no code yet)

Each phase = its own PR(s), dark, additive, CI 8/8, squash-merge to `develop`, GATE B.
Ordered smallest-correct-first so value lands early and risk stays low.

- **Phase 0 — Approval & scoping.** This memo + the operator ruling on the four open
  decisions in §9. Confirm ERIP home (Epic 4 UI + Risk-Ops UX slice).
- **Phase 1 — Correctness & quick wins (no product decision needed).** Queue enrichment
  bug fix + "Review Suggested Links" language reskin; `/ai-systems` entitlement gate; a
  humanized "why matched" + confidence. Additive; low risk.
- **Phase 2 — Findings decision-grade v1.** Owner/SLA display; drill-through to the
  *already-live* `cyber_signals`/applicability trace (flag-independent); saved filters;
  pagination.
- **Phase 3 — Intelligence linkage (dark).** New Intelligence Events view + finding↔event↔
  applicability↔brief links, gated on `SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED`.
- **Phase 4 — IA / nav restructure.** Intelligence group; Approvals + Vendor Assurance
  surfaced; Ask demoted; Actions→Findings "Remediation" tab; `/vendors` + `/vendors/risk`
  merge. Behind a nav flag; flag-off byte-identical.
- **Phase 5 — Rollup consolidation.** Dashboard vs Executive de-duplication; retire the
  Context-dashboard rollup duplication; converge the two brief engines.
- **Phase 6 — Compliance component consolidation.** Shared Controls/Obligations assessment
  components (page merge evaluated separately, not committed here).

---

## 9. Open product decisions for the operator (STOP — approval required)

1. **Authorization / home.** Approve this as an ERIP presentation-layer package (Epic 4 UI
   + a Risk-Ops UX slice), superseding the ad-hoc Findings/Queue request? Which epic owns
   it of record?
2. **Nav restructure.** Approve the new **Intelligence** group + moving Queue into it +
   surfacing Approvals/Vendor Assurance + demoting Ask (all behind a nav flag)?
3. **Merges.** Approve merging `/vendors` + `/vendors/risk`, folding Actions into Findings,
   and demoting the Context-dashboard rollup?
4. **Brief convergence.** Approve retiring the legacy `NewsletterIssue` rendering in favor
   of the canonical `IntelligenceBrief` — or keep both?

## 10. Exit criteria (definition of done for the program)

- Every customer-facing page answers one clear enterprise question; no orphan nav surfaces.
- The signal→asset→finding→action→posture spine is a clickable, explainable path.
- No raw pipeline vocabulary or raw IDs as primary customer language.
- No duplicate rollup surfaces; one clear Home/Executive/domain hierarchy.
- Entitlement gating is uniform and correct across all platform surfaces.
- Everything ships dark; flag-off is byte-for-byte today's product; GATE B intact.

---

*Prepared as a read-only audit + design proposal. Awaiting operator approval before any
implementation, per CLAUDE.md ("stop after audit if the workflow requires a product
decision") and ERIP governance (per-epic design memo before implementation).*
