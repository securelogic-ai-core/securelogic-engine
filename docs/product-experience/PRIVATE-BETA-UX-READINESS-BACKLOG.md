# Private Beta — UX & Product Readiness Backlog

**Status:** LIVING — updated continuously during the staging walkthrough
**Opened:** 2026-08-03
**Reviewer lens:** Fortune 500 CISO · Chief Risk Officer · Chief Audit Executive ·
VP Third-Party Risk · Risk Analyst · first-time enterprise evaluator
**Companion docs:** `EG3-STRATEGY-BASELINE.md` (strategy/roadmap),
`EG2-PRODUCT-EXPERIENCE-REPORT.md` (prior experience audit)

This document is the *experiential* layer. EG3 answers "what should we build and
in what order." This answers "what happens to a real buyer's confidence, screen
by screen, when they use what we already shipped."

---

## 0. The evaluation gate

Every finding is scored against the ratified decision thesis (EG3 §2.1):

> What customer decision becomes **faster**, **more confident**, and **more
> defensible** because of this screen?

A screen that displays accurate data but changes no decision is not a feature.
It is furniture. Furniture is how GRC platforms lose evaluations.

**Categories:** Functional Bug · UX Improvement · Workflow Improvement ·
Product Design Improvement · Enterprise Readiness Issue · Intelligence
Opportunity · Future Enhancement (not required for Private Beta)

---

## 1. Verified staging baseline — what the walkthrough will actually show

Resolved from `render.yaml` (staging app service) through
`app/src/lib/navigation.ts`. Staging app flags ON: `risk_workspace`,
`briefing`, `asset_registry`, `enterprise_context`, `decision_workspace`,
`risk_acceptance`, `findings_queue_controls`. **`risk_intelligence` is not set
on any app service** — staging or production.

Header for a platform-tier admin:

| # | Nav entry | Type | Destination |
|---|---|---|---|
| 1 | **Briefing** | link | `/dashboard` |
| 2 | Search | link | `/search` |
| 3 | Posture | link | `/posture` |
| 4 | **Intelligence** | group | Briefs · Review Links |
| 5 | **Risk Operations** | group | Operations Workspace · Finding Explorer · Actions · Risk Register · Approvals |
| 6 | **Assets** | group | Asset Registry · Vendor Assurance |
| 7 | **Compliance** | group | Controls · Frameworks · Policies · Obligations · Evidence |
| 8 | Context | link | `/enterprise-context` |
| 9 | Audit Log | link | `/audit-log` (admin) |
| — | user menu | menu | Ask SecureLogic · Account · Settings |

**Not in the nav but reachable by URL:** `/executive`, `/vendors`,
`/ai-systems`, `/getting-started`, `/queue` (as "Review Links"), all
`/settings/*`.

**Count:** 9 header entries → 20 primary destinations, plus 12 secondary
destinations, on first login. Held against that: an evaluator gives a product
roughly 90 seconds to prove it knows what they should do first.

---

## 2. Root-cause themes

Findings are grouped by underlying weakness, not by screen. A theme with many
findings is one product decision, not many defects.

| Theme | Root cause | Findings |
|---|---|---|
| **T1 — Attention routing without judgment** | Surfaces count and link, but never rank, explain, or recommend. The platform tells you *where* work is, never *which* work matters most or why. | B-1 |
| **T2 — Navigation names the implementation, not the buyer's domain** | The IA is organized around how the system is built (workspaces, registries, explorers) rather than the nouns each buying persona uses. | B-2, B-3, B-5 |
| **T3 — Differentiators are dark or demoted** | The capabilities that win the evaluation are invisible, buried, or off. | B-4, B-6 |
| **T4 — Vocabulary collisions** | Deliberate naming decisions that are internally coherent but ambiguous to a first-time user. | B-7, W-5, W-10, W-11 |
| **T5 — Our configuration is described as the customer's deficiency** | Global feature flags surface as "not enabled for *your organization* yet." The customer reads our rollout state as their missing entitlement or broken setup. | W-3, W-4, W-12 |
| **T6 — The intelligence surfaces are the broken ones** | Every surface that would prove the "most intelligent platform" claim is either failing, empty, or inverted. The operational surfaces work well; the differentiating ones do not. | W-1, W-2, W-3, W-9 |
| **T7 — Scale without triage** | The product handles 550 findings correctly and helps with none of them. Correct counts, no path from volume to first action. | W-8, W-9 |
| **T8 — Empty containers under full surfaces** *(root cause — see §3d)* | Every column that would make a finding rankable, explainable, or connected exists in the schema and is null in the data. The read surfaces are built as though it were populated. **B-1, W-7, W-8 and W-9 are symptoms of this, not independent defects.** | RC-1, RC-2, RC-3 |

Themes for Permissions & RBAC and Audit Defensibility remain open pending the
RBAC and evidence walkthroughs.

---

## 3. Backlog

### B-1 — The Briefing routes attention but renders no judgment
- **Screen:** `/dashboard` (The Briefing) — the landing surface
- **Category:** Intelligence Opportunity
- **Theme:** T1
- **Observation:** All nine Briefing modules (`app/src/lib/briefing/registry.ts`)
  are the same shape: a title, a scope chip, a count, and `View →`. "Needs
  Attention", "My Work", "Ready to Close", "Remediation Actions", "Security
  Posture". Not one module states *which* item matters most, *why* it moved, or
  *what the user should do first*. The composition is genuinely well-engineered —
  explicit scope chips, honest "nothing measured yet" instead of false green,
  a single explicit error panel instead of silent zeros. It is a very good
  system of record opening screen.
- **Why it matters:** This is the screen the evaluation is decided on. Archer,
  ServiceNow GRC and AuditBoard all open with counts and links. If our first
  screen is the same shape as theirs, we have conceded the only ground on which
  we are actually differentiated. The EG3 thesis says we optimize for the
  quality of the next decision; the landing screen currently optimizes for
  completeness of the record.
- **Recommended improvement:** Add one module above all zones — a ranked
  "What needs your judgment today" list of 3–5 items, each with the item, the
  reason it ranked (deterministic and stated: SLA breach + asset criticality +
  a matched external signal), and a single decision action. Deterministic
  ranking, shown work, no LLM guess. This is the change-delta and
  signal→inventory mapping advantage (both Class A) made visible on the one
  screen every user sees.
- **Priority:** Critical · **Release blocker:** No (beta ships without it, but
  the beta will not demonstrate the thesis without it)

### B-2 — "Vendors" and "AI Systems" disappear from the navigation
- **Screen:** Global header → Assets
- **Category:** Product Design Improvement
- **Theme:** T2
- **Observation:** `navigation.ts:192-193` — when `asset_registry` is on (it is,
  on staging), the Vendors and AI Systems children are dropped from the nav via
  `hiddenByFlag`. The Assets group renders as **Asset Registry · Vendor
  Assurance**. Both routes still work by direct URL.
- **Why it matters:** A VP of Third-Party Risk navigates by the word "Vendors."
  A Chief AI Officer navigates by "AI Systems." Both are named core platform
  domains in `PRODUCT_VISION.md` §"Core platform domains", and AI Governance is
  identified in EG3 as a Class "C today / A potential" differentiator where
  everyone is early. Neither is findable from the menu. "Asset Registry" is an
  IT-operations noun; it does not read as third-party risk or AI governance to
  the person whose budget buys those modules. The consolidation is
  architecturally right and commercially invisible.
- **Recommended improvement:** Keep the unified registry as the data model and
  the destination, but restore the persona nouns as nav entries that deep-link
  into it as filtered views (`/assets?type=vendor`, `/assets?type=ai_system`).
  The registry stays canonical; the buyer still finds their domain.
- **Priority:** High · **Release blocker:** Yes for any AI-governance or TPRM
  demo

### B-3 — Two nav entries, same route, neither is a customer noun
- **Screen:** Header → Risk Operations
- **Category:** Product Design Improvement
- **Theme:** T2
- **Observation:** "Operations Workspace" (`/findings`) and "Finding Explorer"
  (`/findings?queue=all`) are adjacent menu items on the same path. The code
  comment (`navigation.ts:170-179`) explains the distinction well — one is
  "where I do my daily work", the other is "where I search and investigate" —
  but neither label carries that meaning to a first-time user.
- **Why it matters:** An analyst on day one has to click both to learn the
  difference, and will keep guessing. Adjacent near-synonyms in a menu are the
  classic signature of an IA that grew rather than was designed — exactly the
  impression an evaluator reads as "internal tool."
- **Recommended improvement:** Rename to intent: **"My Queue"** and **"All
  Findings"**. Both are customer nouns and self-evidently different. No route,
  param, or handler change — labels only.
- **Priority:** High · **Release blocker:** No

### B-4 — The Executive dashboard is invisible to every user in every environment
- **Screen:** `/executive`
- **Category:** Enterprise Readiness Issue
- **Theme:** T3
- **Observation:** The nav entry is gated on `risk_intelligence`
  (`navigation.ts:163`), which fails closed (`navigation.ts:338`).
  `SECURELOGIC_RISK_INTELLIGENCE_ENABLED` appears **zero times** in both the
  production and staging *app* service blocks in `render.yaml` — it is set only
  on engine services. The page itself has no flag gate (only an entitlement
  redirect), so it renders fine at the direct URL. It is nav-orphaned, not
  broken. Internally it is substantial: multi-view enterprise + per-dimension
  KPIs, trend, comparison, heatmap drill-down, predictive panel, connector
  health — each degrading independently.
- **Why it matters:** This is the *only* screen built for the persona who signs
  the contract. EG3 already flags it ("the executive dashboard is dark to 100%
  of users") and this confirms the mechanism: it is not a rollout decision, it
  is a missing environment variable on the app service. A walkthrough conducted
  as a CISO would never encounter the CISO screen.
- **Recommended improvement:** (1) During this walkthrough, visit `/executive`
  directly so it gets reviewed. (2) Set the flag on the staging app service and
  validate it. (3) Treat "flag exists on engine but never on app" as a class of
  defect — audit every two-switch flag for the same asymmetry.
- **Priority:** Critical · **Release blocker:** Yes

### B-5 — The nav does not express the five product domains we sell
- **Screen:** Global header
- **Category:** Product Design Improvement
- **Theme:** T2
- **Observation:** `PRODUCT_VISION.md` sells five domains: Cyber Intelligence,
  Vendor Risk, AI Governance, Compliance Management, Risk & Findings
  Operations. The header offers Briefing · Search · Posture · Intelligence ·
  Risk Operations · Assets · Compliance · Context · Audit Log. Three of the
  five sold domains have no direct expression; two of them (Vendor Risk, AI
  Governance) are actively hidden (B-2).
- **Why it matters:** The buyer arrives with the website's vocabulary in their
  head and has to translate it into the app's vocabulary before they can
  navigate. Every translation step is a moment of doubt about whether the
  product they were sold is the product they logged into.
- **Recommended improvement:** Reconcile the marketing taxonomy and the app IA
  into one vocabulary. This is a decision, not a build — pick one set of five
  nouns and use them in both places.
- **Priority:** High · **Release blocker:** No

### B-6 — "Ask SecureLogic" is demoted into the avatar menu
- **Screen:** Header → user menu
- **Category:** Product Design Improvement
- **Theme:** T3
- **Observation:** Under the workspace IA, Ask leaves the primary nav and lives
  in the user menu (`navigation.ts:149-150`, `Header.tsx:200`). The stated
  reason — "until it becomes a core workflow" — is honest.
- **Why it matters:** We are positioning as the *most intelligent* GRC platform.
  The conversational surface is the most legible proof of that claim to a
  first-time evaluator, and it sits where products put "Sign out." The
  positioning and the placement contradict each other. Either the surface is
  good enough to be the differentiator, in which case it belongs in the nav, or
  it is not, in which case the positioning needs evidence elsewhere (see B-1).
- **Recommended improvement:** Decide which. If Ask is credible on staging,
  promote it. If it is not yet credible, that is the more important finding and
  belongs in the beta risk register.
- **Priority:** High · **Release blocker:** No
- **Status:** Needs walkthrough evidence — evaluate `/ask` quality before
  choosing.

### B-7 — "Briefing" and "Briefs" are different products, one letter apart
- **Screen:** Header entries 1 and 4
- **Category:** UX Improvement
- **Theme:** T4
- **Observation:** `/dashboard` is labeled "Briefing" (the personal work
  landing surface). Intelligence → "Briefs" is the Intelligence Brief wedge
  product. The distinction was operator-ratified (`navigation.ts:43-45`) and
  the code comment explicitly notes it is "deliberately distinct."
- **Why it matters:** Deliberate is not the same as unambiguous. A first-time
  user reading a menu top-to-bottom sees two words with the same root and no
  way to infer which is the newsletter and which is their workspace. The Brief
  is the commercial wedge — confusion about where it lives has revenue
  consequence.
- **Recommended improvement:** Rename the home entry to **"Today"** or
  **"Home"** and reserve the Brief vocabulary exclusively for the Intelligence
  Brief product. The URL stays `/dashboard`; the label is a one-line constant
  (`BRIEFING_NAV_LABEL`).
- **Priority:** Medium · **Release blocker:** No

---

---

## 3b. Live walkthrough findings

Session 1 — 2026-08-03, staging, authenticated as
`walkthrough-approver@seed.securelogicai.test` (role `admin`, entitlement
`platform`) on `[SEED] Walkthrough Org`. Org state at time of walk: 550 active
findings (11 Critical / 488 High / 51 Moderate), 490 open actions, 2 vendors,
0 risks promoted.

### W-1 — Ask SecureLogic fails on every one of its own suggested questions
- **Screen:** `/ask` · **Category:** Functional Bug · **Theme:** T6
- **Observation:** The page offers six clickable starter prompts. Four were
  submitted to `POST /api/ask` with a valid platform-tier admin token. All four
  returned `{"error":"ask_failed","message":"Unable to process query"}` —
  including "What are my top 3 vendors by risk exposure?", "Show me my critical
  active findings", "What's my overall security posture?", and "How many overdue
  actions do I have?". The page itself renders correctly; the engine cannot
  answer.
- **Why it matters:** This is the single surface that most directly embodies the
  "most intelligent GRC platform" claim, and its failure mode is to invite the
  user to ask a question and then refuse it. A prospect who clicks one suggested
  prompt in a demo gets "Unable to process query" — an error that explains
  nothing, offers no fallback, and cannot be recovered from. The suggested
  prompts are, functionally, a list of things the product cannot do. This is
  worse than having no assistant.
- **Recommended improvement:** Fix or remove. If it cannot be made reliable
  before Private Beta, take `/ask` out of the product entirely rather than ship
  a broken intelligence surface — a missing feature costs nothing, a visibly
  failing AI feature costs the credibility of every other number on the
  platform. Never ship starter prompts that are not continuously tested against
  the live engine.
- **Priority:** Critical · **Release blocker:** Yes
- **Resolves B-6:** The question was "is Ask good enough to promote into the
  nav." The answer is that it does not work at all.

### W-2 — The change-delta module reports "Quiet" to an org with 499 critical and high findings
- **Screen:** `/dashboard` → "Since Your Last Visit" · **Category:** Product
  Design Improvement · **Theme:** T6
- **Observation:** On first login the module rendered: *"Quiet since your last
  visit (Aug 3, 12:41 AM) — no new findings, no new overdue work, no decisions
  waiting on this window."* The timestamp is the current login, so the comparison
  window is zero-width. Directly beneath it, the same screen reports Critical
  findings 11, High findings 488, Overdue 2, Ready to Close 4.
- **Why it matters:** Change-delta awareness is classified in EG3 as a Class A
  capability — "genuinely rare," one of the three things we do better than
  anyone. On the first screen of the first session it produces a reassuring
  falsehood. The word "Quiet" sits eight lines above "488 High findings." An
  evaluator does not conclude "the delta window is empty"; they conclude the
  product does not know what is happening in their environment. Our best
  differentiator is currently the strongest argument against trusting our
  numbers.
- **Recommended improvement:** A zero-width window must never render as quiet.
  On first login, fall back to a stated window ("Your first session — here is
  what changed in the last 7 days") and name the window explicitly in every
  subsequent render. Never allow "no change" to appear on a screen that
  simultaneously reports unresolved critical volume without reconciling the two.
- **Priority:** Critical · **Release blocker:** Yes

### W-3 — The Executive dashboard renders as three "not enabled" notices
- **Screen:** `/executive` (direct URL) · **Category:** Enterprise Readiness
  Issue · **Theme:** T5, T6
- **Observation:** Reached directly, since it is nav-orphaned (B-4). The page
  headline promises *"Enterprise risk posture across every domain — trends,
  KPIs, forecast, and connector health in one leadership view."* The body
  delivers, in full: "Risk intelligence is not enabled for your organization
  yet." · "Predictive intelligence is not enabled for your organization yet." ·
  "No connectors configured yet (16 available to connect)."
- **Why it matters:** B-4 assumed the nav flag was the only thing standing
  between the customer and a working executive view. It is not. Turning the nav
  flag on today would put a page in front of the CISO that promises four
  capabilities in one sentence and delivers none of them in the next. The gap
  between the headline and the body is the exact shape of a product that
  oversells — the impression hardest to recover from in an enterprise
  evaluation.
- **Recommended improvement:** Do not enable the `/executive` nav entry until
  the page renders real data. Until then, the honest fix is to make the headline
  conditional: a page that cannot show trends should not claim to.
- **Priority:** Critical · **Release blocker:** Yes (blocks enabling the nav
  entry; supersedes B-4's recommendation to simply set the flag)

### W-4 — Our feature flags are worded as the customer's missing entitlement
- **Screens:** `/executive` (×2), `/approvals` · **Category:** Enterprise
  Readiness Issue · **Theme:** T5
- **Observation:** Three separate notices use the same construction: "Risk
  intelligence is not enabled **for your organization** yet." · "Predictive
  intelligence is not enabled **for your organization** yet." · "The risk
  approval workflow isn't enabled **for your organization** yet."
- **Why it matters:** Each of these is a global rollout flag that no customer
  can influence. The wording tells a paying Platform Professional customer that
  *their* organization lacks something — which reads as either "you didn't buy
  this tier" or "your implementation is incomplete." Both trigger a call to the
  account team, and both are false. In a demo, it reads as the prospect being
  shown a deliberately crippled account.
- **Recommended improvement:** Separate three states that are currently one
  string: *not in your plan* (upgrade path), *not yet configured by your admin*
  (setup path), and *not yet released* (roadmap statement). Only the first two
  should ever mention "your organization."
- **Priority:** High · **Release blocker:** No

### W-5 — Every page in the platform is titled "Intelligence Brief"
- **Screen:** Global · **Category:** Product Design Improvement · **Theme:** T4
- **Observation:** `<title>SecureLogic AI — Intelligence Brief</title>` is
  served on `/dashboard`, `/executive`, and every other page checked. The
  browser tab, every bookmark, every window in a screen-share, and every
  screenshot a customer pastes into a deck is labeled with the wedge product's
  name.
- **Why it matters:** `CLAUDE.md` and `PRODUCT_VISION.md` both fix the hierarchy:
  the Platform is the product, the Brief is the wedge. The title tag inverts it
  globally. A CRO who screen-shares the risk register during a board meeting is
  showing a tab that says "Intelligence Brief" — which is precisely the "a
  newsletter with software attached" impression the product vision explicitly
  disclaims.
- **Recommended improvement:** Per-page titles ("Security Posture · SecureLogic
  AI"). At minimum, change the global default to "SecureLogic AI." The
  Intelligence Brief title belongs on `/briefs` only.
- **Priority:** High · **Release blocker:** No

### W-6 — First-time users are told the workspace has changed
- **Screen:** `/dashboard` → "Your workspace has a new shape" panel ·
  **Category:** UX Improvement · **Theme:** T3
- **Observation:** On a first-ever login the orientation panel opened with *"We
  moved a few things so the product answers what changed before it shows you what
  exists. Nothing was removed, and nothing you had is gone."* The panel gates on
  the `risk_workspace` flag, not on whether this user ever saw the previous
  layout.
- **Why it matters:** The content itself is genuinely good — each item explains
  *why* the change was made, which is rare and worth keeping. But shown to
  someone with no prior session it is incoherent, and the reassurance "nothing
  you had is gone" actively creates the worry it is answering. For a Private
  Beta where most users are first-time by definition, this is the wrong default:
  it opens the product by apologizing for instability the customer never
  experienced.
- **Recommended improvement:** Gate on prior activity, not on the flag. New
  users should get an orientation framed as introduction ("Here's how the
  workspace is organized"); returning users get the change note. Same panel,
  same content, two openings.
- **Priority:** High · **Release blocker:** No

### W-7 — The posture score is a bare number with no scale and no path
- **Screen:** `/posture` · **Category:** Intelligence Opportunity · **Theme:** T1
- **Observation:** "Overall Posture Score: **4** — Critical as of Aug 2, 2026."
  No denominator is shown. The domain table below is labelled "Health score
  (0–100) · higher = better" and reads: Access Control **0** (Critical, 2
  findings), Vendor Risk **0** (Critical, 547 findings), AI Governance **25**
  (High, 1 finding).
- **Why it matters:** Two domains score zero and nothing on the page says why,
  what a zero means, or what single action would move it. A CISO's question at
  this screen is never "what is my score" — it is "what do I do about it, and
  what will it be worth." The screen answers neither. It also invites a fatal
  demo question we cannot currently answer: *"Access Control scores 0 on two
  findings, Vendor Risk scores 0 on 547 — how is that the same number?"*
- **Recommended improvement:** Show the scale inline ("4 / 100"). Add, per
  domain, the single highest-leverage action and its modelled score impact
  ("Assign owners to the 11 critical vendor findings → projected Vendor Risk
  0 → 34"). This is the clearest place in the product to convert a score into a
  decision, and the arithmetic is already deterministic.
- **Priority:** High · **Release blocker:** No

### W-8 — 550 findings, 14 queues, no first move
- **Screen:** `/findings` (Operations Workspace) · **Category:** Workflow
  Improvement · **Theme:** T1, T7
- **Observation:** The workspace is the strongest-built surface reviewed: queue
  descriptions are excellent ("Past the committed date — act or renegotiate",
  "No risk-treatment decision recorded — triage"), the overlap disclaimer is
  honest, and counts carry an as-of timestamp. It presents 14 queues.
  **Needs Assignment: 542 of 550. Needs Governance Decision: 544 of 550.
  Third-Party Risk: 547 of 550.**
- **Why it matters:** 98% of findings have no owner and no governance decision,
  and the domain filters do not discriminate because one domain holds 99% of the
  data. Every queue is a legitimate slice and none is ranked, so the screen
  answers "what can I accomplish here" with "anything" — operationally identical
  to no guidance. There are no bulk operations (EG3 Class D), so the only path
  from 542 unowned findings to an owned inventory is 542 individual actions. A
  new customer's first day ends with the backlog exactly as they found it.
- **Recommended improvement:** (1) Rank the queues — one "start here" queue,
  chosen deterministically, with the reason stated. (2) Bulk assignment and bulk
  governance decision are no longer a convenience feature; at this volume they
  are what makes the workspace usable at all. (3) Suppress domain chips that
  hold >90% of the population — they filter nothing.
- **Priority:** Critical · **Release blocker:** No, but the beta will produce
  abandoned workspaces without it

### W-9 — The risk heatmap is empty and structurally cannot fill
- **Screen:** `/posture` → Risk Heatmap / Open Risks · **Category:** Workflow
  Improvement · **Theme:** T6, T7
- **Observation:** Both panels read: *"No risks promoted yet — findings don't
  become risks automatically. Review findings to decide what belongs on the risk
  register."* Open Risks: 0, against 550 findings.
- **Why it matters:** The empty-state copy is the best in the product — it
  explains the model, states the deliberate design choice, and offers the next
  action. Keep it as the template for every empty state. But the workflow behind
  it does not close: promotion is manual, one finding at a time, from a pool of
  550 with no bulk operation and no ranked shortlist. The risk heatmap is the
  most executive-legible artifact in GRC and the one a CRO will ask to see
  first; on this account it is empty and will stay empty through a realistic
  beta.
- **Recommended improvement:** Keep manual promotion as the governance
  guarantee, but add a ranked "candidates for promotion" shortlist —
  deterministic, explained, 5–10 items. Manual approval preserved, the blank
  register solved.
- **Priority:** High · **Release blocker:** No

### W-10 — Internal storage vocabulary is shown to the customer
- **Screen:** `/assets` · **Category:** UX Improvement · **Theme:** T4
- **Observation:** Every asset row carries a "Backing:" label exposing the
  source table — "Backing: enterprise entities", "Backing: vendors", "Backing:
  endpoints", "Backing: ai systems".
- **Why it matters:** "Backing: enterprise entities" is not a sentence in any
  customer's vocabulary; it is our schema. Exposing it makes the registry read
  as a database viewer rather than a product, and it raises a question we do not
  want asked in a demo ("what's the difference between an enterprise entity and
  an asset?"). Note the same page *does* offer Vendor and AI System type filters
  — which confirms the fix proposed in B-2 is available today.
- **Priority:** Medium · **Release blocker:** No

### W-11 — A third, incompatible domain taxonomy
- **Screen:** `/posture` · **Category:** Product Design Improvement · **Theme:** T4
- **Observation:** Posture reports "Domains Tracked: 3" — Access Control, Vendor
  Risk, AI Governance. `PRODUCT_VISION.md` sells five domains (Cyber
  Intelligence, Vendor Risk, AI Governance, Compliance Management, Risk &
  Findings Operations). The nav groups a fourth way (Intelligence, Risk
  Operations, Assets, Compliance). Only "Vendor Risk" and "AI Governance" appear
  in more than one.
- **Why it matters:** Compounds B-5. The customer now holds three mental models
  and must reconcile them unaided. "Domains Tracked: 3" also implies our own
  coverage is 3/5 of what we advertise.
- **Priority:** Medium · **Release blocker:** No

### W-12 — Three screens tell three different stories about approvals
- **Screens:** `/dashboard`, `/findings`, `/approvals` · **Category:**
  Functional Bug · **Theme:** T5
- **Observation:** As the designated **approver**: the Briefing shows "Ready to
  Close — remediation complete, governance decision pending: **4**"; the
  Operations Workspace shows "Awaiting Approval: **0**" and "Ready to Close:
  **4**"; `/approvals` shows "0 awaiting decision" and "The risk approval
  workflow isn't enabled for your organization yet."
- **Why it matters:** The approver cannot determine from the product whether
  there are four decisions waiting or none, or whether the approval workflow
  exists at all. These are reconcilable internally (different objects: risk
  acceptances vs. treatment plans vs. findings ready to close), but the customer
  is given three counts under three near-identical labels and no reconciliation.
  For the one workflow whose entire value is audit defensibility, ambiguity
  about what is pending is the most damaging possible defect.
- **Recommended improvement:** One canonical "decisions awaiting you" count,
  computed once and rendered identically everywhere, with the object types named
  as sub-lines beneath it.
- **Priority:** High · **Release blocker:** Yes

### W-13 — The approver's own work is filed under "Across Your Organization"
- **Screen:** `/dashboard` · **Category:** UX Improvement · **Theme:** T1
- **Observation:** "My Work" (Your Work zone) reads: findings you own 0, actions
  assigned to you 1. "Ready to Close — governance decision pending: 4" sits in
  the *Across Your Organization* zone with an "Organization" scope chip — for a
  user whose role in this tenant is approver, i.e. the person those four
  decisions belong to.
- **Why it matters:** The Briefing's zone split is a genuinely good idea, and
  the scope chips are honest. But the personal zone renders near-empty while the
  work that is actually this user's job is presented as ambient organizational
  context. The screen tells the approver they have nothing to do.
- **Recommended improvement:** Zone by *who must act*, not by which table the
  count came from. If the viewer is the approver, pending governance decisions
  are their work.
- **Priority:** Medium · **Release blocker:** No

### Strengths confirmed on staging — protect these
1. **Empty-state copy on `/posture`** ("findings don't become risks
   automatically…") — explains the model, justifies the design, offers the next
   action. Make it the standard.
2. **Operations Workspace queue descriptions** — every queue says what it means
   and what to do. Best microcopy in the product.
3. **Honest counting** — "Queues overlap by design… Totals count each queue
   independently · Counts as of 12:43 AM UTC." This is audit-grade discipline
   and a real differentiator against tools that quietly double-count.
4. **Briefing scope chips and failure handling** — "You" vs "Organization" on
   every number, one explicit error panel instead of silent zeros.
5. **Signal→vendor mapping is live and working** — "CVE-2026-20316 affects
   vendor: Cisco" on the dashboard. The Class A capability is real. It is also
   presented as an undifferentiated list item, which is W-14 below.

### W-14 — The Class A differentiator is rendered as a generic list row
- **Screen:** `/dashboard` → Recent Findings · **Category:** Intelligence
  Opportunity · **Theme:** T6
- **Observation:** Three rows read "Critical · CVE-2026-20316 affects vendor:
  Cisco · Vendor Risk". This is external intelligence deterministically mapped
  to the customer's own vendor inventory — per EG3 the thing "nobody" else
  does — and it is styled identically to every other finding row, with no
  provenance, no "why you are seeing this", and no link to the signal.
- **Why it matters:** A buyer scanning this screen has no way to know they are
  looking at the capability that distinguishes us. It reads as a CVE feed, which
  is the cheapest thing in the category.
- **Recommended improvement:** Give matched-signal findings a distinct
  treatment: the source signal, the match basis, the affected asset, and the
  date it appeared. Show the work — the determinism is the product.
- **Priority:** High · **Release blocker:** No

---

---

## 3c. Enterprise Trust Review

Session 2 — 2026-08-03. Same tenant, walked as **both** roles: the `admin`
approver and the `member` analyst (`walkthrough-analyst@seed.securelogicai.test`).
Surfaces: `/briefs`, `/controls`, `/evidence`, `/getting-started`,
`/settings/sso`, `/settings/security`, `/audit-log`, and a deliberately invalid
URL.

**The premise:** trust is not the absence of bugs. It is the customer's ongoing
belief that the product knows what it is doing. Every finding below is a moment
where a technically-working product spends that belief.

Each is answered against four questions: *expectation → violation → smallest
restoring change → what it damages.*

### Trust themes

| Theme | Pattern | Findings |
|---|---|---|
| **Permission transparency** | The product never says "you may not." It silently moves you somewhere else. | TR-1, TR-2 |
| **Data confidence** | The same object is counted differently on different screens, and sometimes on the same screen. | TR-3, TR-5 |
| **Product identity** | Internal build vocabulary — migration state, schema names, seed markers — is shown to customers. | TR-4, TR-9 |
| **Decision confidence** | Records are complete; the decision they exist to support is never closed. | TR-8, TR-10 |
| **Executive confidence** | The product's own verdict on the customer's posture is more optimistic than its data. | TR-7 |
| **Consistency** | Two capabilities of the same kind behave differently for no visible reason. | TR-1, TR-2 |
| **Product clarity** | A promise in the header that the body does not keep. | TR-6, and W-3 |

### TR-1 — Silent redirect is the answer to "denied," "missing," and "broken" alike
- **Category:** Enterprise Readiness Issue · **Theme:** Permission transparency,
  Consistency
- **Observed, as the `member` analyst:** `/audit-log` → **307 → `/dashboard`**,
  no message. `/settings/security` → **307 → `/settings/risk-scale`**, no
  message. And as any user, `/vendors/does-not-exist` → **307 redirect**, no
  message. There is no 403 page and no 404 page.
- **Expectation:** If I click a link a colleague sent me, the product tells me
  what happened.
- **Violation:** All three distinct conditions — *you lack the role*, *this
  record does not exist*, *this URL is wrong* — produce the identical silent
  bounce. The customer cannot tell them apart. `/settings/security` is the worst
  case: the analyst lands on a *different settings page*, which does not read as
  a permission boundary at all. It reads as the app mis-navigating. The user's
  conclusion is not "I'm not an admin"; it is "this product is unreliable."
- **Smallest change that restores confidence:** Two pages. A 403 that names the
  required role ("Audit Log requires the admin role — ask your organization's
  admin"), and a 404 that says the record is gone and offers the parent list.
  Stop redirecting. A stated boundary is reassuring; a silent one is alarming.
- **Damages:** Trust and usability. In a Fortune 500 POC, a silent redirect
  during a shared screen is read as a bug in front of an audience.
- **Priority:** High · **Release blocker:** No

### TR-2 — A non-admin is shown the org-wide SSO form, including "disable password login"
- **Category:** Enterprise Readiness Issue · **Theme:** Permission transparency
- **Observed:** As a `member`, `/settings/sso` returns **200** and renders the
  complete configuration form — IdP Entity ID, SSO URL, Certificate, SP Entity
  ID, a **"Enforce SSO — Require all users to sign in via SSO. Password login
  will be disabled"** toggle, and **Save Configuration**.
- **Is data at risk?** No. The engine enforces the boundary correctly:
  `POST /api/sso/config` carries `requireRole("admin")` (`src/api/routes/sso.ts:536`).
  This is a trust defect, not a security hole.
- **Violation:** `app/src/app/settings/sso/page.tsx:19` gates on *entitlement*
  only, never on role. So the product invites a member to configure org-wide
  authentication, lets them fill in a form containing the most destructive
  toggle in the platform, and denies them at submit. Compounding it,
  `SECONDARY_NAV_ITEMS` records this page's access as `"premium"`
  (`navigation.ts:430`) with no admin marker — so the generated knowledge index,
  and therefore Ask, would tell a member this is theirs to configure.
- **Expectation:** Controls I can see are controls I can use.
- **Smallest change:** Add the role check to the page guard, matching
  `/settings/security`, and correct the `access` metadata to `admin`. Better
  still: show admins the form and everyone else a read-only status line ("SSO is
  not configured — contact your admin").
- **Damages:** Trust and enterprise readiness. A security reviewer who finds a
  non-admin staring at "password login will be disabled" will assume the
  authorization model is decorative and audit everything else twice — even
  though, here, the server is right.
- **Priority:** High · **Release blocker:** Yes — this is the finding a POC
  security reviewer is most likely to find and least likely to forgive.

### TR-3 — The Brief archive contradicts itself and the dashboard
- **Category:** Functional Bug · **Theme:** Data confidence
- **Observed:** `/briefs` states **"1 brief in the archive"** and then lists
  Issues #11, #10, #9, #8, #7, #6, #5, #4… on the same screen. `/dashboard`
  links to **"View all 11 briefs →"**. Three counts of the same object across
  two screens.
- **Expectation:** A number on the page describes the page.
- **Violation:** The count is evidently counting new-format briefs only while
  the list renders both formats. The customer does not know that and cannot
  infer it. This is the wedge product — the artifact we ask people to pay for
  and the first thing a free-tier prospect sees.
- **Smallest change:** One count that describes what is actually listed. If two
  populations genuinely exist, say so: "1 brief · 11 archived issues."
- **Damages:** Data confidence, and it is contagious. A customer who catches
  the product miscounting eleven briefs has no reason to believe it counted 550
  findings correctly.
- **Priority:** High · **Release blocker:** Yes

### TR-4 — "Legacy Issues" shows customers our migration state
- **Category:** Product Design Improvement · **Theme:** Product identity
- **Observed:** The Brief archive is split into "Latest Brief" and a section
  headed **"Legacy Issues."**
- **Violation:** "Legacy" is our word for our own technical debt. To a
  subscriber it means deprecated, unsupported, or superseded — so eleven of the
  twelve things on the page are labelled as not worth reading. We have
  discounted our own back catalogue in the customer's mind to describe an
  internal format change they cannot see and do not care about.
- **Smallest change:** Delete the word. It is "Archive."
- **Damages:** Trust and product identity.
- **Priority:** Medium · **Release blocker:** No

### TR-5 — Brief issues are dated one day apart from their own titles
- **Category:** Functional Bug · **Theme:** Data confidence
- **Observed:** "Issue #10 · **May 18, 2026**" titled "…Intelligence Brief #10 —
  Sunday, **May 17**, 2026." "Issue #9 · **May 16**" titled "Friday, **May 15**."
  "Issue #8 · **May 14**" titled "Wednesday, **May 13**." A consistent one-day
  disagreement between the label and the title of the same artifact.
- **Violation:** For a publication whose value proposition is "what changed and
  when," two dates on one row is the most damaging small error available. A
  reader who notices it starts checking everything else.
- **Smallest change:** One date field, rendered once, from one source.
- **Damages:** Data confidence on the revenue product.
- **Priority:** High · **Release blocker:** No

### TR-6 — "Weekly risk intelligence" with a nine-week hole in the archive
- **Category:** Enterprise Readiness Issue · **Theme:** Product clarity
- **Observed:** The header promises *"Weekly risk intelligence…"*. The latest
  brief covers Jul 26 – Aug 2, 2026. The next item in the archive is Issue #11,
  May 19, 2026.
- **Violation:** The page makes a cadence promise and then displays nine weeks
  of evidence against it. A prospect evaluating a subscription checks exactly
  this. (Staging is not production and the gap may be an artifact of the
  environment — but the *page* offers no way to know that, which is the point.)
- **Smallest change:** Verify the production archive is continuous before beta.
  If gaps are real, stop promising "weekly" in the header.
- **Damages:** Trust in the commercial wedge.
- **Priority:** High · **Release blocker:** Verify before beta
- **Status:** Needs production confirmation — may be staging-only.

### TR-7 — Onboarding says "All done!" to an organization with a posture score of 4
- **Category:** Product Design Improvement · **Theme:** Executive confidence
- **Observed:** `/getting-started` reads **"5 of 5 steps complete · All done!"**
  Simultaneously: 550 active findings, 542 with no owner, 544 with no governance
  decision, posture 4/100, Access Control 0, Vendor Risk 0, risk register empty.
  The page then offers **"Skip setup for now →"** — after declaring setup
  complete.
- **Expectation:** When the product tells me I am done, I am in a defensible
  position.
- **Violation:** "Complete" is defined as *five features touched*, not *any risk
  reduced*. The product congratulates the customer at the exact moment their
  posture is at its worst, and the residual "Skip setup" link suggests the
  checklist does not know its own state. A CISO who reads "All done!" and then
  opens Posture to find 4/100 will trust neither screen.
- **Smallest change:** Redefine the final step as an outcome, not an action —
  "Assign owners to your critical findings" — and replace "All done!" with the
  honest next move. Remove "Skip setup" once complete.
- **Damages:** Executive confidence and decision confidence. This is the
  clearest instance of the system-of-record instinct beating the
  system-of-intelligence thesis: we measured our own feature adoption and called
  it the customer's success.
- **Priority:** High · **Release blocker:** No

### TR-8 — Controls can be "Implemented" and "Not assessed" at once, and a failed control leads nowhere
- **Category:** Intelligence Opportunity · **Theme:** Decision confidence
- **Observed:** Of three controls: "Security incident response plan —
  **Implemented** · **Not assessed**" and "Endpoint detection and response
  coverage — **Implemented** · **Not assessed**." The third, "MFA enforcement on
  privileged accounts," is **Failed** with a real assessment note ("MFA not
  enforced on 3 privileged accounts; admin console session logging absent") and
  offers no link to a resulting finding, action, or owner.
- **Violation:** An unassessed control asserted as implemented is the first
  thing an auditor challenges, and the product presents the combination without
  comment. Meanwhile the one control that *did* fail — with specific, actionable
  evidence — is a dead end. The customer reads a real failure and has nowhere to
  go.
- **Smallest change:** (1) Flag implemented-but-never-assessed as an explicit
  state ("Implemented · unverified") rather than two independent labels.
  (2) Make a failed assessment generate or link a finding with an owner. The
  control page should end in a decision, not a status.
- **Damages:** Audit defensibility and decision confidence.
- **Priority:** High · **Release blocker:** No

### TR-9 — Database enums are shown to customers as labels
- **Category:** UX Improvement · **Theme:** Product identity
- **Observed:** The `/controls` status filter renders **"Implemented
  partially_implemented"** — one label written for humans, the next a raw enum
  with an underscore. Same class as "Backing: enterprise entities" on `/assets`
  (W-10).
- **Violation:** Underscored identifiers are the visible seam between a product
  and its database. Two instances on two unrelated pages is not a typo; it is a
  missing display-label layer.
- **Smallest change:** One shared enum→label map, applied at render.
- **Damages:** Product identity — it makes a real product read as an internal tool.
- **Priority:** Medium · **Release blocker:** No

### TR-10 — The evidence register proves nothing
- **Category:** Intelligence Opportunity · **Theme:** Decision confidence
- **Observed:** The header is excellent — *"Records are write-once; downloads
  are audit-logged."* The contents: 13 records, all attached to Findings, none to
  Controls, named "IMG_0725", "VERIFY appproxy big 224040", "DIAG pdf 220121",
  "VERIFY png_2.4mb 223944".
- **Violation:** The page answers *what exists* and never *what it proves*.
  Evidence with no link to the control, requirement, or obligation it satisfies
  is inert at audit time — which is the only time it matters. The write-once and
  audit-log guarantees are genuinely strong and are being spent on a pile of
  unlabelled files. (The QA-artifact names are a seeded-tenant artifact, but they
  demonstrate the register imposes no naming or linkage discipline.)
- **Smallest change:** Require a link to what the evidence supports at upload,
  and show coverage on this page: "3 controls · 0 with evidence."
- **Damages:** Audit defensibility — the specific claim we make against
  AuditBoard and Hyperproof.
- **Priority:** High · **Release blocker:** No

### The underlying trust pattern

Nine of these ten are the same mistake in different clothes:

> **The product reports its own internal state as though it were the customer's
> situation.**

Our rollout flags become "not enabled for *your organization*" (W-4). Our
migration state becomes "**Legacy** Issues" (TR-4). Our schema becomes "Backing:
enterprise entities" and "partially_implemented" (TR-9, W-10). Our feature-adoption
counter becomes "**All done!**" (TR-7). Our brief-format split becomes a count
that contradicts its own list (TR-3). Our authorization boundary becomes a silent
redirect the customer must interpret unaided (TR-1).

In every case the product is internally correct and externally misleading. The
fix is not more features or better styling — it is a discipline: **no internal
state reaches the customer without being translated into their situation.** That
single rule closes W-4, TR-1, TR-3, TR-4, TR-7, TR-9, and W-10.

---

---

## 3d. Root-cause analysis — why the intelligence findings keep recurring

Session 3 — 2026-08-03. Traced one finding end to end through the UI *and* the
API, then measured the whole population (300 unique findings sampled of 551 via
`GET /api/findings`, deduplicated by id).

Sessions 1 and 2 produced repeated symptoms: the Briefing shows counts instead
of judgment (B-1), the Operations Workspace offers 14 queues and no first move
(W-8), the risk heatmap cannot fill (W-9), posture domains sit at 0 with no
path (W-7). These were filed as four product-design problems. **They are one
architectural problem.**

### RC-1 — The risk score has no inputs beyond severity, so nothing can be ranked
- **Category:** Enterprise Readiness Issue · **Attributes:** Intelligence,
  Explainability, Decision confidence
- **Measured across 300 findings:**

  | Field | Null |
  |---|---|
  | `scoring_rationale` | **100%** |
  | `framework_control_id` | **100%** |
  | `likelihood` | 98% |
  | `confidence` | 98% |
  | `time_sensitivity` | 98% |
  | `recommendation` | 98% |
  | `owner_user_id` | 97% |

  Distinct `(severity, priority)` combinations across all 300: **three.**
  287 are `High / near_term`, 12 are `Critical / immediate`, 1 is
  `High / immediate`.

- **What the customer is shown:** The finding detail page renders *"Risk
  **100/100** (Critical)"* with an explainer — *"Why 100/100? — how this score
  was computed: **Severity Critical → base 90. Priority immediate → +10.**"*
- **The problem:** That derivation is the whole computation. The risk score is
  severity, restated, plus ten. Because only three severity/priority
  combinations exist in the entire inventory, **the 551-finding population
  collapses to three distinct risk scores, and 96% of findings share one of
  them.** Ranking is not weak here; it is arithmetically impossible.
- **Why this is the root cause:** Every intelligence symptom in this backlog
  follows from it. The Briefing cannot lead with "what needs your judgment
  today" (B-1) because no field distinguishes one finding from the next 286.
  The Operations Workspace cannot promote one of its 14 queues (W-8) for the
  same reason. The heatmap has no basis on which to nominate promotion
  candidates (W-9). Posture domains aggregate undifferentiated inputs and land
  at 0 (W-7). We did not forget to build prioritization — **we built the schema
  for it and never populated the inputs.** The columns exist and are empty.
- **The cruel detail:** the explainability feature is excellent and it is what
  exposes this. Showing the work is exactly right. Here, showing the work
  reveals there is no work. A sophisticated CISO reads "Severity Critical → base
  90" and asks, correctly, "so your risk score is just severity?"
- **Smallest change that materially improves it:** Populate one differentiating
  input before beta and show it in the derivation — asset criticality is already
  in the registry (`/assets` carries Critical/High/Medium per asset) and needs
  no new pipeline. "Severity Critical → 90 · Asset Microsoft is business-critical
  → +8 · Exploitation observed in the wild → +12" produces a *rankable* score
  and a *defensible* sentence in the same stroke. That one change unlocks B-1,
  W-8 and W-9, which are otherwise unfixable at the UI layer.
- **Priority:** Critical · **Release blocker:** No — but every "make it more
  intelligent" item in this backlog is blocked behind it, and none of them can
  be honestly delivered until it lands.

### RC-2 — Findings and the control environment are structurally disconnected
- **Category:** Enterprise Readiness Issue · **Attributes:** Audit
  defensibility, Workflow continuity
- **Measured:** `framework_control_id` is null on **100%** of findings sampled.
  `source_type` is `cyber_signal` on **98%** (plus one `control_test`, one
  `intelligence_event`).
- **What the customer is shown — honestly, to the product's credit:** the
  finding detail Business-impact panel reads *"Operational: **None** — No
  control or AI system in your inventory is linked to this finding"* and
  *"Regulatory: **None** — No obligation in your register is linked to this
  finding."*
- **The problem:** The product vision promises "an operating layer" where
  external signals connect to controls, obligations, evidence, and posture. In
  practice the chain breaks at every internal join:

  ```
  signal → finding ─╳→ control → framework → obligation
  finding ─╳→ risk register → heatmap        (manual only, W-9)
  finding → evidence ─╳→ control            (13 records, 0 control-linked, TR-10)
  control test failure ─╳→ finding          (TR-8)
  ```

  What exists is five well-built registers that do not reference each other.
  98% of findings are external intelligence that never touches the internal
  control environment; the one failed control (`MFA enforcement`) produced no
  linked finding. This is why Vendor Risk holds 547 of 550 findings while
  Access Control holds 2 — not because the org is vendor-heavy, but because
  only the external pipeline is wired.
- **Why it matters commercially:** the connection *is* the product. Disconnected,
  we are a CVE feed beside a control spreadsheet beside a file cabinet — which
  is the incumbent architecture we claim to replace. EG3's Class A claim
  ("external intel → your inventory, with provenance") is half-delivered: the
  vendor join works and is genuinely impressive, the control and obligation
  joins do not exist.
- **Smallest change:** Wire the one join with the shortest path and the highest
  audit value — control test failure → finding, with the control id set. It
  makes TR-8 close, gives Access Control a real population, and produces the
  first findings in the system that a customer's own environment generated.
- **Priority:** Critical · **Release blocker:** No, but it is the gap that loses
  an audit-led evaluation.

### RC-3 — The product detects duplicates and declines to reconcile them
- **Category:** Functional Bug · **Attributes:** Data confidence
- **Measured (correcting an earlier overestimate of mine):** duplication is
  **not** widespread — 291 distinct titles across 300 findings, roughly 3%
  redundancy. But **3 of the duplicate groups carry conflicting severities**:
  `CVE-2026-20316 / Cisco` exists as 5 findings from 5 distinct `source_id`s,
  scored **3 Critical and 2 High**. `CVE-2026-50522 / Microsoft`: 2 Critical, 2
  High. `CVE-2026-58644 / Microsoft`: 1 Critical, 2 High.
- **What the customer is shown:** the finding detail "Related findings" panel
  lists them together under the explicit label **"Same vulnerability."**
- **The problem:** the product has already determined these are the same
  vulnerability against the same vendor — it says so on screen — and still
  presents the customer with three different severities for it and no
  reconciliation. Five source articles about one CVE became five findings, five
  SLA clocks, five assignment decisions. The dedup knowledge exists at *display*
  time and is not applied at *decision* time.
- **Why it matters:** "Is this Critical or High?" is the one question the
  customer must answer to act, and the product answers both. This is a
  data-confidence failure of the same family as TR-3 and TR-5 — and unlike
  those, it directly corrupts the work queue.
- **Smallest change:** Collapse same-CVE/same-vendor findings into one finding
  with multiple sources, taking the highest severity, and show the source count
  as corroboration ("5 sources") — which is a *strength* signal, not noise.
- **Priority:** High · **Release blocker:** No

### The architectural pattern

Sessions 1 and 2 found a copy-and-messaging pattern: *internal state leaks to
the customer*. Session 3 finds the structural one beneath it:

> **We built the containers for intelligence and shipped them empty, then built
> the read surfaces on top as though they were full.**

`scoring_rationale`, `likelihood`, `confidence`, `time_sensitivity`,
`framework_control_id`, `recommendation` — every column that would make a
finding rankable, explainable, or connected exists in the schema and is null in
production data. The UI layer is then asked to produce judgment from severity
alone, and it does the only honest thing available: it counts and links.

**This is why the product reads as a system of record.** Not because anyone
chose that, and not because the read surfaces are poorly designed — several are
excellent — but because a system of intelligence needs differentiating inputs
and there are none. Every UI-layer fix proposed in B-1, W-8, and W-9 is
downstream of RC-1 and cannot be honestly delivered before it.

**Recommended sequencing change:** stop treating "make the Briefing smarter" as
a design task. It is a data task. One populated scoring input (asset
criticality, already available) does more for the intelligence claim than any
redesign of any read surface in this backlog.

### Strengths confirmed in session 3 — the finding detail page is the best surface in the product

Protect all of these; several are competitive advantages already built:
1. **The score explainer** — "Why 100/100? Severity Critical → base 90…" Nobody
   in the category shows the derivation. Keep it exactly as-is; fix the inputs
   behind it, not the disclosure.
2. **The lifecycle stepper** — Detected → Assessed → Remediation → Governance →
   Closed. Orients instantly.
3. **Honest disconnection reporting** — "No control or AI system in your
   inventory is linked to this finding." The product volunteers its own gap
   rather than rendering an empty section.
4. **Risk-acceptance copy** — "a signed governance decision, not a status you
   set. It stays Active until a *different authorized colleague* approves it."
   Separation of duties explained in one sentence.
5. **"Mark reviewed by me"** — states plainly what it does *not* do: "does not
   change the governance decision, operational status, or any queue." Best
   disclosure copy in the product, and the template for TR-1's permission
   messaging.
6. **Operational status** — "Derived from linked remediation — you can't set it
   directly." Explains a constraint instead of just disabling a control.

---

---

## 3e. Session 4 — the wedge product, and the remaining surfaces

Walked `/briefs/{id}` (the current Intelligence Brief and one full-analysis
page), `/queue`, `/frameworks`, `/obligations`, `/policies`, `/risks`,
`/actions`, `/vendor-assurance/queue`, `/search`.

### BR-1 — The Intelligence Brief is one templated sentence, repeated twelve times
- **Category:** Product Design Improvement · **Attributes:** Intelligence,
  Executive usability, Enterprise trust
- **Observed** — the current brief (Aug 2, 2026), in full structure. Every one of
  the twelve items is identical in shape:

  > **NEAR TERM · Vulnerability** — *{Product} {Vulnerability class} — {Vendor}*
  > **HIGH**
  > **Action:** "Security: patch {CVE} on internet-facing assets within this week."
  > **Context:** "{Vendor} environments ({CVE}) face active exploitation risk at
  > high severity. Unpatched systems are exposed until remediation is verified."

  Twelve items. One sentence, with the vendor name and CVE substituted. The
  header counts read **Immediate 0 · Near-term 12 · Watching 0** — every item is
  in the same band, at the same severity (HIGH), with the same action verb.
- **What the customer is trying to decide:** "Of everything that happened this
  week, what do I need to act on, and what can wait?" The Brief's entire
  premise is prioritization. It prioritizes nothing: twelve of twelve are
  near-term/high.
- **Why it matters:** `CLAUDE.md` sets the standard explicitly — the Brief "must
  not feel like generic AI content" or "a styled summary of scraped links," and
  must be "credible enough that a leader would pay for it." This is a mail merge.
  It is the commercial wedge, the free-tier prospect's first impression, and the
  artifact we ask people to subscribe to.
- **Smallest change:** Do not attempt twelve analyses. Write **one** — the item
  that actually touches this customer's inventory — and list the rest as a
  compact "also in the KEV catalog this week" table. One paragraph of real
  judgment beats twelve of template, and the relevance data needed to pick that
  one item already exists (see BR-3).
- **Priority:** Critical · **Release blocker:** Yes for anything sold as a
  subscription

### BR-2 — Six of twelve "developments this period" are 5–16 years old
- **Category:** Functional Bug · **Attributes:** Enterprise trust, Clarity
- **Observed:** The brief is labelled *"Jul 26 – Aug 2, 2026"* and *"12 analyzed
  developments from 4507 signals **this period**."* The twelve include
  **CVE-2010-0188** (Adobe Reader, 2010), **CVE-2019-18935**, **CVE-2020-2555**,
  **CVE-2020-8644**, **CVE-2020-11651**, and **CVE-2021-22894** — each with the
  instruction to *"patch within this week."*
- **Diagnosis:** This is the CISA KEV catalog being ingested and re-presented as
  weekly news. KEV *additions* are current events; KEV *entries* are not.
- **Why it matters:** This is the most credibility-destroying item in the entire
  review. A CISO recognizes CVE-2010-0188 on sight. Being told that a
  sixteen-year-old Adobe Reader bug is one of this week's twelve most important
  developments ends the evaluation — not because the product is wrong about the
  CVE, but because it demonstrates nobody is exercising judgment between the
  feed and the customer. Every other number on the platform is then suspect.
- **Smallest change:** Filter on *date added to KEV*, not KEV membership, and
  state the window. If an old CVE genuinely re-surfaced this week, say why —
  "added to KEV Jul 29 after renewed exploitation" — which is a genuinely
  valuable signal and currently invisible.
- **Priority:** Critical · **Release blocker:** Yes

### BR-3 — Ten of twelve items concern vendors the customer does not have
- **Category:** Intelligence Opportunity · **Attributes:** Intelligence,
  Executive usability
- **Observed:** The org's asset registry contains **two** vendors: Cisco and
  Microsoft. The brief's twelve items cover Fortinet, Cisco, Arista, Oracle,
  PlaySMS, Adobe, Progress, Ivanti, SaltStack, Microsoft and others. No item is
  marked as applying — or not applying — to this organization.
- **The sharpest detail:** the one item that *is* genuinely relevant (Cisco
  CVE-2026-20316 — the same CVE that generated five findings and appears on this
  customer's dashboard) is rendered **identically** to the PlaySMS item. We hold
  the relevance data, we demonstrably use it elsewhere in the product, and the
  Brief ignores it.
- **Why it matters:** "Connects signals to platform context" is the Brief's
  stated differentiator in `PRODUCT_VISION.md` and the reason it is a wedge into
  the platform rather than a newsletter. Unfiltered, it is a KEV mailing list
  with better typography — and it buries the one item that proves our Class A
  capability underneath nine that don't apply.
- **Smallest change:** Sort by inventory match and label it. "**Affects your
  environment** — Cisco is in your asset registry, 5 open findings" at the top;
  everything else below a divider marked "Not matched to your inventory." This
  is one sort and one label over data we already have, and it converts the Brief
  from a feed into proof of the platform.
- **Priority:** Critical · **Release blocker:** No, but it is the single highest
  ratio of commercial value to engineering effort in this document.

### BR-4 — "Read full analysis" is four boilerplate steps
- **Category:** Product Design Improvement · **Attributes:** Intelligence
- **Observed:** The per-item page adds: "Review the vendor advisory… Monitor
  endpoint and network telemetry for indicators of compromise… Validate firewall
  and access control rules… Escalate to incident response if active exploitation
  is suspected." These four steps are applicable to any vulnerability ever
  published and are, as far as the walk showed, identical across items.
- **Why it matters:** The link promises analysis and delivers a checklist that
  contains no information about the specific CVE. A promise in the label the
  body does not keep — the same pattern as W-3.
- **Priority:** High · **Release blocker:** No

### BR-5 — **Strength:** the Brief→platform bridge is the best workflow in the product
- **Observed** on the full-analysis page, a "Decision" block: *"No finding has
  been tracked for this intelligence in your organization yet. Create one to
  assign an owner, plan remediation, and record the decision."* → **"Create a
  finding from this intelligence →"**
- **Why this matters:** This is exactly the wedge-to-platform conversion the
  product strategy depends on, and it is the only place in the entire review
  where a read surface ends in a decision with an owner. It states the gap,
  explains the consequence, and offers the action. **Protect it, and use it as
  the template for every terminal surface in the product** — it is the answer to
  the workflow-continuity problem everywhere else.
- One improvement: it should also say when the intelligence does *not* apply —
  "Fortinet is not in your asset registry" — which is more valuable than
  inviting a finding for a product the customer does not run.

### QU-1 — The matcher's "Why" is a restatement, not a reason
- **Screen:** `/queue` (Review Suggested Links) · **Category:** Product Design
  Improvement · **Attributes:** Explainability
- **Observed:** Each suggestion carries a labelled **"Why:"** field. Its content:
  *"SecureLogic linked this signal to this control."* And for the other:
  *"SecureLogic linked this signal to this obligation."*
- **Why it matters:** The customer is being asked to accept or dismiss a link —
  a decision — and the field labelled with their question answers it
  tautologically. For a platform whose Class A claim is deterministic mapping
  that *shows its work*, "why" answered as "because we did" is worse than no
  field: it advertises an explanation and withholds it. The match confidence
  ("High confidence" / "Medium confidence") is shown but never derived.
- **Smallest change:** State the actual basis, which the matcher must already
  have: "CVE-2026-90001 affects SharePoint · this control covers privileged
  access to SharePoint · matched on asset + control scope."
- **Priority:** High · **Release blocker:** No

### QU-2 — The signal→control join exists, on the wrong object (refines RC-2)
- **Category:** Enterprise Readiness Issue · **Attributes:** Workflow continuity,
  Audit defensibility
- **Observed:** `/queue` contains exactly **2** pending suggestions, and they do
  what RC-2 says is missing — link an external signal to a **control** ("MFA
  enforcement on privileged accounts") and to an **obligation** ("HIPAA Security
  Rule — Access Control"). Meanwhile 100% of the 551 findings carry
  `framework_control_id: null`.
- **The architectural detail:** there are two parallel linking systems. The
  matcher links **signal → control**. The finding pipeline creates **signal →
  finding**. Nothing links **finding → control**. So a customer can accept every
  suggested link and their findings will still report "No control in your
  inventory is linked to this finding."
- **Why it matters:** This changes RC-2's remedy. The join is not missing —
  it is landing on an object the operational surfaces don't read. Propagating
  the accepted signal→control link onto the findings derived from that signal is
  a far smaller change than building control linkage from scratch, and it makes
  the two suggestions in the queue actually worth reviewing.
- **Priority:** High · **Release blocker:** No

### FW-1 — The only active framework reads 0% with no path and a version collision
- **Screen:** `/frameworks` · **Category:** Intelligence Opportunity ·
  **Attributes:** Clarity, Decision confidence
- **Observed:** Active: **NIST CSF v2.0 — 0% — "0 fully satisfied · 3 partial."**
  The template gallery below simultaneously offers **"NIST Cybersecurity
  Framework v1.1 · 57 requirements"** to activate.
- **Why it matters:** Two problems in one view. (1) The customer's compliance
  readiness is 0% with no denominator, no list of what is unsatisfied, and no
  next action — the same "number without a path" failure as W-7. Three mapped
  controls against a framework with dozens of requirements means 0% is
  structurally guaranteed, and the screen doesn't say so. (2) Two versions of
  NIST CSF are presented as different things — one active, one activatable —
  with no explanation of the relationship. A compliance officer cannot tell
  whether activating v1.1 would replace, supplement, or conflict with v2.0.
- **Smallest change:** Show "3 of N requirements mapped" beside the 0%, and name
  the top unmapped requirement as the next action. Suppress or clearly relate
  older versions of an already-active framework.
- **Priority:** High · **Release blocker:** No

### RG-1 — The Risk Register has no empty state, while the page that links to it has an excellent one
- **Screen:** `/risks` · **Category:** UX Improvement · **Attributes:** Workflow
  continuity
- **Observed:** `/posture` explains the model beautifully — *"No risks promoted
  yet — findings don't become risks automatically. Review findings to decide
  what belongs on the risk register"* — and links through. The destination,
  `/risks`, presents **Total Risks 0 · Open 0 · Critical 0 · Overdue Reviews 0**,
  a search box, and filter chips. No explanation, no guidance, no next step.
- **Why it matters:** The customer follows an explanation to a page that has
  forgotten it. The best copy in the product is on the summary; the destination
  is a bare table of zeros. This is the inverse of what should happen — depth
  should increase as you navigate inward.
- **Smallest change:** Move the `/posture` empty-state copy to `/risks` and add
  the promotion entry point there.
- **Priority:** Medium · **Release blocker:** No

### VA-1 — An empty state directs the customer to a page removed from the navigation
- **Screen:** `/vendor-assurance/queue` · **Category:** Workflow Improvement ·
  **Attributes:** Workflow continuity
- **Observed:** *"No assurance documents uploaded yet. **Upload a SOC report from
  the vendor detail page** to get started."* Per B-2, "Vendors" is dropped from
  the navigation when `asset_registry` is on — which it is. The instruction names
  a destination the customer cannot reach from the menu.
- **Why it matters:** This is B-2 producing a concrete dead end rather than a
  theoretical one. It is also the entry point to the entire vendor-assurance
  workflow, so that workflow is unreachable by following the product's own
  instructions.
- **Smallest change:** Link the words "vendor detail page" directly, or add an
  upload action here. Independently, fix B-2.
- **Priority:** High · **Release blocker:** No

### VA-2 — "Finalized (legacy)" — internal migration state, again
- **Screen:** `/vendor-assurance/queue` status tabs · **Category:** UX
  Improvement · **Attributes:** Product identity
- **Observed:** Eight status tabs including **"Finalized (legacy)"**, alongside
  pipeline states "Extracting" and "Extraction failed."
- **Why it matters:** Third instance of the TR-4 pattern (after "Legacy Issues"
  and "partially_implemented"). The customer is asked to navigate our data
  migration history. Confirms this is a systemic missing display-label layer, not
  three isolated typos.
- **Priority:** Medium · **Release blocker:** No

### AC-1 — Overlapping action counts, undisclosed
- **Screen:** `/actions?view=mine` · **Category:** UX Improvement ·
  **Attributes:** Data confidence
- **Observed:** **Open 1 · Overdue 1 · At risk this week 1 · No SLA set 0** —
  against a single action ("This is a test," overdue since Jul 23). One item is
  counted in three buckets, and "Overdue" and "At risk this week" are presented
  as if mutually exclusive.
- **Why it matters:** `/findings` handles exactly this situation impeccably —
  *"Queues overlap by design: one finding can appear in several at once. Totals
  count each queue independently."* `/actions` does the same thing silently. The
  disclosure discipline exists in the product and is applied inconsistently,
  which is how a customer learns that our transparency is decorative rather than
  systematic.
- **Smallest change:** Reuse the `/findings` disclaimer verbatim.
- **Priority:** Medium · **Release blocker:** No

### SR-1 — Search is a blank page
- **Screen:** `/search` · **Category:** UX Improvement · **Attributes:** Clarity
- **Observed:** A heading, one line of body copy ("Find findings, risks, vendors,
  AI systems, controls, obligations, and assets across your organization"), and
  nothing else — no example queries, no recent searches, no syntax guidance, no
  browsable entry points.
- **Why it matters:** Contrast `/ask`, which offers six worked example prompts
  (and fails on them — W-1). Search works and offers none. A federated search
  across seven object types is genuinely valuable and completely undiscoverable
  if the customer must guess what to type.
- **Smallest change:** Three example queries and the seven searchable object
  types as clickable chips.
- **Priority:** Medium · **Release blocker:** No

### Pattern confirmed across sessions 3 and 4

Session 3 named it: *we built the containers for intelligence and shipped them
empty.* Session 4 shows the same shape in the wedge product and in the matcher:

- The Brief has a **prioritization** structure (Immediate / Near-term /
  Watching) and puts 12 of 12 items in one band.
- The Brief has a **relevance** capability (proven elsewhere in the product) and
  applies none of it.
- The matcher has a **"Why"** field and fills it with a restatement.
- The finding has a **`scoring_rationale`** column and fills it with null.
- The framework has a **readiness percentage** and no denominator.

In every case the *structure* for judgment is built, correct, and empty. This is
not a design deficiency — the designs anticipate exactly the right things. It is
a **content and derivation** deficiency. The product's skeleton is that of a
system of intelligence; the substance is that of a feed reader.

That is genuinely good news for sequencing: the expensive part — designing
surfaces that can carry judgment — is done. What remains is filling them, and
the three highest-value fills are all small: sort the Brief by inventory match
(BR-3), state the matcher's actual basis (QU-1), and add one differentiating
input to the risk score (RC-1).

---

---

## 3f. Session 5 — closing the gaps: the graph, the failure paths, the empty org

### ER-1 — The product knows how to explain a failure. It does it for authentication only.
- **Category:** UX Improvement · **Attributes:** Clarity, Confidence,
  Workflow continuity · **Supersedes the remedy in TR-1**
- **Observed — done well:**
  - An invalid session on `/dashboard` redirects to
    **`/login?reason=expired&redirect=%2Fdashboard`**, and the login page renders
    *"Your session expired. Please sign in again."* It states the cause **and**
    preserves the destination.
  - Login failures are mapped to human sentences, not codes: `invalid_credentials`
    → *"Invalid email or password"*, with distinct handling for
    `email_not_verified`, `account_locked`, `mfa_enrollment_required`,
    `invalid_code`, `too_many_attempts` (`app/src/app/login/page.tsx:93-148`).
- **Observed — the same mechanism unused:**
  - Non-admin → `/audit-log`: bare `307` to `/dashboard`. No reason, no return.
  - Non-admin → `/settings/security`: bare `307` to `/settings/risk-scale`.
  - A finding that does not exist → bare `307` to `/findings`. The engine returns
    a perfectly good `{"error":"finding_not_found"}` and the app discards it.
- **Why this reframes TR-1:** the earlier finding assumed the product had no way
  to explain a denial. It has one, it is well built, and it is applied to one of
  three failure classes. The customer therefore learns that SecureLogic explains
  itself when *we* failed them (session expiry) and goes silent when *they* hit a
  boundary or a dead link — the opposite of the reassuring pattern.
- **Smallest change:** Extend the existing `?reason=` convention.
  `/login?reason=expired` already proves the pattern; add
  `/dashboard?reason=requires_admin&from=/audit-log` and
  `/findings?reason=not_found`. One convention, three call sites, no new
  components. This makes TR-1 close for roughly the cost of the strings.
- **Priority:** High · **Release blocker:** No

### EO-1 — The empty-org rule is documented for all nine modules and implemented in two
- **Category:** Product Design Improvement · **Attributes:** Confidence,
  Enterprise trust · **Method note:** verified in code, not walked — staging
  signup requires email verification, so a fresh tenant could not be reached
  empirically. Stated as code evidence.
- **The rule, in the product's own words** (`TheBriefing.tsx:95-97`): *"Zero-count
  modules must then read as 'nothing measured yet', never as green 'all clear' —
  reassurance on an unassessed org is the fastest way to lose trust in every
  number that follows."* This is exactly right, and `hasPlatformData`
  (`dashboard/page.tsx:129-138`) computes it correctly across eight signals.
- **The gap:** the registry defines **9** modules. `hasPlatformData` is branched
  on in **2** of them — "My Work" (line 412) and "Needs Attention" (line 477),
  both of which handle it perfectly ("Nothing assessed yet — findings appear here
  once assessments run" instead of a green all-clear). The other seven do not
  consult it.
- **The one that matters most:** "Since Your Last Visit" (line 327) renders
  `allQuiet` — *"Quiet since your last visit — no new findings, no new overdue
  work, no decisions waiting"* — **without** consulting `hasPlatformData`. It is
  the first module on the page. So a brand-new organization that has never been
  assessed opens the product to a statement of calm about an environment nobody
  has looked at. This is W-2's failure again, and on an empty org it is worse:
  there is no "488 High findings" below it to contradict the reassurance, so the
  customer has no way to detect that "Quiet" means "unmeasured."
- **Smallest change:** Gate `allQuiet` on `hasPlatformData` — the signal already
  exists and is already threaded into this component. Empty org → *"Nothing
  measured yet. Your first assessment will populate this."* Then audit the
  remaining six modules against the rule the file already states.
- **Priority:** Critical · **Release blocker:** Yes — this is the first sentence
  of the product for every Private Beta customer.

### EC-1 — Two registries describe the same objects under two names
- **Screen:** `/enterprise-context` vs `/assets` · **Category:** Product Design
  Improvement · **Attributes:** Clarity, Product identity
- **Observed:** `/enterprise-context` — *"The assets, applications, services, and
  organizational structure your risk picture is built on"* — lists SharePoint,
  Defender, and Catalyst SD-WAN as Applications. `/assets` lists **the same three
  objects**, each annotated **"Backing: enterprise entities."** Both are separate
  top-level nav entries.
- **Why it matters:** The EAR design names the Asset Registry the "single
  canonical entry point," and the product ships a second canonical-looking
  registry beside it. A customer cannot tell which one to maintain, whether
  adding an asset in one creates it in the other, or which is authoritative at
  audit. The "Backing:" label (W-10) is the relationship leaking through because
  there is no customer-facing account of it.
- **Smallest change:** Decide which is the customer's registry and make the other
  a view inside it. If Enterprise Context must stay separate, its header has to
  state the relationship in one sentence.
- **Priority:** High · **Release blocker:** No

### EC-2 — "Confidence: high" on every entity, defined nowhere
- **Screen:** `/enterprise-context` · **Category:** UX Improvement ·
  **Attributes:** Explainability
- **Observed:** Each entity carries **"Confidence: high."** Confidence in what —
  that the entity exists, that its classification is right, that its criticality
  is right? No legend, no derivation, no variation (all three read "high").
- **Why it matters:** Third instance of a confidence-or-reason field displayed
  without derivation, after QU-1 ("Why: SecureLogic linked this signal to this
  control") and RC-1 (`scoring_rationale` null under a stated score). A
  confidence value the customer cannot interpret is not evidence — it is
  decoration that looks like evidence, which is worse.
- **Priority:** Medium · **Release blocker:** No

### EC-3 — The multi-entity hierarchy is filters over nothing
- **Screen:** `/enterprise-context` · **Category:** Future Enhancement ·
  **Attributes:** Enterprise readiness
- **Observed:** Type filters offer Business Unit, Department, Data Store, Data
  Classification, Identity, Business Process, Business Service. The tenant
  contains three entities, all of type Application. EG3 classes multi-entity
  hierarchy as "C — exists via the Enterprise Context Layer… never load-tested;
  Fortune 100 org structures are punishing."
- **Why it matters:** Not a defect — the capability is real and the filters are
  honest. But it is the surface a Fortune 500 evaluator will probe hardest
  (*"model my 40 business units"*), and there is no evidence in this environment
  that it has ever held one. Flagging as a beta validation task, not a fix.
- **Priority:** Low for beta · **Release blocker:** No

### Final pattern note — the product is better at trust than it is at showing it

Sessions 1–4 found the structures for judgment built and empty. Session 5 adds a
narrower and more encouraging version of the same thing: **the correct behavior
is often already implemented, and applied in one place instead of everywhere.**

| The right pattern, already built | Where it's applied | Where it isn't |
|---|---|---|
| `?reason=` + destination preservation + a human sentence | session expiry | role denials, missing records (TR-1) |
| `hasPlatformData` → "nothing measured yet," never green | 2 of 9 Briefing modules | the other 7, incl. the first one (EO-1) |
| "Queues overlap by design… counts each independently" | `/findings` | `/actions` (AC-1) |
| The "Decision → create a finding" bridge | Brief full-analysis page | every other terminal surface (BR-5) |
| Empty state that explains the model and the next step | `/posture`, `/policies` | `/risks` (RG-1), `/search` (SR-1) |

Five of the most trust-building behaviors in the product each exist in exactly
one place. **This is the cheapest work in this entire backlog** — no new
concepts, no new components, no design decisions to litigate. Someone already
made the right call; it simply was not propagated. Doing so would resolve TR-1,
EO-1, AC-1, RG-1 and SR-1 outright and materially improve W-2.

---

## 4. Open questions

**Answered in session 1:**
1. ~~Does `/executive` render on staging?~~ → It renders three "not enabled"
   notices under a four-capability headline. W-3.
2. ~~Is `/ask` good enough to be a differentiator?~~ → It fails on 4 of its own
   4 suggested prompts. W-1.
3. ~~Where does the product say "do this first"?~~ → **Nowhere.** Not on the
   Briefing, not in the Operations Workspace, not on Posture. T1 is confirmed as
   the dominant theme of this review.

**Answered in session 2:**
4. ~~What does a non-admin see?~~ → Silent redirects with no explanation, and
   the org-wide SSO form they cannot submit. TR-1, TR-2.
5. ~~Do Controls and Evidence close their workflows?~~ → No. A failed control
   links to nothing; evidence links to nothing. TR-8, TR-10.

**Answered in session 3:**
6. ~~Does the finding detail page support a defensible decision?~~ → It is the
   best surface in the product and it exposes RC-1: the derivation it honestly
   shows is severity plus ten.

**Answered in session 4:**
7. ~~Is the Brief content decision-grade?~~ → No. BR-1, BR-2, BR-3.
8. ~~Do the remaining surfaces reveal anything new?~~ → Mostly downstream of
   RC-1/RC-2, but four independent findings: QU-1, FW-1, VA-1, SR-1.

**Answered in session 5:**
9. ~~What does a genuinely empty org see?~~ → Verified in code (staging signup
   requires email verification, so it could not be walked). The empty-org rule is
   implemented in 2 of 9 Briefing modules and **not** in the first one — EO-1.
10. ~~`/enterprise-context`?~~ → Walked. EC-1, EC-2, EC-3. Every nav destination
    has now been walked.
11. ~~Worded failure paths?~~ → Walked. The product does this well for
    authentication and nowhere else — ER-1.

**Remaining — Private Beta validation tasks, not review gaps:**
12. Multi-entity hierarchy under a real Fortune 500 org structure (EC-3).
13. Production confirmation of the Brief archive cadence (TR-6).
14. Write-path failures (rejected upload, save conflict) were deliberately not
    exercised — they require mutating staging data.

---

## 5. Release-blocker summary

| ID | Finding | Blocker |
|---|---|---|
| W-1 | Ask fails on all its own suggested prompts | **Yes** — fix or remove |
| W-2 | "Quiet" reported against 499 critical/high findings | **Yes** |
| W-3 | Executive dashboard is an empty shell behind a four-capability promise | **Yes** — blocks enabling the nav entry |
| W-12 | Three contradictory approval counts for the approver | **Yes** |
| B-2 | Vendors and AI Systems unreachable from the nav | **Yes** for TPRM / AI-governance demos |
| B-4 | Executive nav entry unset on both app services | Superseded by W-3 |
| TR-2 | Non-admin served the org-wide SSO form incl. "disable password login" | **Yes** — server is safe, the impression is not |
| TR-3 | "1 brief in the archive" above a list of eleven | **Yes** |
| TR-6 | Nine-week gap under a "weekly" promise | **Verify in prod first** |
| RC-1 | Risk score = severity + 10; whole inventory collapses to 3 scores | No — but it blocks every intelligence item here |
| RC-2 | Findings never link to controls, obligations, or evidence | No — but it loses an audit-led evaluation |
| BR-1 | The Brief is one templated sentence, twelve times | **Yes** for a paid subscription |
| BR-2 | Six of twelve "developments this period" are 5–16 years old | **Yes** |
| EO-1 | Empty org opens on "Quiet since your last visit" | **Yes** — first sentence of the product |

Everything else is High or below and should not hold the beta.

---

## 5b. CORRECTIONS from EG2/Wave 1 release validation (2026-08-03)

Release validation established the **production** flag state this release
promotes, which differs from the staging configuration every walkthrough session
ran against. Three findings are therefore **staging-configuration artifacts, not
production defects**, and are withdrawn.

**Production app flag state at the release head** (`render.yaml` lines 1110–1272,
verified by line-bounded read): `RISK_WORKSPACE=true`, `DECISION_WORKSPACE=true`,
`DASHBOARD_BRIEFING=true`, **`ASSET_REGISTRY=false`**,
**`ENTERPRISE_CONTEXT=false`**, `FINDINGS_QUEUE_CONTROLS=false`.

Staging app runs all six `true`.

| Finding | Status | Why |
|---|---|---|
| **B-2** — "Vendors and AI Systems disappear from the navigation" | **WITHDRAWN for production** | `hiddenByFlag: "asset_registry"` only hides those children when `asset_registry` is **on**. Production runs it **off**, so the Assets group renders **[Vendors, AI Systems, Vendor Assurance]**. The finding is true on staging only. |
| **EC-1** — "Two registries describe the same objects" | **WITHDRAWN for production** | Asset Registry is hidden (flag off) and `/enterprise-context` is hidden (`enterprise_context=false`). Neither appears in the production nav; the duplication is not customer-visible. |
| **VA-1** — "Empty state directs to a page removed from the navigation" | **WITHDRAWN for production** | The dead end existed only because B-2 removed Vendors from the menu. On production Vendors is present, so the instruction resolves. |

**These remain valid for any environment running `asset_registry=true`** — i.e.
they return the moment EAR is promoted (Wave 2 or later). Retained here rather
than deleted, re-scoped to that promotion.

**Consequence for §6 planning:** B-2 was ranked #13 in the strategic re-ranking
and appeared in earlier pre-beta lists. It should be **removed from pre-beta
scope entirely** — there is nothing to fix in the configuration Private Beta will
run. The engineering estimate drops accordingly.

**Consequence for the review's method:** five walkthrough sessions validated a
navigation permutation production will not render. That is recorded as release
finding **RB-1** and is the reason the release is currently NO-GO.

---

## 6. Strategic re-ranking — what to build before Private Beta

Ranked 2026-08-03, after the walkthrough closed. **This section supersedes the
per-finding Priority fields for planning purposes.** Those were assigned as each
finding was discovered, in isolation, without effort estimates or knowledge of
what else was in the document. Several were wrong, and they are corrected below.

The ranking optimizes for **strongest possible first impression per unit of
engineering effort** — not for backlog completion, and not for severity.

---

### 7.0 The reframe that precedes every item below

Before ranking fixes, the more valuable question: **should Private Beta ship 20
destinations at all?**

Evidence from the walkthrough, on our own flagship validation tenant:

| Surface | State on the seeded tenant |
|---|---|
| `/policies` | 0 policies — empty |
| `/risks` | 0 risks — empty, and structurally cannot fill (W-9) |
| `/vendor-assurance/queue` | 0 documents, entry point unreachable (VA-1) |
| `/search` | works, blank page, no guidance (SR-1) |
| `/enterprise-context` | 3 entities, duplicates `/assets` (EC-1) |
| `/executive` | three "not enabled" notices (W-3) |
| `/ask` | fails on 100% of its own prompts (W-1) |
| `/approvals` | 0, and contradicts two other screens (W-12) |

**Eight of twenty destinations are empty, broken, duplicated, or contradictory.**
No amount of copy improvement fixes an empty room; it only furnishes it.

**Recommendation: ship Private Beta with roughly eight destinations, not twenty.**
Keep Briefing, Briefs, Operations Workspace, Finding Explorer, Assets, Controls,
Posture, Audit Log. Flag the rest dark for beta — the code stays, the routes keep
working for anyone who has a link, and the nav stops advertising rooms we have
not furnished.

This single decision resolves or moots **W-1, W-3, W-12, RG-1, SR-1, VA-1, VA-2,
EC-1, EC-2, EC-3, FW-1** — eleven findings — for close to zero engineering cost,
and it makes the product feel *deliberate* rather than *broad*. A tight product
that does eight things well reads as more mature than a wide one with eight
empty rooms. Incumbents win on breadth; we cannot out-breadth Archer and should
not try.

**This is the highest-ROI action in this entire document, and it is a product
decision, not an engineering task.**

---

### 7.1 The bundles — where one implementation solves many problems

Ranked by customer value per unit of effort. Effort is engineering-days, rough.

#### Bundle 1 — "Scope the beta" · Effort: ~1 day · Resolves 11 findings
Flag the eight unready destinations dark (§6.0). Decide, don't build.
- **Customer impact:** High · **Trust:** High · **Differentiation:** Medium
  (deliberateness reads as maturity) · **Beta necessity:** Yes

#### Bundle 2 — "Propagate the patterns we already built" · Effort: ~3 days · Resolves 6
Five of the most trust-building behaviors in the product each exist in exactly
one place (§3f table). Apply each at its other call sites:
- `?reason=` + destination preservation → role denials and missing records (**ER-1**, resolves **TR-1**)
- `hasPlatformData` → all 9 Briefing modules, starting with the first (**EO-1**, materially improves **W-2**)
- the overlap disclaimer → `/actions` (**AC-1**)
- the "Decision → create a finding" bridge → terminal surfaces (**BR-5** as template)
- **Customer impact:** High · **Trust:** Very high · **Effort:** Very low ·
  **Beta necessity:** Yes
- **Why it ranks second:** no new concepts, no new components, no design
  decisions to litigate. Someone already made the right call; it was not
  propagated. This is the cheapest trust in the document.

#### Bundle 3 — "The Brief becomes proof of the platform" · Effort: ~5 days · Resolves 6
- **BR-3** — sort by inventory match, label "Affects your environment." *One sort
  and one label over data we already use elsewhere.*
- **BR-2** — filter on KEV *addition* date, not KEV membership.
- **BR-1** — one real analysis for the matched item; the rest as a compact table.
- **TR-3** — one count that describes what is listed.
- **TR-4** — delete the word "Legacy."
- **Customer impact:** Very high · **Trust:** Very high ·
  **Differentiation:** **Highest in the document** · **Beta necessity:** Yes
- **Why:** the Brief is the wedge, the free-tier first impression, and the only
  artifact a prospect sees before signing anything. BR-3 alone converts it from a
  KEV mailing list into visible proof of the signal→inventory capability that EG3
  classes as Class A.

#### Bundle 4 — "Give the risk score resolution" · Effort: ~8 days · Resolves 5
**RC-1.** Add one differentiating input — asset criticality, already in the
registry — and surface it in the existing derivation explainer.
- Unblocks **B-1** (ranked "what needs your judgment today"), **W-8** (a "start
  here" queue), **W-9** (heatmap promotion candidates), **W-7** (a path off a
  posture score).
- **Customer impact:** High · **Differentiation:** Very high ·
  **Strategic importance:** **Highest in the document** · **Beta necessity:**
  **Judgment call — see §6.3**
- **Why it ranks below the Brief despite higher strategic importance:** it is
  three to four times the effort and its payoff is invisible until the dependent
  UI work also lands. The Brief bundle produces a visible, demonstrable
  difference in week one.

#### Bundle 5 — "Stop describing our internals as the customer's situation" · Effort: ~3 days · Resolves 6
One display-translation layer plus a copy pass:
- **W-4** — separate *not in your plan* / *not yet configured* / *not yet released*
- **W-5** — per-page titles (every tab, bookmark and screenshot currently reads "Intelligence Brief")
- **TR-9 / W-10 / VA-2** — one enum→label map; retire "partially_implemented",
  "Backing: enterprise entities", "Finalized (legacy)"
- **W-6** — gate the change-orientation panel on prior activity, not on the flag
- **Customer impact:** Medium · **Trust:** High · **Effort:** Low ·
  **Beta necessity:** Yes
- **W-6 rises specifically for beta:** every beta user is first-time by
  definition, so a panel written for returning users misfires 100% of the time.

#### Bundle 6 — "Close the security-perception gap" · Effort: ~1 day · Resolves 2
- **TR-2** — role-gate the SSO page and correct its `access` metadata. The server
  is already correct; the page and the knowledge index are not.
- **B-2** — restore "Vendors" and "AI Systems" as nav entries deep-linking into
  the registry's existing type filters.
- **Customer impact:** High · **Trust:** Very high · **Effort:** Very low ·
  **Beta necessity:** Yes
- **Why TR-2 outranks its severity:** it is the finding a POC security reviewer
  is most likely to find and least likely to forgive, and it costs one guard
  clause. **B-2** is the difference between being able and unable to demo TPRM
  and AI governance from the menu.

---

### 7.2 The twelve items to complete before Private Beta

| # | Item | Bundle | Effort | Why it's here |
|---|---|---|---|---|
| 1 | Flag 8 unready destinations dark | 1 | 1d | Removes 11 findings; makes the product read as deliberate |
| 2 | Remove `/ask` from the product for beta (**W-1**) | 1 | 0.5d | A visibly failing AI feature costs the credibility of every number on the platform |
| 3 | Keep `/executive` dark (**W-3**) | 1 | 0d | A four-capability headline over three "not enabled" notices is worse than absence |
| 4 | Brief: sort + label by inventory match (**BR-3**) | 3 | 2d | Highest differentiation-per-effort in the document |
| 5 | Brief: filter on KEV addition date (**BR-2**) | 3 | 1d | A 2010 CVE as "this week" ends evaluations |
| 6 | `hasPlatformData` on all 9 Briefing modules (**EO-1**) | 2 | 1d | The first sentence of the product for every beta customer |
| 7 | `?reason=` for denials and missing records (**ER-1/TR-1**) | 2 | 1d | Extends a mechanism that already exists and works |
| 8 | Role-gate the SSO page (**TR-2**) | 6 | 0.5d | One guard clause; the finding a security reviewer won't forgive |
| 9 | Restore Vendors / AI Systems to the nav (**B-2**) | 6 | 1d | Without it, two core domains cannot be demoed |
| 10 | Per-page titles (**W-5**) | 5 | 0.5d | Every screenshot currently brands the platform as the newsletter |
| 11 | Brief archive count + drop "Legacy" (**TR-3/TR-4**) | 3 | 0.5d | Miscounting eleven briefs makes 550 findings suspect |
| 12 | One canonical "decisions awaiting you" count (**W-12**) | — | 2d | Three contradictory answers in the one workflow whose value is defensibility |

**Total ≈ 11 engineering-days.** Everything above is either a decision, a string,
a guard clause, or a sort. None of it requires new architecture.

**Two additions if capacity allows (≈ 11 more days):**
- **RC-1** (Bundle 4) — the strategically most important item in the document.
- **RC-2/QU-2** — propagate accepted signal→control links onto derived findings;
  unblocks **TR-8**, **TR-10**, **FW-1** and the audit-defensibility story.

---

### 7.3 Challenging my own prioritization

**Items I over-rated when I found them:**

| Finding | Was | Should be | Why |
|---|---|---|---|
| **TR-5** (brief dates off by one) | High | **Medium** | A one-day label/title mismatch is real but will not change a purchase decision. It matters only as part of the count-integrity cluster. |
| **RC-3** (conflicting severities on duplicates) | High | **Medium** | Affects 3 groups out of ~291 titles. Genuinely wrong, tiny surface. Fix it with Bundle 3, not before. |
| **FW-1** (framework at 0%) | High | **Low for beta** | Downstream of thin framework content (EG3 Class C/D). Cannot be fixed with copy; needs a content investment far beyond beta scope. |
| **W-13** (approver's work zoned as org-wide) | Medium | **Low** | Real, but nobody abandons an evaluation over zone placement. |
| **EC-2** (undefined "Confidence: high") | Medium | **Low alone** | Technically interesting, no adoption impact in isolation. Only worth doing inside the explainability story. |

**Items that should be deferred until after customer feedback:**
- **B-5 / W-11** (reconcile the five-domain taxonomy across marketing and app) —
  strategically real, but it is a naming decision that can consume weeks of
  debate for modest adoption effect. Beta customers will tell us which nouns they
  use. **Let them.**
- **B-3 / B-7** (rename Operations Workspace / Finding Explorer / Briefing) — I
  proposed specific names. Beta usage is cheaper and better evidence than my
  guess. Ship, watch, rename once.
- **EC-3** (multi-entity hierarchy at Fortune 500 scale) — a validation task, not
  a build task. Find out whether a beta customer even attempts it.
- **W-9** (heatmap promotion candidates) — depends on RC-1. Do not attempt first.
- **TR-6** (nine-week archive gap) — **verify in production before building
  anything.** May be a staging artifact entirely.

**Items that are technically interesting and unlikely to influence adoption:**
`SR-1` (search examples), `RG-1` (risk register empty state), `AC-1` (overlap
disclaimer), `VA-2` ("Finalized (legacy)"), `EC-2`. Each is correct. **None will
change a single buying decision on its own.** They are worth doing only because
Bundle 2 and Bundle 5 make them nearly free as a group — never as standalone
tickets.

---

### 7.4 Where this backlog still thinks like a software team

Asked to critique its own framing, six gaps:

1. **It is indexed by defect, not by the buying journey.** Fifty-two findings
   organized by screen and root cause. No product company plans a beta without
   naming the five moments in the first thirty minutes that decide the deal, then
   working backwards. That map does not exist in this document, and it should
   drive everything above.

2. **It has no idea who the beta customers are.** Every finding is written for a
   generic "Fortune 500 evaluator" I invented. The ranking changes materially if
   the ten beta orgs are CISOs (lead with Bundle 4) versus GRC managers (lead with
   Bundle 3) versus TPRM analysts (lead with B-2 and vendor workflows).
   **This is the single largest unknown in the plan and it is a question for the
   operator, not for engineering.**

3. **Nothing here is measurable.** Not one finding carries a success metric.
   "Increases confidence" is unfalsifiable. A product company would instrument
   the beta first: time to first governance decision, % of orgs that assign an
   owner in week one, % that promote a risk, Brief open and click-through, the
   number of sessions that end on a queue with no action taken. **Without
   instrumentation the beta yields opinions, not evidence** — and every deferral
   above ("let customers tell us") assumes we will be able to hear them.

4. **It treats removal as a last resort.** I recommended removing `/ask`
   reluctantly and only after establishing it was broken. §6.0 should have been
   the *first* section of this document, not one written at the end. The instinct
   throughout was to improve what exists rather than to ask what should exist —
   the definition of thinking like a software team.

5. **It has no cost-of-delay reasoning.** Findings were ranked by severity, not by
   what it costs to learn them late. Some are cheap to fix after feedback. Others
   **poison the feedback itself**: a customer who sees a 2010 CVE presented as
   this week's intelligence stops giving useful feedback about anything else.
   BR-2 is not urgent because it is severe; it is urgent because it corrupts the
   beta's only output.

6. **No release sequencing.** Nothing distinguishes what must be true before
   customer #1 logs in from what can land between customer #3 and #10. A beta is
   a sequence of first impressions, not a single one.

**The honest summary:** this document is a very good engineering audit and an
incomplete product plan. It says what is wrong with high confidence and real
evidence. It does not yet say who we are selling to, what we will measure, or
what we will refuse to ship — and the third of those turned out to be worth more
than the fifty-two fixes it catalogues.

---

## 7. Change log

| Date | Change |
|---|---|
| 2026-08-03 | **Strategic re-ranking (§6).** Re-scored all 52 findings for value-per-effort; grouped into 6 bundles; named the 12 pre-beta items (~11 eng-days); downgraded 5 of my own priorities; deferred 5 pending customer evidence; added the self-critique of where the backlog thinks like a software team. Headline: scope the beta to ~8 destinations. |
| 2026-08-03 | Opened. Baseline IA resolved from `render.yaml` + `navigation.ts`. Seeded B-1…B-7 from code-verified evidence, pre-walkthrough. |
| 2026-08-03 | **Session 1 walkthrough** — authenticated staging walk of `/dashboard`, `/executive`, `/findings`, `/posture`, `/assets`, `/approvals`, `/ask`. Added W-1…W-14, themes T5–T7, strengths register, release-blocker summary. Resolved B-4 and B-6 against live evidence. |
| 2026-08-03 | **Session 5 — closing the gaps.** Walked `/enterprise-context` and the failure paths (expired session, bad credentials, missing record, role denial); verified the empty-org path in code. Added §3f (ER-1, EO-1, EC-1…EC-3) and the "right pattern applied once" table. ER-1 supersedes TR-1's remedy. One new release blocker. **All nav destinations now walked.** |
| 2026-08-03 | **Session 4 — the wedge product + remaining surfaces.** Walked the current Brief and a full-analysis page, `/queue`, `/frameworks`, `/obligations`, `/policies`, `/risks`, `/actions`, `/vendor-assurance/queue`, `/search`. Added §3e (BR-1…BR-5, QU-1, QU-2, FW-1, RG-1, VA-1, VA-2, AC-1, SR-1). Two new release blockers in the revenue product. QU-2 refines RC-2's remedy. |
| 2026-08-03 | **Session 3 — Root-cause analysis.** Traced a finding through UI + API; measured 300 unique findings of 551. Added §3d (RC-1…RC-3), theme T8, and the finding-detail strengths register. Reclassified B-1/W-7/W-8/W-9 as symptoms of RC-1. Corrected an overestimate of duplication (3%, not widespread). |
| 2026-08-03 | **Session 2 — Enterprise Trust Review.** Walked `/briefs`, `/controls`, `/evidence`, `/getting-started`, `/settings/sso`, `/settings/security`, `/audit-log` and an invalid URL, as **both** the admin approver and the member analyst. Added §3c with TR-1…TR-10, the trust-theme table, and the root trust pattern. Three new release blockers. |

---

## 8. Code-verified finding, 2026-08-21 reconciliation

### NAV-1 — The approver queue is nav-orphaned in the navigation model production runs

**Severity: release blocker for the exception workflow. Effort: XS.**

`app/src/lib/navigation.ts` carries two navigation models, selected by
`RISK_WORKSPACE_ENABLED`. **Production runs the legacy `NAV_ITEMS`** (the flag is
`false` on the production app; `true` on staging).

`/approvals` — the page that renders `RiskAcceptanceApprovals`, the org-wide
queue of pending risk acceptances awaiting an approver — is declared **only in
`WORKSPACE_NAV_ITEMS`**, inside the "Risk Operations" group. The legacy model's
"Risk" group contains Findings, Actions and Risk Register, and no Approvals.

**The consequence.** In production, an approver has no navigation path to the
queue of decisions awaiting them. They can reach a proposal only by typing the
URL or being sent one. `LAUNCH_READINESS.md` flagged the missing approver queue
as a CX gap in July; the queue was subsequently built — and then landed in the
half of the nav production does not render.

**Why this is the same defect BL-4 already fixed once.** Vendor Assurance had
exactly this shape: a first-class workspace declared only in
`WORKSPACE_NAV_ITEMS`, live in the engine, unreachable in production's menu. The
BL-4 ruling declared it in **both** models so it survives either flag state. The
comment recording that ruling sits fifteen lines above the group that still omits
Approvals.

**Compounding it:** `SECURELOGIC_RISK_ACCEPTANCE_ENABLED` is **undeclared in the
production engine block** of `render.yaml` (it is `true` on staging). It is off,
which is correct, but nothing in IaC says so — the same invisible-flag defect
REPORT-1 found and fixed for `SECURELOGIC_RISK_INTELLIGENCE_ENABLED`. An
undeclared flag is invisible to the operator as well as to the customer.

**Remedy.** Declare `/approvals` in both nav models, pin it with a render test,
and declare the flag explicitly in the production block with a comment saying why
it is off. Tracked as **P1-B / P1-C** in
`docs/launch/SEPT15-LAUNCH-RECONCILIATION.md` §9.

**Evidence:** `app/src/lib/navigation.ts` (legacy `NAV_ITEMS` "Risk" group vs
`WORKSPACE_NAV_ITEMS` "Risk Operations" group), `app/src/app/approvals/page.tsx`,
`render.yaml` production engine block. Verified on `develop@4fe16808`.

| Date | Change |
|---|---|
| 2026-08-21 | **§8 opened.** NAV-1 added from the Sept 15 program reconciliation — code-verified, not walked. Note that §7's Session 1 walked `/approvals` successfully **on staging**, where `RISK_WORKSPACE_ENABLED` is `true`; that walkthrough could not have surfaced this, because the defect exists only in the production nav model. |
