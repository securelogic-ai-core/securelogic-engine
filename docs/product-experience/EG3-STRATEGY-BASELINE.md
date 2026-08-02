# EG3 Strategy Baseline — Enterprise Replacement Analysis

- **Status:** DRAFT — presented for review 2026-08-02. Not yet ratified.
- **Supersedes:** nothing. Extends the EG2 Product Experience Report and the
  2026-07-30 enterprise value assessment.
- **Scope:** product strategy for the phase following EG2. Governs what we build
  next and, equally, what we decline to build.
- **Premise:** SecureLogic AI is competing for Fortune 100 replacement deals
  against ServiceNow GRC, Archer, AuditBoard, OneTrust, Drata, Vanta,
  SecurityScorecard, and BitSight — not against startups.

---

## 1. Method and evidence boundaries

This baseline was produced by a code-level audit, not a live walkthrough:
112 app routes enumerated, both navigation models parsed, all 27 engine flags and
6 app flags diffed production-vs-staging, and capability presence/absence
established by direct file inspection.

**What this analysis could not verify.** No running instance was available
(staging tracks `develop`, which lacks the current release branch). Findings
about *visible* behavior are therefore inferred from flag values and render
paths, not observed. Framework and requirement depth is seeded from a source
database not reachable from the repository; the in-repo catalogs are stubs
(`src/frameworks/catalog/securelogic_full.json` holds 4 controls) and the depth
claim below relies on the prior assessment's measurement. Our own SOC 2 status,
penetration-test posture, uptime SLA, and contractual exit terms are not
represented in the repository at all.

---

## 2. The strategic finding

**SecureLogic's problem is not missing capability. It is that a very large amount
of enterprise-grade capability is built, unvalidated, and dark — and therefore
worth exactly zero in a deal.**

Production runs 3 of 27 engine flags and 0 of 6 app flags. Staging runs 13 and 6.

Sitting dark: 18 cloud and security connector adapters (2,173 LOC in
`src/api/lib/connectors/` — AWS, Azure, GCP, CrowdStrike, Microsoft Defender,
Qualys, Tenable, Rapid7, Wiz, Jamf, Okta, Google Workspace, GitHub, ServiceNow
CMDB, Microsoft Graph), ServiceNow and Jira execution
(`src/api/lib/orchestrationExecutors.ts:74,91`), a knowledge graph, predictive
forecasting, a complete executive dashboard, orchestration playbooks, the
enterprise context layer, and the entire EG2 trust-and-wiring cycle.

`app/src/app/dashboard/page.tsx:69` is the sharpest instance: with
`SECURELOGIC_DASHBOARD_BRIEFING_ENABLED` false, production renders "the legacy
dashboard byte-for-byte." EG2's most competitively distinctive output — the
"Since Your Last Visit" delta — does not exist for customers.

A Fortune 100 evaluator cannot buy what they cannot see, and we cannot honestly
sell what we have never validated. **The highest-return work available is not
building; it is validating and lighting up what exists.**

Second finding: **we are attempting to replace eight companies across four
categories.** Some of those we should never attempt.

### 2.1 The decision thesis — the permanent product philosophy

This is not a property of any release, wave, or capability. It is the standing
gate every implementation must pass before it is built:

> **What customer decision becomes faster, more confident, and more defensible
> because of this capability?**

All three clauses are required. A capability that makes a decision faster but
less defensible is not an improvement; one that improves confidence without
changing any decision is decoration. A capability that cannot answer the
question is not ready to build, regardless of how strategically attractive it is
or how complete its engineering.

This is what "system of intelligence, not system of record" means in practice.
Incumbents optimize for completeness of the record; we optimize for the quality
of the next decision. Every item in the roadmap below is subject to this gate,
and it supersedes any framing that treats decision intelligence as the
deliverable of one particular release.

---

## 3. Capability classification

**A** = better than incumbents · **B** = equal · **C** = noticeably behind ·
**D** = missing entirely

| Capability | Class | Why they replace / Why they refuse |
|---|---|---|
| External intel → your inventory, with provenance | **A** | Nobody deterministically maps signals to *your* vendors, AI systems, and controls and shows the work. Refuse: visible only inside the Brief. |
| Deterministic, audit-defensible computation | **A** | Every number reproducible while rivals hide LLM guesses behind confident UI. Refuse: never marketed, so it reads as absence of AI rather than a stance. |
| Change-delta awareness | **A** | Genuinely rare. Refuse: dark in production. |
| GRC workflow (findings, risks, actions, approvals, SLA, independent review) | **B** | Credible parity with AuditBoard/Archer. Refuse: no bulk operations, no comments. |
| Executive reporting (deterministic narrative, exec PDF, 11 export routes) | **B** | Strong. Refuse: the executive dashboard is dark to 100% of users. |
| SSO — SAML 2.0 (`src/api/routes/sso.ts`) | **B** | Real and working. Refuse: **no SCIM**, so no automated deprovisioning. |
| Multi-entity hierarchy (`business_unit`, `department`, `region`) | **C** | Exists via the Enterprise Context Layer. Refuse: dark in production, never load-tested; Fortune 100 org structures are punishing. |
| Cloud/security connectors (18 adapters) | **C in practice** | Should be B+. Refuse: dark, triple-fenced, no evidence any adapter has run against a real tenant. |
| ITSM sync (ServiceNow, Jira) | **C in practice** | Built. Refuse: gated behind *autonomous operations* — the most alarming possible packaging for a conservative buyer. |
| Notifications | **C** | Email only; both alert flags off in production *and* staging. No in-app inbox. |
| RBAC | **C** | Five fixed roles (`admin`, `owner`, `viewer`, `analyst`, `member`); no custom roles, no field-level scoping. |
| Framework and control content depth | **C/D** | In-repo catalogs are stubs; prior measurement found shallow content. AuditBoard and Archer sell content libraries as the product. |
| AI governance | **C today / A potential** | Inventory and AI RMF exist; content thin. OneTrust is the only serious competitor and everyone is early. |
| Continuous control monitoring | **D** | Vanta and Drata *are* this. We have the connectors and not the loop. |
| TPRM questionnaires + vendor portal | **D** | Blocks ProcessUnity / Prevalent / OneTrust replacement outright. |
| Crosswalks | **D** | `frameworks/crosswalks/*.json` exist but hold 1–2 entries each and **no code loads them**. |
| Collaboration | **D** | Decision reasoning lives in Slack — outside the audit trail we claim as our strength. |
| Bulk operations | **D** | — |
| Auditor role / read-only audit access | **D** | `app/src/app/audit-log/page.tsx:25` is admin-only; no auditor role exists. |
| SCIM provisioning | **D** | Enterprise security-review blocker. |
| EU data residency | **D** | `render.yaml` is US-only (virginia / oregon). |
| External attack-surface ratings | **D** | The SecurityScorecard / BitSight category. **We should not build this.** |

---

## 4. The five questions

### 4.1 Which missing capabilities actually lose deals?

- **TPRM questionnaire + vendor portal.** Without it the VP TPRM cannot do their
  job here; the incumbent stays and we become a point tool.
- **Auditor role.** We fail the buyer's own segregation-of-duties control during
  evaluation — a finding written about us, in their assessment, by the persona we
  most need as a champion.
- **SCIM.** "How do you deprovision a terminated employee?" appears on every
  enterprise security questionnaire. "Manually" ends the conversation.
- **EU data residency.** A binary disqualifier for any Fortune 100 with EU
  operations. Not satisfiable by a roadmap promise.
- **Continuous control monitoring, actually enabled.** Against Vanta and Drata,
  manual attestation loses on sight.
- **Framework content depth.** A thin catalog reads as an empty product
  regardless of engine quality.
- **Our own SOC 2 report.** Unverifiable from the repository and a hard gate. If
  absent, it outranks everything else in this document.

### 4.2 Which merely create friction?

Bulk operations, command palette, notification bell, navigation orphans, the
two-IA split, collaboration. These make us feel immature and cost us on delight;
they do not on their own lose a deal to Archer.

*The prior EG3 UX review placed the command palette in Private Beta. Under a
replacement lens that was wrong, and it moves later. Bulk operations stay, on
pilot usability grounds.*

### 4.3 What is overbuilt relative to customer value?

**Autonomous operations, orchestration playbooks, predictive intelligence, and
the standalone knowledge graph.** All dark, all unvalidated, all solving problems
a Fortune 100 buyer does not have yet. Conservative buyers actively distrust
autonomous remediation from a newer vendor; leading with it damages credibility.

The knowledge graph is the strongest of the four and should be reframed as
*nth-party concentration risk* — a real TPRM question — rather than a graph
feature. The rest is sunk cost and should be parked, not finished.

### 4.4 What is dramatically underbuilt?

Framework and control content, crosswalks, the TPRM questionnaire loop, AI
governance depth, and continuous control monitoring.

Note the pattern: **four of five are content and workflow problems, not
engineering problems.** The engineering foundation is ahead of the product
content, which is precisely why the platform feels thinner than its codebase.

### 4.5 What should become signature differentiators?

1. **Intelligence → your inventory, with provenance.** The moat.
2. **Determinism as a product promise.** "Every number defensible in an audit;
   AI only where judgment improves." A wedge as competitors bolt on LLM guessing
   — but only if we say it out loud.
3. **AI governance done seriously.** The one category with no entrenched
   incumbent and a running regulatory clock.
4. **Change-delta awareness.** Cheap for us, structurally awkward for incumbents
   built on point-in-time assessment.

**Anti-goal: do not build external security ratings.** SecurityScorecard and
BitSight own a data-collection moat — internet-wide scanning infrastructure and
years of history. We would spend years shipping something worse. Integrate their
scores as a signal source. Deciding not to compete here matters as much as any
build decision in this document.

---

## 5. The roadmap — three tracks

### Track A — Private Beta Readiness

*Gate: a reference customer can run their real program without hitting a wall or
a broken promise.*

| # | Item | Customer problem | Persona | Competitive impact | Revenue impact | Effort | Depends on | Sequence |
|---|---|---|---|---|---|---|---|---|
| A1 | Flag train promotion + staging validation — **SPLIT INTO THREE WAVES, see §5.1** | Customers cannot see what we built | All | Converts 13 EG2 slices from invisible to visible | Unblocks every deal | S (operator) per wave | ADR-0007 validation | **First — everything follows** |
| A2 | Auditor role (read-only) | CAE needs audit access without admin rights | CAE, external auditor | Parity with AuditBoard | Unblocks a persona | S–M | Security + isolation pass | After A1 |
| A3 | SCIM provisioning | Automated deprovisioning | CISO, IT | Security-review gate | Removes a hard blocker | M | Existing SAML | Parallel with A2 |
| A4 | Our own SOC 2 + pen-test evidence | "Show us yours" | Procurement | Table stakes | Hard gate | ? | — | **Verify immediately** |
| A5 | Single information architecture | Four shipped surfaces unreachable in prod | All | Removes the "unfinished" signal | Indirect | S | A1 | After A1 |
| A6 | Bulk operations | 200-finding triage, one at a time | Analyst | Parity | Pilot retention | M | A1 | After A1 |
| A7 | Executive dashboard live | Executive surface invisible to everyone | Executive, CISO | Demo-critical | High | S (validation) | A1 | After A1 |
| A8 | Framework content depth | Thin catalog reads as an empty product | CISO, CAE | Parity gate | Direct | L (content) | — | **Start now; runs long** |

**A2 is smaller than first estimated.** `users.role` carries no CHECK constraint
in any migration, role enforcement is centralized in
`src/api/middleware/requireRole.ts`, and only 12 route files are admin-gated —
so this is one middleware change plus ~12 gate decisions and an app-side page
gate. No migration required.

**A8 should start immediately** despite being Track A's longest item: it is
content acquisition rather than engineering, so it parallelizes with everything
and gates nothing until B6.

#### 5.1 A1 is split into three waves

A1 as originally written bundled ~16 already-built capabilities into one
irreversible customer-facing event, and collided with four gates recorded in
`render.yaml` by people who understood the risk better than a promotion
checklist does. Approved split:

**Wave 1 — Reveal.** `DASHBOARD_BRIEFING` (engine + app), `RISK_WORKSPACE`,
`DECISION_WORKSPACE` (engine + app), `VENDOR_ASSURANCE`. Additive only: no API
that returns 200 today changes. Delivers the reachable-surfaces and
change-delta outcomes. Ships with a customer-facing orientation surface — an
unexplained navigation change reads as instability even when every change is an
improvement.

**Wave 2 — Workflow.** `RISK_ACCEPTANCE` + notifications,
`FINDINGS_QUEUE_CONTROLS`, `BRIEF_QUALITY` (after its staging validation),
`BRIEF_CATCHUP`. New capability, opt-in in character. Ships after Wave 1 is
stable. **Per-organization rollout (§5.2) is mandatory before this wave.**

**Wave 3 — Gated. NOT part of Private Beta Readiness.**
`FINDING_CLOSURE_GATE` is a breaking API change — `PATCH /api/findings/:id`
returns 409 where it returned 200, and its own header requires an inventory of
affected clients that does not exist. `ENTERPRISE_CONTEXT` + `ASSET_REGISTRY`
must flip together and are blocked on the AD-17 grant, the edge cap (H1), and
the graph load test (H2). **These are preconditions, not schedule items.**
Promoting them to satisfy a checklist would override rulings made with more
context than the checklist has.

#### 5.2 Per-organization rollout is foundational architecture

Elevated out of roadmap sequencing. Feature flags today resolve from
`process.env` at SERVICE scope (`app/src/app/layout.tsx`), so every promotion is
all-or-nothing for 100% of an environment: no canary, no design-partner cohort,
no per-customer enablement. `organizations.core_platform_capability` is a
per-org grant but gates ENTITLEMENT in the engine only — it is not a
feature-flag mechanism.

**What it unlocks:** design partners · canary releases · beta cohorts · premium
capabilities · customer-specific enablement · controlled enterprise rollout.

**Design constraints:** one canonical resolver; env value as the default with a
per-org override on top; fail-closed on lookup failure; grants are org-scoped
data and therefore a tenant-isolation surface; every grant change audited.
**Warrants an ADR before implementation.**

**Sequencing:** Wave 1 ships globally without it (additive-only, low blast
radius). It is a separate architectural initiative — ADR, architecture, rollout
model, feature-resolution strategy, audit considerations, implementation roadmap
— and implementation begins after Wave 1 stabilizes. It is MANDATORY before
Wave 2.

#### 5.3 Product communication becomes a platform capability

Wave 1 ships a deliberately minimal orientation surface (release notes, "why
this changed", dismiss / show later) reusing the existing per-user banner
mechanism. It is **not** an onboarding system and must not grow into one by
accretion.

Product communication — in-product announcements, targeted release notes,
capability discovery, per-cohort messaging — is recorded here as a future
platform capability. It is naturally downstream of §5.2: announcing a change to
the customers who actually received it requires per-org resolution. Not scoped,
not scheduled, not part of Wave 1.

### Track B — Enterprise Replacement

*Gate: we can displace a named incumbent rather than sit beside it.*

| # | Item | Customer problem | Persona | Competitive impact | Revenue impact | Effort | Depends on | Sequence |
|---|---|---|---|---|---|---|---|---|
| B1 | Continuous control monitoring loop | Evidence collected, not attested | CISO, CAE | Beats Vanta/Drata on depth | Very high | L | A1, B2 | After B2 |
| B2 | Connector validation + productization | 18 adapters never proven against a real tenant | CISO | Converts sunk cost into capability | Very high | M–L | A1 | **Precedes B1** |
| B3 | TPRM questionnaire + vendor portal | The core TPRM loop is absent | VP TPRM, Procurement | Replaces ProcessUnity / Prevalent | Very high | L | New ADR (external trust boundary) | Independent |
| B4 | ITSM sync, repackaged | Remediation lives in Jira / ServiceNow | Analyst, CISO | Parity | High | M | Decouple from the autonomous-ops flag | After A1 |
| B5 | EU data residency | EU Fortune 100 disqualifier | Procurement | Binary gate | Gates an entire region | L (architectural) | — | Before EU pursuit |
| B6 | Crosswalks, wired | Each framework assessed from zero | CISO, CAE | Vanta/Drata's growth engine | High | L | A8 | **After A8** |
| B7 | In-app notifications | No "what needs me today" | All | Parity | Medium | M | A1 | Independent |
| B8 | Audit-grade collaboration | Decision reasoning sits outside the audit trail | CRO, Analyst | Parity, with our twist | Medium-high | L | A2 | After A2 |

**B4 is mostly a repackaging decision, not a build.** The ServiceNow and Jira
executors exist; they are gated behind autonomous operations. Separating "sync a
ticket" from "act autonomously" converts a frightening dark feature into a parity
checkbox for modest effort — the highest ratio in Track B.

### Track C — Category Leadership

| # | Item | Customer problem | Persona | Competitive impact | Revenue impact | Effort | Depends on | Sequence |
|---|---|---|---|---|---|---|---|---|
| C1 | Intelligence → inventory as a first-class surface | The moat is trapped inside the Brief | CISO, VP TPRM | Nobody delivers this | Differentiator | M | A1 | First in C |
| C2 | AI governance depth (EU AI Act, ISO 42001) | Thin content in an open category | CISO, Legal | No entrenched incumbent | High, clock-sensitive | **S–M skeleton now; L library after validation** | Existing AI inventory (skeleton); A8 (library) | Skeleton early; library only on evidence — see §6.1 |
| C3 | Determinism as a stated promise | Our strongest property is unmarketed | All | Wedge as rivals bolt on LLMs | Indirect, compounding | S | — | Anytime |
| C4 | Nth-party concentration risk | Reframes the knowledge graph as a real question | VP TPRM, CRO | Weak across the field | Medium-high | M | Graph validation | After B3 |
| C5 | Change-delta everywhere | Extends EG2's best idea platform-wide | All | Structurally hard for incumbents | Medium | M | A1 | After A1 |

### Parked — build nothing further

Autonomous operations, orchestration playbooks, predictive intelligence, the
standalone knowledge graph, trust center, external security ratings. Keep the
code; stop investing. Revisit only on demonstrated customer pull.

---

## 6. Product Assumptions to Validate During Private Beta

**The purpose of Private Beta is to reduce uncertainty, not to find bugs.** Every
initiative below rests on an assumption. Some assumptions are safe enough to
build against immediately; several are large, expensive, and unproven — and two
of the three largest investments in this document (B1 and B3) rest entirely on
assumptions no customer has yet confirmed.

**Classification key**

- **Build Now** — uncertainty is low or the item is a known gate; validation
  would delay without informing.
- **Validate First** — the investment is large enough that being wrong is
  expensive; learn before building.
- **Customer-Driven** — build only when a specific customer need makes it real.
- **Strategic Bet** — deliberately accept unresolved uncertainty for strategic
  position; make the bet consciously and size it.

### Track A

| # | Item | Class | Assumption | How we validate | Confirms it | Invalidates it | Build before or after? |
|---|---|---|---|---|---|---|---|
| A1 | Flag train | **Build Now** | The staging feature set is what customers should have | Staging validation checkpoints, then production monitoring | Error rates and latency hold at parity; no support spike | Regressions or load failures on promotion | Before — this is conversion of finished work |
| A2 | Auditor role | **Build Now** | CAEs need read-only audit access without admin rights | Ask every beta customer's audit function directly | They name it unprompted, or refuse admin-for-auditor | Nobody involves an auditor during beta | Before — a known gate |
| A3 | SCIM | **Build Now** | Enterprise IT requires automated deprovisioning | Security-questionnaire responses from beta customers | Appears on their questionnaire (it will) | No customer raises it across the cohort | Before — a known gate |
| A4 | SOC 2 / pen test | **Build Now** | Procurement requires our own attestation | Procurement conversations | Requested in the first review | Never requested | Before — a hard gate |
| A5 | Single IA | **Build Now** | One navigation model beats two | Task-completion observation in beta | Users find orphaned surfaces without help | Users navigate fine and never reach them (would indicate the surfaces are unwanted, not that the IA is fine) | Before |
| A6 | Bulk operations | **Build Now** | Analysts triage in batches | Watch a real triage session | Analysts batch-select, or complain about repetition | Beta findings volume is low enough that per-item is fine | Before — low uncertainty |
| A7 | Executive dashboard | **Validate First** | The dashboard we built is the one executives want | Show the existing surface to real executives before investing further | Executives navigate to it unprompted and act on it | They ask for something structurally different, or prefer the PDF | **Promote the flag, then validate before extending it** |
| A8 | Framework content | **Validate First** | Customers need *depth*, and we know *which* frameworks | Ask each beta customer which frameworks they are assessed against | A small set recurs across the cohort | Every customer names a different framework — implies a content *pipeline*, not a library | **Validate which, then build depth. Do not buy breadth blindly.** |

### Track B

| # | Item | Class | Assumption | How we validate | Confirms it | Invalidates it | Build before or after? |
|---|---|---|---|---|---|---|---|
| B1 | Continuous control monitoring | **Validate First** | Customers will connect production cloud accounts to a newer vendor, and prefer collected evidence to attestation | B2 validates the grant; beta usage validates the preference | A beta customer grants production read access and acts on collected evidence | Security review stalls, or they will only connect non-production | **After B2. Do not build the loop before proving the grant is obtainable.** |
| B2 | Connector validation | **Validate First** | The 18 adapters work against real tenants and customers will authorize them | Run each adapter against a consenting beta tenant | Adapters return correct inventory without rework | Adapters need substantial repair, or no customer authorizes | Before B1 — this is the cheapest way to de-risk the largest bet |
| B3 | TPRM questionnaire + portal | **Validate First** | Customers will run vendor campaigns *in our platform* rather than their incumbent | Ask beta customers to describe their current campaign process and what would move it | They express willingness to move a real campaign | They keep campaigns in the incumbent and want only the results imported — implying *integration*, not replacement | **Validate before building. This is an L investment on an unproven premise.** |
| B4 | ITSM repackaging | **Build Now** | Customers want ticket sync but not autonomous action | Offer both framings in beta and observe which they enable | Sync enabled, autonomy declined | They want autonomy too (unlikely; would be good news) | Before — cheap and reversible |
| B5 | EU data residency | **Customer-Driven** | An EU-footprint customer is reachable and blocked only by residency | Test in real pipeline conversations | A qualified EU deal names residency as the sole blocker | No EU deal in the pipeline within the horizon | **After a real deal exists. Architectural L on speculation is indefensible.** |
| B6 | Crosswalks | **Validate First** | Customers assess overlapping frameworks and want evidence reuse | Ask which framework *pairs* they hold simultaneously | Common pairs recur across the cohort | Each customer holds one framework — crosswalks are then near-worthless | After A8 validates which frameworks matter |
| B7 | In-app notifications | **Build Now** | Users want a "what needs me" surface in-product | Observe whether beta users act on alert emails | Emails are opened but action happens in-app | Users prefer email/Slack entirely — would redirect to a Slack integration | Before — low uncertainty, moderate cost |
| B8 | Collaboration | **Validate First** | Customers want discussion *in* the platform rather than Slack | Ask where decision debate happens today and whether they would move it | They want the reasoning attached to the record for audit | They will not leave Slack — implies a Slack integration that captures decisions, a far cheaper build | **Validate first. The cheaper answer may be the right one.** |

### Track C

| # | Item | Class | Assumption | How we validate | Confirms it | Invalidates it | Build before or after? |
|---|---|---|---|---|---|---|---|
| C1 | Intelligence → inventory surface | **Strategic Bet** | Personalized external intelligence is worth switching for | Show matched signals against a beta customer's real inventory | They act on a matched signal, or cite it in a leadership update | They find matches interesting but not decision-changing | **Promote first, then extend.** The bet is worth making regardless. |
| C2 | AI governance depth | **Validate First** (skeleton: Build Now) | AI governance is a *funded* line item on our timeline | Ship the EU AI Act risk-classification skeleton over the existing inventory; ask every beta customer whether a funded AI governance owner exists | A named owner with budget; customers open the classification and act on high-risk results | Unfunded side duty; the classification page goes unopened | **Skeleton before validation; content library only after.** See §6.1 |
| C3 | Determinism positioning | **Build Now** | Buyers value defensible numbers over AI features | Present both framings in beta and note which draws questions | Determinism draws follow-up questions in review | Buyers want more AI, not less | Before — positioning, near-zero cost |
| C4 | Nth-party concentration | **Customer-Driven** | Customers actively manage fourth-party concentration | Ask whether they can name their vendors' critical vendors | They already track it, badly | They do not think past tier one | After B3 |
| C5 | Change-delta everywhere | **Validate First** | The delta framing generalizes beyond the Briefing | Measure engagement with "Since Your Last Visit" once live | Users open it first and return for it | It is ignored relative to other modules | **After A1 produces real usage data.** Built but never observed in production. |

### 6.1 Design review — why C2 (AI Governance) is *not* a Strategic Bet

An earlier draft classified C2 as a Strategic Bet to be built ahead of proof, on
the grounds that its value is timing-dependent. That exception was challenged and
**does not survive**. The reclassification is recorded here with the reasoning,
because the argument generalizes.

**What is genuinely different about C2.** Its forcing function is *external and
dated*. EU AI Act obligations phase in on a statutory calendar whether or not any
customer asks. B1 and B3 wait on customer demand; C2 waits on a law already
passed. That asymmetry is real and it is why C2 is not merely deferred.

**Why the exception still fails.** A Strategic Bet is defined in this document as
deliberately accepting *unresolved* uncertainty. The uncertainty here is not
unresolved — it is answerable in a single question per beta customer: *is there a
funded AI governance owner?* When cheap validation exists, building ahead is not a
bet; it is declining free evidence.

**The buying signal does not exist.** There is no pipeline data, win/loss record,
or logged customer request supporting AI governance demand anywhere in this
repository. The original claim rested on general market reasoning presented with
more confidence than the evidence carried. "No entrenched incumbent" is weak
evidence — it is equally consistent with *no market yet*.

**The decisive argument: resource contention with A8.** C2 and A8 draw on the same
scarce capability — content acquisition. A8 serves *confirmed* demand (SOC 2, ISO
27001, NIST); C2 serves *hypothetical* demand. These are not independent bets
competing for engineering time; they compete for the same constrained muscle.
Under contention, validated demand wins. Building the C2 library first means
arriving late to content depth that a Track A gate already depends on.

**Cost of delay, and its mitigation.** The real cost of waiting is content lead
time, not engineering — obligation libraries and ISO 42001 mappings are slow to
acquire and cannot be compressed once demand appears. That cost is bounded and
mitigable: **content research starts now and is decoupled from the build.**
Research is cheap; the library is not.

**Cost of building it anyway, wrongly.** An L investment in content and
engineering in a category with no confirmed demand, at the direct expense of A8.

**The walking skeleton that resolves it.** We already have an AI system inventory
and AI RMF requirements. The skeleton is **EU AI Act risk classification
(prohibited / high-risk / limited / minimal) as a deterministic classifier over
the existing inventory** — S–M, reusing what exists, requiring no content library,
and consistent with the determinism principle. It is also a sharp test: a customer
who has this problem will immediately ask "which of my systems are high-risk?" and
act on the answer. A customer who does not will never open the page.

**Resulting classification:** C2 is **Validate First**, with a **Build Now**
skeleton and content research decoupled and started immediately. The full library
is authorized only on evidence from the skeleton.

**Note on C1, for framework consistency.** C1 remains a Strategic Bet, and the
same challenge was applied to it. It survives for a different reason: C1 cannot be
validated *without* being promoted, and promotion (A1) is already committed and
cheap. Its "bet" is therefore an extension decision after real usage data, not a
build-ahead-of-evidence decision. C1 is the only remaining exception in this
document, and it is the cheapest one available.

### The uncomfortable conclusion of this section

Under honest classification, **the two largest investments in this roadmap (B1
and B3) are both Validate First, not Build Now.** Both are L. Both rest on
assumptions no customer has confirmed. Committing engineering to either before
Private Beta returns evidence would be the most expensive mistake available in
this phase — larger, in absolute terms, than the flag gap that motivated the
whole analysis.

Correspondingly, the true engineering content of Private Beta is smaller than it
first appears: **A1–A6, plus B4, B7, and the C2 skeleton** — most of which are S
or M. That is the correct shape. Private Beta should be dominated by learning,
not by building.

**After the C2 challenge (§6.1), exactly one Strategic Bet remains in this
document, and it is the cheapest one available (C1).** That is the intended end
state. A roadmap with many strategic bets is usually a roadmap that has not yet
been interrogated — each exception should have to survive the argument C2 failed,
and every large item should be assumed Validate First until it earns otherwise.

---

## 7. Assumptions this baseline challenges

- **"EG3 is a UX problem."** It is not. The gap to Fortune 100 replacement is
  content depth, procurement blockers, and validation of dark capability — not
  clicks.
- **"Command palette belongs in Private Beta."** Moved later under a replacement
  lens.
- **"Crosswalks are a later-tier concern."** They are Track B and gate on content
  (A8), so real lead time exceeds the engineering estimate.
- **"We compete with SecurityScorecard and BitSight."** We should not. Integrate,
  do not replicate.
- **"The engineering foundation is strong, so build more."** The foundation is
  strong *and over-extended relative to validated surface area*. More building
  worsens the ratio.

## 8. Corrections to the EG3 UX review

Three findings in the preceding UX review were wrong on evidence and are
corrected here:

- **"No ITSM integration"** — wrong. ServiceNow and Jira executors exist
  (`orchestrationExecutors.ts:74,91`), plus a ServiceNow CMDB connector. Dark
  behind `AUTONOMOUS_OPERATIONS_ENABLED`.
- **"No framework crosswalks"** — conclusion right, evidence wrong. Crosswalk
  files exist at repository root with 1–2 entries each and no code path loads
  them. A stub resembling capability is worse than a clean absence.
- **Connector and org-hierarchy capability was missed entirely** — 18 adapters
  and `business_unit` / `department` / `region` entity types exist, all dark.

## 9. Open questions for the operator

1. Do we hold a current SOC 2 report and penetration test? If not, A4 outranks
   everything in this document.
2. Is there a qualified EU-footprint opportunity in the pipeline? The answer
   determines whether B5 is Track B or indefinitely deferred.
3. What is the target Private Beta cohort size? The validation design in §6
   assumes enough customers that a recurring pattern is legible — roughly five or
   more.
