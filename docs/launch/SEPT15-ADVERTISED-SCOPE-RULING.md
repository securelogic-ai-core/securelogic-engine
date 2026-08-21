# Sept 15 — Advertised Scope Ruling

- **Status:** **ACCEPTED (2026-08-21).** Operator ruling, delivered in-session.
- **Supersedes:** the implied "advertise everything built" scope. Subordinate to
  `PRODUCT_VISION.md`, `CANONICAL_DOMAIN_MODEL.md` and `FINAL_PRODUCT_STANDARD.md`.
- **Evidence:** `docs/architecture/ENTERPRISE-CAPABILITY-BASELINE.md` §T.
- **Audit only.** Nothing built, no flag changed, nothing promoted, production
  untouched, frozen candidate `65cd3330` unchanged.

---

## The ruling

**Sept 15 advertises four workflows. Everything else is roadmap.**

| # | Workflow | Status |
|---|---|---|
| 1 | **Findings & Remediation** | **IN** — unconditional |
| 2 | **Risk Register with Exceptions** | **IN** — unconditional |
| 3 | **Intelligence Brief** | **IN** — unconditional |
| 4 | **Vendor Assurance** | **IN, CONDITIONAL** — only if VA-3 passes and §4 clears |

**Out of advertised scope:** Vulnerability Management · Pen-Test Management ·
AI Governance · SecureLogic Operations · Decision Workspace as a distinct
product · Enterprise Context · vendor portal · asset inventory as a customer
capability.

Being out of scope is **not** a statement that the work is bad. Vulnerability
Management has the strongest data model in the platform. It is out of scope
because it operates over an empty asset estate, and a capability a customer
cannot put their data into is not a capability we can sell.

**"Ship fewer complete workflows rather than more partial ones."** Eight partial
verticals demo worse than three complete ones, and they fail worse in a trial.

---

## 1. The finding that reshapes this ruling

Checked against `render.yaml` while writing. **Production has it exactly
backwards:**

| Workflow | Flag | Prod declared |
|---|---|---|
| Findings & Remediation | `SECURELOGIC_FINDINGS_QUEUE_CONTROLS_ENABLED` | **false** |
| Findings & Remediation | `SECURELOGIC_DECISION_WORKSPACE_ENABLED` | **false** |
| Findings & Remediation | `SECURELOGIC_FINDING_CLOSURE_GATE_ENABLED` | **false** |
| Risk Register | `SECURELOGIC_RISK_WORKSPACE_ENABLED` | **false** |
| Risk Register | `SECURELOGIC_RISK_LIFECYCLE_ENABLED` | **false** |
| Exceptions | `SECURELOGIC_RISK_ACCEPTANCE_ENABLED` | **undeclared → default-deny → off** |
| Exceptions | `SECURELOGIC_RISK_ACCEPTANCE_NOTIFICATIONS_ENABLED` | **undeclared → off** |
| **Vendor Assurance** | `SECURELOGIC_VENDOR_ASSURANCE_ENABLED` | **TRUE** |

> **Every flag the three unconditional workflows depend on is OFF in production.
> The one workflow that is blocked, unproven and conditional is the only one
> that is ON — and the production engine declares no R2 at all.**

The practical consequence today: a production customer who finds the Vendor
Assurance upload gets **HTTP 500 and a document row asserting their file is
corrupt** (the defect PR #827 fixes). Meanwhile the three workflows we intend to
advertise are invisible.

**This is the single most important operational item in this ruling**, and it is
not a code change — it is flag state.

## 2. Activation list

Staged, with validation at each flip, in the Sept 8–12 window after the
promotion. **Not now — the freeze holds and these are production changes.**

**Turn ON (7):** the seven flags above marked false/undeclared.

**Decide, before Sept 15 (1):** `SECURELOGIC_VENDOR_ASSURANCE_ENABLED` in
production. Two acceptable outcomes, no third:

- **Wire R2 on the production engine**, merge #827 and #855, and let VA-3 prove
  the path; or
- **Turn the flag OFF** until those are true.

Leaving it ON without R2 is the one option that must not survive this ruling.
**Operator decision — recorded, not taken here.**

**Leave OFF:** every flag belonging to an out-of-scope capability.

**Note:** `SECURELOGIC_BRIEF_QUALITY_ENABLED` and
`SECURELOGIC_DASHBOARD_BRIEFING_ENABLED` are **enhancements to** the Intelligence
Brief, not prerequisites for it. The Brief is the platform's live product and
does not depend on them. They may be flipped on their own merits.

---

## 3. What each advertised workflow claims

Claims must be sentences a customer can test, not capability nouns.

### 1. Findings & Remediation — unconditional

> *"Track a security finding from discovery to closure: severity, an owner, a
> due date derived from your own remediation SLA policy, remediation actions,
> and a closure decision with separation of duties and a durable history."*

**Must be true:** the seven flags in §2 on and validated · the promotion
complete · a staging walkthrough recorded in `docs/validation/`.

**Must NOT be claimed:** MTTR, SLA attainment, or trend reporting. **Those
metrics do not exist** (Baseline §F.2).

### 2. Risk Register with Exceptions — unconditional

> *"Maintain a risk register with inherent and residual ratings, link findings
> to risks, and authorise a time-boxed exception that does NOT close the
> finding — so an auditor sees both that the obligation was missed and that the
> exposure was formally authorised."*

**Must be true:** as above, plus the acceptance flags on, plus a two-person
staging proof of propose→approve under separation of duties.

**Must NOT be claimed:** risk appetite/tolerance modelling — **not built**.

### 3. Intelligence Brief — unconditional

> *"A recurring executive intelligence brief: external signals qualified,
> deduplicated, prioritised and explained in business terms, with provenance."*

**Must be true:** nothing new. This is the most operationally mature domain and
already runs in production. Strongest of the four.

### 4. Vendor Assurance — **CONDITIONAL**

> *"Review a vendor's SOC 2 report and turn what it obligates you to do into
> tracked remediation work."*

**All four must be true. This is a conjunction, not a checklist to average:**

| # | Condition | State |
|---|---|---|
| 1 | Clean-SOC 2 extraction fixed and deployed | PR #855, 8/8 green, **unmerged** |
| 2 | **VA-3 passes** on staging, in the product UI | **Blocked** on (1) |
| 3 | Finding provenance back to vendor/document/CUEC/reviewer (ADR-0010 Option 4) | **Not built** |
| 4 | Production R2 wired, or the flag off (§2) | **Not done** |

**Decision point: 2026-09-05, the feature cutoff.** If all four are not true by
then, **Vendor Assurance drops to roadmap** and Sept 15 advertises three
workflows. That is an acceptable outcome and should be planned for, not
resisted.

**Must NOT be claimed under any circumstance:** that Vendor Assurance covers the
full third-party risk lifecycle. The engagement spine and the document spine do
not connect (ADR-0010), so tiering → questionnaire → decision → monitoring is
**not** joined to SOC 2 review.

---

## 4. How to describe what is out of scope

Truthfully, and without implying imminence.

| Capability | Say | Do **NOT** say |
|---|---|---|
| **Vulnerability Management** | "Vulnerability tracking with per-asset occurrence detail is on the roadmap." | Anything implying we can ingest **your** scanner output or cover **your** estate. There is no scanner ingestion connector and the asset estate is empty |
| **Pen-Test Management** | "Penetration-test finding intake is in development." | That we manage pen-test engagements. There is no scope, methodology or retest model, and no UI |
| **AI Governance** | "AI system inventory with vendor-dependency mapping." | "AI governance" as a compliance capability. We **cannot** map an AI system to a framework, control or policy — no such relationship exists |
| **Operations / tenant health** | Nothing. Internal capability | — |
| **Decision Workspace, Enterprise Context, vendor portal** | Roadmap, if asked | Unprompted |

**On security posture**, use the wording ratified in ADR-0011: administrative
access is **credential-restricted**, with network-origin classification logged
but not enforced. Not "identity-restricted".

---

## 5. What this changes about the program

- **The Sept 5 feature cutoff becomes the Vendor Assurance decision point**, not
  merely a code deadline.
- **Wave 0 (the promotion) is unchanged and still first.** Three of the four
  advertised workflows are built and dark; the promotion plus flag activation is
  what makes them real. No new feature work is required for claims 1–3.
- **The activation window (Sept 8–12) is now load-bearing**, because seven flags
  must flip and be validated. It is not slack.
- **Out-of-scope work continues** on the Baseline's wave plan. Descoping from
  Sept 15 is not descoping from the product.

## 6. Consequences accepted

- Sept 15 advertises **three or four** workflows, not eight.
- Vulnerability Management ships genuinely good architecture that is not sold
  yet. Accepted deliberately: the alternative is selling an empty estate.
- AI Governance is described as an inventory, which is what it is.
- If VA-3 fails, the flagship vertical of the last month is not in the launch.
  **Planned for, not feared.**

## 7. Enforcement

- No marketing, sales, demo or documentation claim outside the four workflows
  above without superseding this ruling.
- Any claim for workflow 4 requires **all four §3 conditions**, verified, not
  asserted.
- The MTTR / SLA-attainment / risk-appetite / full-TPRM-lifecycle exclusions are
  absolute, because the underlying capability does not exist.
