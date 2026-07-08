# ERIP — Enterprise Risk Workspace: Complete Product Audit (evidence base)

Status: **AUDIT COMPLETE — evidence base for `ERIP-ENTERPRISE-RISK-WORKSPACE-MEMO.md`.**
Read-only. No application code, migration, flag, or `render.yaml` change was made to
produce this document.

Method: file-level read of every customer-facing surface under `app/src/app/**`, the nav /
entitlement / flag layer (`app/src/lib/navigation.ts`, `app/src/app/layout.tsx`,
`app/src/lib/api.ts`), the engine routes those surfaces call, and the governing docs
(`PRODUCT_VISION.md`, `CANONICAL_DOMAIN_MODEL.md`, `BUILD_SEQUENCE.md`,
`docs/queue-ui-design-decisions.md`, the ERIP roadmap + tracker). Every claim is grounded
in a cited file. Where the original task premise disagrees with the code, the code wins and
the disagreement is stated.

Governing constraints acknowledged up front: **GATE B** (dark flags, no production
enablement), additive-only, `develop`-only, per-epic design memo before implementation.
This document is that audit; the companion memo carries the recommendations and the
approval asks, which appear only at the end (§10) per the operator's instruction.

---

## 1. Per-page evaluation — every customer-facing surface

Each entry answers: **primary user · business decision · workflow · value · exposes
implementation detail? · verdict.** Verdicts: Keep / Redesign / Merge / Move / Retire /
Fix (correctness).

### 1.1 Dashboard — `/dashboard` (`page.tsx` 570, `PostureDashboard.tsx` 587, `DashboardCharts.tsx` 1123)
- **User:** every signed-in user (free → team); it is the post-login landing.
- **Decision:** "What is my posture and what needs work?"
- **Workflow:** consume → drill down. 12-tile customizable widget grid (FindingsDonut,
  DomainPostureBars, ActionsRing, OpenItemsAging, RiskHeatmap, FrameworkGaps, …) + Latest
  Brief card; deep-links to `/findings`, `/actions`, `/risks`, `/vendors`, `/posture`.
- **Value:** high for platform tier (real posture); for free/Brief tier it is a blurred
  `SamplePostureDashboard` upsell.
- **Implementation leak:** none material; it is business-framed.
- **Verdict: Redesign** → make it the single operational "attention now" home; it currently
  duplicates Executive's board rollups (see P2).

### 1.2 Executive — `/executive` (8 components, 810 LOC; shipped #537)
- **User:** executive / board audience.
- **Decision:** "What is enterprise risk posture and movement across dimensions?"
- **Workflow:** read board summary → KPIs / trend / heatmap / comparison / predictive /
  connector-health. Dark behind `SECURELOGIC_RISK_INTELLIGENCE_ENABLED`.
- **Value:** high; this **is** the enterprise command center the original brief asked to
  "build." It already exists.
- **Leak:** none.
- **Verdict: Keep** — canonical board surface. A second "Findings command center" would
  duplicate it.

### 1.3 Posture — `/posture` (318)
- **User:** platform GRC owner.
- **Decision:** "What is my detailed posture score + domain breakdown over time?"
- **Workflow:** dedicated posture detail; dashboard tiles deep-link here.
- **Value:** medium; overlaps both the Dashboard PostureDashboard and Executive.
- **Verdict: Consolidate** — a third posture surface; fold into the Dashboard/Executive
  hierarchy.

### 1.4 Briefs — `/briefs` (list 171), `/briefs/[id]` (1060), signal detail routes (576 + 338)
- **User:** executive reader (the wedge audience).
- **Decision:** "What changed this week and what do I act on, by when?"
- **Workflow:** read masthead → urgency buckets → action roadmap → per-signal detail.
- **Value:** high — the commercial wedge.
- **Leak:** **two brief engines coexist** on the same routes — legacy `NewsletterIssue`
  (`sections_json`) and canonical `IntelligenceBrief` (`items[]`); the detail page probes
  both and biases to canonical (`briefs/[id]/page.tsx:1040-1057`). The customer never sees a
  unified "Intelligence Event"; the canonical `cyber_signal_id` is used only as an internal
  join key (`briefs/[id]/signal/item/[index]/page.tsx:129-178`), never surfaced or linked.
- **Verdict: Redesign (linkage) + Merge (engines).**

### 1.5 Findings — `/findings` (page 273, `FindingsList.tsx` 109, `FindingCard.tsx` 181), detail (413)
- **User:** platform GRC / risk owner.
- **Decision:** "Which findings need work, and what do I do about each?"
- **Workflow:** filter (status/severity/type/priority) → domain-grouped cards → inline
  status transition → detail (priority, due, accept-risk, create action). **Already grouped
  by domain with 6 summary tiles — not a flat scroll list** (corrects the task premise).
- **Value:** high potential, under-realized.
- **Leak / gap:** finding carries `source_type ∈ {signal, intelligence_event, cyber_signal,
  …}` + raw `source_id`, but the UI **never renders or links it** (`findings.ts:359-385`
  returns `source_id`; no UI consumer). No owner/assignee display (data has `owner_user_id`,
  no control), no asset linkage (no asset field at all), no evidence/citation, no business
  impact, no pagination (requests `limit:100`).
- **Verdict: Redesign** → decision-grade work queue (owner/SLA, intelligence drill-through,
  asset/vendor linkage, business impact, saved filters).

### 1.6 Actions — `/actions` (page 304; + 5 unrelated server-action `.ts` modules)
- **User:** platform user managing remediation.
- **Decision:** "What remediation is open / overdue / high-priority?"
- **Workflow:** filter → card list. **Rows link nowhere** — no detail route, no link to the
  source finding. Read-only dead end.
- **Value:** low as standalone; actions are downstream of findings.
- **Leak:** the folder mixes one route page with five cross-cutting server actions
  (matcher accept/dismiss, finding status, vendor-assurance, template, banner) — an
  organizational smell, not a user-facing leak.
- **Verdict: Merge** → a "Remediation" tab inside Findings; wire rows to their source.

### 1.7 Risk Register — `/risks` (list 383, detail client 458, + treatments/history/lifecycle)
- **User:** GRC / risk owner.
- **Decision:** "Which strategic risks and treatments need attention?"
- **Workflow:** sortable table (Title/Domain/Rating/Status/Owner/Due/Treatments/Findings) →
  detail (inherent vs residual, treatments, linked controls/evidence/obligations, lifecycle,
  history). Detail is highly actionable; list is drill-down.
- **Value:** high; the strategic layer above findings.
- **Leak:** none. Linked-findings shown as read-only pointers to `/findings`.
- **Verdict: Keep** (add intelligence provenance on signal-sourced risks).

### 1.8 Approvals — `/approvals` (72 + `ApprovalsQueue`)
- **User:** executive approver.
- **Decision:** "Which risk-treatment plans do I approve/reject?"
- **Workflow:** org-wide queue → approve/reject with separation-of-duties (engine-enforced);
  gated by the risk-lifecycle flag; authoritative `getMe()` check.
- **Value:** high for the risk lifecycle.
- **Leak:** none. **But it is not in the primary nav** — reachable only via a back-link from
  `/risks`. Orphaned discoverability.
- **Verdict: Keep + Move** (surface under Risk).

### 1.9 Queue — `/queue` (page 289, `SuggestionList.tsx` 435, `Notice.tsx` 86)
- **User:** platform customer.
- **Decision:** "Which suggested signal↔entity links do I accept or dismiss?"
- **Workflow:** filter by target type → per-row accept/dismiss with 5-second local undo.
  Ratified as THE customer consumption surface (`docs/queue-ui-design-decisions.md`,
  `CANONICAL_DOMAIN_MODEL.md`).
- **Value:** real (human-in-the-loop matcher confirmation) but buried under jargon.
- **Leak (severe):** page title "Matcher queue" (`page.tsx:165`); empty states reference
  "the matcher" (`page.tsx:117-120`); rows show raw `match_reason` codes like
  `vendor_name_ilike` verbatim (`SuggestionList.tsx:396`) and a truncated raw `signal_id`
  UUID (`SuggestionList.tsx:381`). **Correctness bug:** the list endpoint returns
  Intelligence-Event enrichment (`event_title`, `event_severity`, `event_confidence`,
  `event_canonical_key` — `signalMatchSuggestions.ts:149-154`) but `SuggestionList` reads
  `signal_title`/`signal_severity`/`signal_source`/`signal_cve` — a **field-name mismatch**
  that forces the raw-UUID fallback and drops Source/Severity/CVE.
- **Verdict: Redesign** → "Review Suggested Links" + **Fix** the enrichment bug + **Move**
  under Intelligence. **Not** removed (would reverse a ratified decision).

### 1.10 Context (Enterprise Context) — `/enterprise-context/**` (index 261, dashboard 261, applicability 219 + detail 178 + evidence 175, entities, graph 281, import)
- **User:** platform operator / GRC (the reasoning + inventory layer).
- **Decision:** "What does my environment contain, which signals apply, what's the blast
  radius, what must I review?"
- **Workflow:** entity registry CRUD → applicability WORM decisions (immutable reasoning
  chain + evidence + blast radius) → dependency graph. Dark behind
  `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED`.
- **Value:** high — this is where the signal→asset reasoning trace actually lives. But it is
  the **most jargon-heavy surface**: applicability detail renders raw `signal_id` (shortHash),
  `target_id`, `content_hash`/`prev_hash`, `engine_version`/`schema_version`, and raw
  `captured_value` snapshots in `<pre>` blocks (`applicability/[id]/page.tsx:84-90`,
  `evidence/page.tsx:154-164`).
- **Leak:** the applicability side is engineering-canonical by design (audit surface), but it
  is exposed as primary customer language; and its `/enterprise-context/dashboard` is a
  **fourth posture rollup** (4 hero tiles duplicating Dashboard/Executive).
- **Verdict: Keep (dark)** the applicability/graph core; **Demote/Consolidate** the
  context-dashboard rollup; humanize the reasoning presentation.

### 1.11 Asset Registry — `/assets/**` (list 243, detail 198, new 244, import, connect) — dark behind `SECURELOGIC_ASSET_REGISTRY_ENABLED`
- **User:** platform security / GRC owner.
- **Decision:** "What do we own across every type; which asset do I open next?"
- **Workflow:** one cross-type inventory over `asset_registry_v`; federated create (manual /
  import / connect); detail-backed types edit inline, others route to their own screen.
- **Value:** high — the ERIP Epic-1 substrate; deliberate superset of Vendors + AI Systems.
- **Leak:** none. Does not reference findings/signals/risk (a gap, not a leak).
- **Verdict: Keep (dark).** When the flag flips it becomes the single canonical inventory
  and Vendors/AI Systems drop out of primary nav (become asset types) — see §1.12/§1.13.

### 1.12 Vendor Management — `/vendors` (list 364), `/vendors/risk` (523), `/vendors/[id]` (884), new/import/assess/review/edit
- **User:** third-party-risk owner.
- **Decision:** `/vendors`: "which vendor is risky / needs review"; `/vendors/risk`: "where
  is portfolio risk concentrated"; `/[id]`: "is this vendor acceptable / next action."
- **Workflow:** list → detail → assess (with threat-intel context) → finding → review cycle;
  SOC upload → Vendor Assurance. The **most action-rich** third-party surface.
- **Value:** high.
- **Leak / duplication:** `/vendors` and `/vendors/risk` run the **same three fetches** and
  build the same assessment/finding maps — two pages, one dataset. Signals surface only
  inside `/vendors/[id]/assess` ("Threat Intelligence Context", `assess/page.tsx:54-119`) —
  the one place the matcher output is business-framed well.
- **Verdict: Merge** `/vendors` + `/vendors/risk` (list + analytics tabs).

### 1.13 AI Systems — `/ai-systems` (list 188, detail 551, new/import/assess/review/evidence)
- **User:** AI governance owner.
- **Decision:** "Which AI systems are under governance and which have open issues?"
- **Workflow:** list → detail → governance review / assessment / evidence → finding.
  Structurally near-identical to Vendors detail.
- **Value:** high (AI Governance domain).
- **Leak / correctness:** **the list AND detail pages omit the entitlement redirect** every
  peer enforces — token-only gate (`ai-systems/page.tsx:11-15`, `[id]/page.tsx:451-452`).
  This is an authorization inconsistency, not just cosmetics.
- **Verdict: Keep + Fix** (entitlement gate).

### 1.14 Vendor Assurance — `/vendor-assurance/queue` (169), `/vendor-assurance/[documentId]` (203)
- **User:** SOC-report reviewer / analyst.
- **Decision:** "Is this extraction correct — approve, request manual review, or reject?"
- **Workflow:** upload from vendor detail → queue → document review (PDF + editable
  extraction: cover sheet, CUECs, exceptions). LLM extraction.
- **Value:** high for TPRM depth.
- **Leak:** none. **Not in nav** — reachable only from the vendor detail card. Orphaned
  discoverability.
- **Verdict: Keep + Move** (surface under Vendors/Assets).

### 1.15 Compliance — Controls (`/controls`), Frameworks (`/frameworks`), Policies (`/policies`), Obligations (`/obligations`)
- **User:** compliance / control owner.
- **Decision:** Controls "which controls overdue/failing"; Frameworks "which frameworks,
  how ready"; Policies "which policies overdue for review"; Obligations "which obligations
  due/compliant."
- **Workflow:** each: list → detail → assess/map/evidence → finding → readiness.
- **Value:** high; the Compliance Management domain.
- **Leak / duplication:** **Controls and Obligations are structural twins** — near-identical
  assess→finding, evidence, framework-map, and risk-link cards (code comment: "Mechanical
  mirror of RisksMitigatedCard"). Framework→control mapping is editable from **both**
  Controls and Frameworks. Three separate "overdue" trackers (control cadence, policy
  review cycle, obligation due date). Obligations list status tabs are **cosmetic /
  non-functional** (`obligations/page.tsx:87`). Entitlement gating is **inconsistent**:
  Policies/Obligations redirect at the page; Controls relies on the API returning null and
  only gates `import`; Frameworks is login-only + admin gate on activate.
- **Verdict: Keep all four**; **consolidate** shared Controls/Obligations components;
  **Fix** obligations tabs + gating consistency; page-level Controls/Obligations merge
  evaluated in a later slice (not committed here).

### 1.16 Ask — `/ask` (client 733, voice support)
- **User:** any authenticated user.
- **Decision:** "Give me a plain-English read on my posture / what needs attention."
- **Workflow:** single-turn Q&A (with voice) → answer + posture/findings/risks footer.
  No history, no deep links out.
- **Value:** medium; a utility that restates what Dashboard/Executive show as structure.
- **Leak:** none; but it occupies a prime top-level nav slot for a utility.
- **Verdict: Move** (demote to a global assist element, not a primary nav peer).

### 1.17 Audit Log — `/audit-log` (page 215, `AuditLogTable.tsx` 184)
- **User:** org admin.
- **Decision:** "What security/activity events happened in my org?"
- **Workflow:** filter (event type / date range) → paginated event table → CSV export.
  Admin-gated (`page.tsx:23`, `userRole !== "admin"` → redirect).
- **Value:** high for enterprise/audit-readiness; low friction.
- **Leak:** none.
- **Verdict: Keep** (admin).

### 1.18 Account / Settings cluster (secondary nav)
`/account` (448), `/account/team` (49), `/account/api-keys` (112) + docs (167),
`/account/alerts` (92), `/account/privacy` (73), `/settings/security` (43, MFA/admin),
`/settings/sso` (177, premium), `/settings/webhooks` (109), `/settings/risk-scale` (103),
`/settings/risk-policy` (100), `/pricing` (265), `/getting-started` (242).
- **User:** account owner / admin / onboarding user.
- **Decision:** configure identity, team, keys, alerts, privacy (GDPR), SSO/MFA, webhooks,
  risk scale/policy, billing; complete onboarding.
- **Value:** necessary enterprise plumbing; correctly in **secondary** nav.
- **Leak:** none material. `/settings/risk-scale` + `/settings/risk-policy` are the tuning
  surfaces behind the Risk domain.
- **Verdict: Keep** (secondary). Getting Started already flag-aware (asset registry swap).

---

## 2. The fundamental architectural question — what is the primary object customers *manage*?

The IA should orbit the object the customer **works, owns, acts on, and closes** — not the
object the platform happens to compute over. Evidence, candidate by candidate:

| Candidate | Role in the system (evidence) | Managed unit of work? |
|---|---|---|
| **Intelligence Event** (`intelligence_events`/`cyber_signals`) | **Input / top-of-funnel.** Feeds Briefs, Queue, applicability, and signal-sourced findings. Dark. | No — it is *ingested*, not managed. The customer triages it (Queue) into other objects. |
| **Finding** (`findings`) | **Convergence hub.** `source_type` spans *every* workflow — assessment, control_test, vendor_review, ai_review, obligation_review, dependency_review, applicability_assessment, signal, intelligence_event (`CANONICAL_DOMAIN_MODEL.md` §Source Type). Surfaced on Dashboard, Vendors, AI Systems, Controls, Obligations, Risks. Actionable everywhere. | **Yes — the universal unit of work.** |
| **Action** (`actions`) | **Downstream** of findings (remediation). | No — subordinate to the Finding. |
| **Risk** (`risks`) | **Strategic aggregation** above findings; separate register, treatment/lifecycle-driven, largely manual. | Partly — but it is the executive/strategic layer, not the day-to-day operational unit. |
| **Asset / Vendor / AI System / Obligation / Control** | **Context / substrate.** What findings are *about*; ERIP Epic-1 makes the Asset the risk-computation substrate. | No — these are the *inventory* findings attach to, not the work items. |

**Recommendation: the Finding is the primary managed object** — with the **Asset as the
primary organizing context**. Reasoning:

1. **It is the only object every domain produces and consumes.** Vendor review, AI
   governance, control test, obligation review, dependency review, applicability, and signal
   matching all converge on a Finding (`CANONICAL_DOMAIN_MODEL.md` finding-source map). No
   other object has that universality.
2. **It is the hinge of the operating-layer promise.** PRODUCT_VISION defines the platform
   as turning intelligence "into prioritized action, evidence, and measurable posture." The
   Finding is exactly that hinge: intelligence/assessment → **Finding** → action + evidence +
   posture. Making it the center realizes "decision compression and operational
   traceability."
3. **Everything else is naturally positioned around it:** Intelligence Events = the funnel
   *into* findings; Assets/Vendors/AI/Compliance = the context findings are *about*; Risks =
   the strategic *rollup* of findings; Actions = the *remediation* of findings; Posture/
   Executive = the *measurement* of findings resolved over time.
4. **Reconciling with ERIP's asset-centric substrate:** ERIP Epics 3–7 compute *risk* over
   the **Asset** graph. That is correct for *computed* risk and executive dimensioning. It
   does not contradict Finding-centricity: the **Asset is the substrate for computed risk;
   the Finding is the substrate for managed work.** IA should therefore be **finding-centric
   for the work surface and asset-centric for the inventory/context**, joined by the
   intelligence spine.

**IA consequence:** a **Risk Operations** work area centered on Findings (with Intelligence
as its funnel and Actions as its tail), an **Assets/Context** area as the inventory the
findings hang on, a **Compliance** area, and an **Executive** measurement layer on top.
This directly drives §5–§6.

---

## 3. End-to-end enterprise workflow trace (where each page fits, where users transition)

The platform's reason to exist is one journey: **external intelligence → customer action →
measurable posture.** Traced against real routes:

```
[EXTERNAL SIGNAL]
   ingested → cyber_signals / intelligence_events   (worker; dark IE layer)
        │
        ▼
[EDITORIAL SYNTHESIS]           [MACHINE MATCH]
   /briefs  (weekly readout)     matcher → signal_match_suggestions
        │                                │
        │                                ▼
        │                         /queue  ("accept" → signal_*_link)   ← human triage
        │                                │
        │                                ▼
        │                   /enterprise-context/applicability
        │                   (WORM decision: signal → target, blast radius)
        │                                │
        └──────────────┬─────────────────┘
                       ▼
                 [FINDING created]   source_type ∈ {signal, intelligence_event, *_review, control_test, …}
                       │
        ┌──────────────┼───────────────────────────┐
        ▼              ▼                             ▼
   /findings      context registries            /risks (strategic rollup)
   (manage work)  /vendors /ai-systems           │
        │         /controls /obligations          ▼
        ▼         (finding shown in-context)  /approvals (treatment sign-off)
   [ACTION]  /actions (remediation)
        │
        ▼
   [POSTURE]  posture snapshot → /posture, /dashboard, /executive (measurement)
```

**Where the journey breaks today (the load-bearing finding):** every arrow *into* and *out
of* `[FINDING]` that crosses the intelligence boundary is **conceptual only — there is no UI
link.** Concretely:
- Brief item → its Intelligence Event → affected asset → generated finding: **no link**
  (`cyber_signal_id` used only as an internal join key).
- Queue accept → applicability decision → finding: **no link** (accept writes a
  `signal_*_link`; the customer is never shown the resulting finding).
- Finding → its originating signal/intelligence event / evidence: **no link** (`source_id`
  never rendered).
- Applicability decision → the finding it drafts (`applicability_assessment` source_type):
  **no link back from the finding**.

So the customer can *see* each station but cannot *walk the line*. The workspace program's
central job is to make this trace a clickable, explainable path — which is precisely the
ERIP spine (Epic 3 "every decision explainable") expressed in the UI.

**Natural page transitions the IA must make first-class** (today mostly absent):
Brief → Intelligence Event → Asset → Finding → Action → Posture; and Queue → accepted link
→ Finding; and Finding → originating Intelligence Event / evidence.

---

## 4. Implementation-detail leaks — full catalog (internal concepts shown as customer value)

| # | Where | Leak (evidence) | Should be |
|---|---|---|---|
| L1 | `/queue` title + empty states | "Matcher queue" / "the matcher hasn't produced…" (`page.tsx:165,117-120`) | "Review Suggested Links" / plain language |
| L2 | `/queue` rows | raw `match_reason` codes e.g. `vendor_name_ilike` (`SuggestionList.tsx:396`) | humanized "why matched" |
| L3 | `/queue` rows | truncated raw `signal_id` UUID ("Signal 1a2b3c4d…", `SuggestionList.tsx:381`) — caused by the `event_*`/`signal_*` **field-name bug** | intelligence-event title (already returned by the API) |
| L4 | `/enterprise-context/applicability/[id]` | raw `signal_id`, `target_id`, `content_hash`, `prev_hash`, `engine_version`, `schema_version` (`[id]/page.tsx:84-90`) | reasoning presented in business language; hashes behind an "audit/reproducibility" affordance |
| L5 | `/enterprise-context/applicability/[id]/evidence` | raw `captured_value` snapshots in `<pre>` (`evidence/page.tsx:154-164`) | structured evidence view |
| L6 | `/findings` + detail | `source_type`/`source_id` present but the origin is shown only as a static label, never a link (`findings.ts:359-385`) | drill-through to the originating intelligence/assessment |
| L7 | `/briefs/[id]` | two brief engines on one route; `cyber_signal_id` as hidden join key (`signal/item/[index]/page.tsx:129-178`) | one canonical brief; item links to its Intelligence Event |
| L8 | `/actions` | rows link nowhere; folder mixes route + 5 server-action modules | actions link to source finding |
| L9 | duplicate logic | severity palette re-declared in ≥5 files (`RiskRow.tsx:46`, `RiskDetailClient.tsx:35`, `dashboard/page.tsx:401`, `DashboardCharts.tsx:12`, findings) | one shared token set |
| L10 | duplicate workflows | `/vendors` ≈ `/vendors/risk` (same fetches); Controls ≈ Obligations ("mechanical mirror"); framework mapping edited from both sides | consolidate |
| L11 | gating inconsistency | `/ai-systems` omits entitlement redirect (`page.tsx:11-15`); Executive/Context/Assets trust cookie while Findings/Risks/Queue use `getMe()`; Controls vs Obligations differ | uniform authoritative `getMe()` gating |
| L12 | `/obligations` | status filter tabs are cosmetic/non-functional (`page.tsx:87`) | wire or remove |

L1–L3 and L11 are the highest priority: L1–L3 are the "raw pipeline vocabulary as primary
customer language" problem, and L11 is an **authorization correctness** issue.

---

## 5. Current vs recommended information architecture

### 5.1 Current IA (primary nav, in order — `navigation.ts:59-103`)
```
Dashboard · Briefs · Ask · Queue · Assets[Asset Registry|Vendors|AI Systems] ·
Context · Executive · Compliance[Controls|Frameworks|Policies|Obligations] ·
Risk[Findings|Actions|Risk Register] · Audit Log
```
Not in primary nav (orphaned): **Approvals**, **Vendor Assurance**, **Posture**.
Secondary nav: Account/Team/API-Keys/Alerts/Privacy · Pricing · Settings(security/sso/
webhooks/risk-scale/risk-policy) · Getting Started.

### 5.2 Pain points (evidence-backed)
- **PP1 — Broken intelligence spine** (§3): the core journey is not clickable. *Root cause of
  the product feeling like "disconnected lists."*
- **PP2 — Rollup sprawl:** Dashboard, Executive, Posture, Ask, Context-dashboard, Findings
  tiles, Risks tiles, Actions tiles, Vendors + Vendors/Risk = ~9 posture/attention surfaces
  with no hierarchy.
- **PP3 — Structural twins & duplicate work** (L10): Controls/Obligations, Vendors/AI,
  Vendors/Vendors-Risk, dual framework mapping.
- **PP4 — Pipeline jargon & raw IDs as primary language** (L1–L5).
- **PP5 — Orphaned surfaces:** Approvals, Vendor Assurance, Posture reachable only by
  back-links, not nav.
- **PP6 — Queue is a top-level peer** to whole domains, yet is one step in the intelligence
  workflow.
- **PP7 — Gating inconsistency / one authorization gap** (L11).
- **PP8 — Dead-end Actions page** (L8).

### 5.3 Recommended enterprise IA (Finding-centric work + Asset-centric context, per §2)
```
Home            → /dashboard          operational "attention now"
Executive       → /executive          board measurement            [dark: risk_intelligence]
Intelligence ▾                         the funnel INTO findings
  · Briefs              /briefs
  · Intelligence Events /intelligence  (NEW, dark: intelligence_events)
  · Review Links        /queue         (reskinned; was "Matcher queue")
Risk Operations ▾                      the FINDING work hub (primary managed object)
  · Findings            /findings
  · Remediation         /findings?tab=actions   (Actions merged)
  · Risk Register       /risks
  · Approvals           /approvals     (surfaced)
Assets ▾                               inventory/context (Asset Registry when flag on)
  · Asset Registry      /assets        [dark: asset_registry]
  · Vendors             /vendors        (list+risk merged) [hidden when registry on]
  · AI Systems          /ai-systems     [hidden when registry on]
  · Vendor Assurance    /vendor-assurance/queue   (surfaced)
Compliance ▾   Controls · Frameworks · Policies · Obligations
Context         /enterprise-context    [dark: enterprise_context]
Audit Log       /audit-log             [admin]
Ask             → global assist element (removed from primary nav peer slot)
```
Rationale maps 1:1 to §2 (Finding = managed unit → "Risk Operations"; Asset = context →
"Assets"; Intelligence = funnel; Executive = measurement) and fixes PP5/PP6 (orphans
surfaced, Queue relocated into its workflow).

### 5.4 Before/after workflow diagram
```
BEFORE (stations visible, line not walkable):
  Briefs      Queue        Context/applicability      Findings     Actions
   (end)   (accept→?)      (decision→?)              (origin?)    (source?)
     ✗ no link  ✗ no link        ✗ no link              ✗ no link     ✗ no link
  → user re-finds context manually at every hop; product reads as disconnected lists.

AFTER (one clickable, explainable spine):
  Intelligence Event ──▶ affected Asset/Vendor ──▶ Finding ──▶ Action ──▶ Posture
        ▲  │                    (applicability          │          │         │
        │  └── Review Links      reasoning shown        │          │         ▼
        │      (accept links)    in business language)  │          │     Executive
     Briefs (each item links to its Intelligence Event) │          │
                                                         └── every finding links back
                                                             to its originating event/evidence
```

---

## 6. Page ownership matrix

| Surface | Primary user | Primary object | Domain owner | Flag | Verdict |
|---|---|---|---|---|---|
| /dashboard | all tiers | Posture (rollup of Findings) | Home | — | Redesign |
| /executive | executive | Risk rollup (over Assets) | Executive | risk_intelligence (dark) | Keep |
| /posture | GRC | Posture | Executive | — | Consolidate |
| /briefs | executive reader | Intelligence Event | Intelligence | — | Redesign+Merge engines |
| /intelligence (NEW) | GRC/exec | Intelligence Event | Intelligence | intelligence_events (dark) | Build |
| /queue | platform customer | Signal-match suggestion | Intelligence | — | Redesign+Fix+Move |
| /findings | GRC/risk owner | **Finding** | Risk Operations | — | Redesign |
| /actions | platform user | Action | Risk Operations | — | Merge→Findings |
| /risks | GRC/risk owner | Risk | Risk Operations | risk_lifecycle (partial) | Keep |
| /approvals | approver | Risk treatment | Risk Operations | risk_lifecycle | Keep+Move |
| /enterprise-context | operator/GRC | Entity + applicability | Context | enterprise_context (dark) | Keep+humanize |
| /enterprise-context/dashboard | operator | Posture rollup | Context | enterprise_context | Demote |
| /assets | security/GRC | **Asset** | Assets | asset_registry (dark) | Keep |
| /vendors (+risk) | TPRM owner | Vendor (asset) | Assets | — | Merge |
| /ai-systems | AI gov owner | AI System (asset) | Assets | — | Keep+Fix gate |
| /vendor-assurance | reviewer | Assurance doc | Assets | — | Keep+Move |
| /controls | control owner | Control | Compliance | — | Keep+consolidate |
| /obligations | compliance | Obligation | Compliance | — | Keep+Fix tabs |
| /frameworks | compliance lead | Framework | Compliance | — | Keep |
| /policies | policy owner | Policy | Compliance | — | Keep |
| /ask | any user | (utility) | — | — | Move (demote) |
| /audit-log | admin | Audit event | Ops/Admin | — | Keep |
| Account/Settings/Pricing/Getting-Started | admin/owner | Config | Secondary | mixed | Keep (secondary) |

---

## 7. Recommended implementation packages (dependency-ordered; each dark, additive, CI 8/8, GATE B)

- **PKG-0 — Approvals & scoping** *(this audit + memo; operator ruling).* No code.
- **PKG-1 — Language & correctness quick wins** *(no product decision needed).* Fix the
  Queue enrichment bug (L3) + reskin to "Review Suggested Links" (L1/L2); close the
  `/ai-systems` entitlement gap and normalize `getMe()` gating (L11); wire/remove obligations
  tabs (L12). Additive, low-risk. **Depends on:** nothing.
- **PKG-2 — Finding decision-grade v1.** Owner/SLA display; drill-through to the *already-live*
  `cyber_signals`/applicability trace (L6, flag-independent); saved filters; pagination.
  **Depends on:** PKG-1.
- **PKG-3 — Intelligence spine (dark).** New `/intelligence` Intelligence Events view;
  finding↔event↔applicability↔brief links; Queue-accept → resulting finding link. Double-gated
  on `SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED`; degrades to today when off. **Depends on:**
  PKG-2.
- **PKG-4 — IA / nav restructure.** Intelligence + Risk Operations groups; surface Approvals
  & Vendor Assurance; demote Ask; Actions→Findings "Remediation" tab; `/vendors`+`/vendors/risk`
  merge. Behind a nav flag; flag-off byte-identical. **Depends on:** PKG-1..3 (so relocated
  surfaces are already improved).
- **PKG-5 — Rollup consolidation.** Dashboard vs Executive vs Posture hierarchy; retire the
  Context-dashboard rollup duplication; converge the two brief engines (retire legacy
  `NewsletterIssue` rendering). **Depends on:** PKG-4.
- **PKG-6 — Compliance component consolidation.** Shared Controls/Obligations assessment
  components; page-merge evaluated separately. **Depends on:** PKG-4.

Sequencing logic: correctness + de-jargon first (visible value, no decisions), then deepen
the Finding, then light the spine, then move furniture, then consolidate. Nav/merges come
*after* the surfaces they move are already improved, so users never relocate to a worse page.

---

## 8. Migration strategy

- **Dark + additive + reversible.** Every package behind a flag; flag-off renders today's UI
  byte-for-byte (the ERIP EAR/ECL precedent). No destructive migration; the Intelligence
  Events layer is already additive (`20260822`–`20260826`).
- **Route back-compat.** Merged/relocated routes keep their old URLs working (redirect or
  alias), matching the EAR-AD-1 precedent where `/vendors`/`/ai-systems` remain reachable
  after the registry flip. Actions folded into Findings keeps `/actions` as a redirect to the
  Remediation tab.
- **Nav flag.** IA changes gate on a nav flag so the header can flip atomically and roll back
  instantly; the existing `filterNav` + two-switch model already supports this.
- **Legacy brief retirement.** Two-step: (1) route all reads to canonical `IntelligenceBrief`
  with the legacy `NewsletterIssue` renderer still present as fallback; (2) remove the legacy
  renderer only after canonical coverage is verified in staging.
- **Entitlement fix rollout.** The `/ai-systems` gate + `getMe()` normalization is a
  security-correctness change — ship early (PKG-1), validate with the cross-org isolation
  harness, and route it through security review.
- **Validation gates.** Per package: unit + cross-org isolation tests, flag-off byte-identity
  check, and (for spine/linkage) an org-scoped no-leak test on the new joins. CI 8/8 +
  knowledge-index drift, per ERIP governance.

---

## 9. Risks & tradeoffs

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Over-consolidation** — merging Controls/Obligations or Vendors/AI too aggressively loses domain nuance | Med | Consolidate *components* first (PKG-6), defer page merges to a separate decision; keep domain detail pages distinct |
| **Entitlement change touches auth** — normalizing gating could regress access | Med→High impact | Security review + cross-org isolation tests before merge; ship as its own reviewable slice |
| **Spine depends on a dark flag** — intelligence linkage only lights up when IE flag is on | High (flag is off) | Build flag-independent drill-through on the *existing* `cyber_signals`/applicability first (PKG-2); IE-gated linkage degrades gracefully (WS-AD-4) |
| **Ratified-decision conflict** — Queue relocation/reskin touches a ratified surface | Med | Reskin + move only; do **not** remove; update `queue-ui-design-decisions.md` in the same package |
| **Nav churn** — users lose familiar paths | Med | Nav flag + route back-compat + relocate only after surfaces improved |
| **Scope creep** — a 6-package program is large | High | One package at a time per ERIP; PKG-1/PKG-2 deliver standalone value and can stop there |
| **Brief-engine convergence** — retiring legacy could drop content | Med | Two-step retirement with staging verification (§8) |
| **Executive vs Findings duplication** if a "command center" is built in Findings | Med | Resolved by §2: Executive stays the board surface; Findings is the work hub — not a rollup |

---

## 10. Approvals now requested (audit complete → decisions)

With the evidence above established, the companion memo
(`ERIP-ENTERPRISE-RISK-WORKSPACE-MEMO.md`) requests these operator rulings:

1. **Authorization / home** — approve this as an ERIP presentation-layer program (Epic 4 UI
   + a Risk-Operations UX slice), and confirm the Finding-centric-work / Asset-centric-context
   IA thesis (§2) as the organizing principle.
2. **Navigation restructuring** — the recommended IA (§5.3): Intelligence + Risk Operations
   groups, Queue relocated + reskinned, Approvals/Vendor Assurance surfaced, Ask demoted (all
   behind a nav flag).
3. **Page merges** — `/vendors`+`/vendors/risk`; Actions→Findings; demote Context-dashboard +
   Posture into the rollup hierarchy.
4. **Workflow convergence & legacy retirement** — converge the two brief engines / retire the
   legacy `NewsletterIssue` renderer (§8 two-step).

No implementation will begin until these are ruled on. GATE B remains in effect.
