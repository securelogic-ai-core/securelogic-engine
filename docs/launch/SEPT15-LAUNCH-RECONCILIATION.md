# Sept 15 Launch — Program Reconciliation

**Produced:** 2026-08-21. **Read-only reconciliation.** No application code was
changed, no feature flag was changed, no PR was merged, nothing was promoted and
production was not touched to produce this document.

**Baseline:** `origin/develop` @ `4fe16808` · `origin/main` @ `011e1f1d` ·
production engine verified live on `011e1f1d` · staging engine, app and
vendor-extraction worker verified live on `4fe16808`.

**Why this document exists.** The Aug 20–21 package stream (SUPPORT-1/2,
SUP-SEC-1, REPORT-1, VA-1, VA-1b, VA-2) ran package-by-package under operator
direction with no written sequence, while `BUILD_SEQUENCE.md` still named a June
package as Active and `LAUNCH_MASTER_PLAN.md` still described the July 21 launch.
This reconciles the governing documents with what is actually merged, deployed,
validated and dark — and produces one dependency-driven sequence through Sept 15
and on to Oct 15.

**Authority.** This document is subordinate to `PRODUCT_VISION.md`,
`CURRENT_STATE_ARCHITECTURE.md`, `CANONICAL_DOMAIN_MODEL.md`,
`TENANT_ISOLATION_STANDARD.md`, `BUILD_SEQUENCE.md` and
`FINAL_PRODUCT_STANDARD.md`. Where it conflicts with one of those, the governing
document wins and this must be corrected. It **supersedes** the status table in
`docs/validation/LAUNCH_READINESS.md` (2026-07-14) and the Sept 15 relevance of
`docs/launch/LAUNCH_MASTER_PLAN.md` (2026-07-21).

---

## 1. Evidence standard

Two things are tracked separately throughout, because conflating them is how a
product gets called finished:

**Gate standard — unchanged.** `docs/validation/LAUNCH_READINESS.md` ratified
seven gates on 2026-07-14 and they remain the definition of a complete workflow:
Backend · UI · E2E in a browser in a real environment · Tests · CI · **Staging
validated by an operator** · CX reviewed. Gates 6 and 7 are still the ones the
repository systematically fails to record.

**Evidence tiers.**

| Tier | Meaning |
|---|---|
| **PROD** | Observed in production |
| **STAGING** | Exercised on staging against a real tenant, evidence recorded in `docs/validation/` |
| **HARNESS** | Proven by automated tests — including real-Postgres integration and cross-org isolation suites — but never exercised as a product |
| **CODE** | Implemented and merged; no execution evidence of either kind |
| **DARK** | Present but flag-disabled in the environment under discussion |

**HARNESS is not STAGING.** Most of what merged between 2026-08-17 and
2026-08-21 is HARNESS. That is the single most important fact in this document.

---

## 2. Current verified platform state

### 2.1 Code and deployment

| Fact | Value | How verified |
|---|---|---|
| `origin/develop` | `4fe16808` | `git` |
| `origin/main` | `011e1f1d` | `git` |
| develop ahead of main | **93 commits**, 27 merge commits + 21 squash-merged PRs | `git log origin/main..origin/develop` |
| main ahead of develop | 2 release commits (E-1/E-2 promotion) | `git log origin/develop..origin/main` |
| Migrations on main / develop | **232 / 248 → 16 pending** | `git ls-tree` |
| Production engine | live on `011e1f1d`, `/health` ok, db connected | `GET /version`, `GET /health` |
| Staging engine / app / vendor worker | all live on `4fe16808` | Render deploy list |
| Engine routes | 148 route modules | `ls src/api/routes` |
| App pages | 123 `page.tsx` | `find app/src/app` |

### 2.2 CI

The VA-2 branch head `7ef7c8d9` — the identical engine and app tree that
`4fe16808` carries, plus VA-1b's documentation — passed CI. The run for
`4fe16808` itself was **cancelled by the concurrency group** when three merges
landed within 12 seconds; the run that survived is for `3a8ae09e`, an ancestor.
**`develop`'s tip therefore has no green CI run of its own.** Low risk, and it
clears on the next push, but it must be green on the promotion candidate.

### 2.3 The pending migration batch — assessed

All 16 pending migrations were read for arrival risk:

- **9 new tables** — `llm_control_matcher_verdicts`, `billing_dunning_cycles`,
  `finding_risks`, `pen_test_engagements`, `asset_identifiers`,
  `finding_asset_occurrences`, `vulnerability_scan_runs`,
  `vulnerability_scan_run_assets`, `vulnerability_observations`
- **3 CHECK re-statements**, all **widening** an existing vocabulary
  (`findings.source_type` += `pen_test`, `vulnerability`;
  `vendor_assurance_cuecs.review_status` += the four determination states)
- **Zero** `DROP TABLE`, `DROP COLUMN` or `SET NOT NULL` on an existing column

**This is the lowest-risk migration batch this repository has promoted.** It
carries none of the narrowing-CHECK hazard that made `20260925` a P0 arrival
risk in the last release. That hazard (**B-6** in
`docs/validation/develop-to-main-promotion-audit.md`) is now **discharged by
events**: `20260925`/`20260927`/`20260928` are on `main`, and production applied
the chain and is serving traffic.

**Not yet done for this batch:** a rollback rehearsal. C-8's rehearsal covered a
different migration set.

### 2.4 Production is running without the security batch

Verified by ancestry check — **none** of the following is on `main`:

| Commit | Fix |
|---|---|
| `a6c3e6cd` (#799) | Verify Postgres TLS certificates by default — closes the 2026-05 audit Critical |
| `903518bd` (#807) | Digest reset / verification / invite tokens at rest |
| `8868859d` (#819) | Deterministic session invalidation via `users.session_epoch` |
| `8484b366` (#820) | Sign the user out when the engine invalidates their session |
| `f817998c` (#825) | SSO callback redirects to the public origin, not the internal host |
| `842f499d` (#814) | Rate limiters key on the resolved client, not the rotating Cloudflare edge |
| `4a945257` (#813) | Auth-anomaly detectors get a real client identity |
| `9e0af404` (#812) | High-severity dependency advisories remediated; CI audit gate restored |

**Production has been running known-fixed vulnerabilities since 2026-08-17.**
This reframes the promotion: it is not a feature release waiting on features, it
is outstanding security remediation. See §9.

### 2.5 Feature flags — production versus staging

Read from `render.yaml`. `-` means **not declared**, which for every flag in this
repository means **off** (all read `=== "true"`).

| Flag | prod engine | staging engine | prod app | staging app |
|---|---|---|---|---|
| `VENDOR_ASSURANCE_ENABLED` | true | true | – | – |
| `VENDOR_PORTAL_ENABLED` | false | false | – | – |
| `ASSET_REGISTRY_ENABLED` | **false** | true | **false** | true |
| `ENTERPRISE_CONTEXT_ENABLED` | false | true | false | true |
| `DECISION_WORKSPACE_ENABLED` | **false** | true | **false** | true |
| `RISK_WORKSPACE_ENABLED` (nav) | – | – | **false** | true |
| `RISK_ACCEPTANCE_ENABLED` | **undeclared** | true | – | true |
| `RISK_INTELLIGENCE_ENABLED` | false | false | **false** | true |
| `FINDING_CLOSURE_GATE_ENABLED` | false | true | – | – |
| `FINDINGS_QUEUE_CONTROLS_ENABLED` | – | – | false | true |
| `BRIEF_QUALITY_ENABLED` | **false** | true | – | – |
| `SIGNAL_RECENCY_ENABLED` | **false** | true | – | – |
| `BRIEF_CATCHUP_ENABLED` | false | true | – | – |
| `BILLING_GRACE_ENABLED` | false | false | – | – |
| `ASSIGNMENT_ALERTS_ENABLED` | **false** | **false** | – | – |
| `SLA_ALERTS_ENABLED` | **false** | **false** | – | – |
| `MATCHER_ALERTS_ENABLED` | **false** | **false** | – | – |
| `LEGACY_VENDOR_WRITES_ENABLED` | true | false | true | false |
| `SEAT_MODEL_ENABLED` | true | true | – | – |
| `ASK_ENABLED` | true | true | – | – |
| `ASK_TOOLS_ENABLED` | false | false | – | – |

Four consequences that matter for launch:

1. **No notification of any kind fires in any environment.** Assignment, SLA
   breach and matcher alerts are all off in prod *and* staging. Remediation has
   no notification loop today — a finding is assigned and nobody is told.
2. **Production and staging are different products.** Six flags diverge. Any
   claim resting on a staging demo does not transfer to production without a
   flag decision.
3. **`RISK_ACCEPTANCE_ENABLED` is undeclared in the production engine block.**
   This is the same defect class REPORT-1 found and fixed for
   `RISK_INTELLIGENCE_ENABLED`: an undeclared flag is invisible to the operator
   as well as the customer. It is off, correctly, but nothing in IaC says so.
4. **Production ships lower-quality Briefs than staging.** `BRIEF_QUALITY` and
   `SIGNAL_RECENCY` are dark in production, which means — per their own IaC
   comments — titles cut mid-word at 77 characters and decades-old KEV entries
   presented as "this period".

### 2.6 Navigation reachability — a new finding

`app/src/lib/navigation.ts` carries two navigation models. Production runs the
**legacy `NAV_ITEMS`** (`RISK_WORKSPACE_ENABLED=false`).

- **Fixed and verified:** Vendor Assurance is declared in **both** models under
  the BL-4 ruling, so `/vendor-assurance`, `/vendor-engagements` and
  `/vendor-assurance/queue` are reachable in production's nav.
- **NAV-1, open:** **`/approvals` is declared only in `WORKSPACE_NAV_ITEMS`.**
  The legacy `Risk` group contains Findings, Actions and Risk Register — and no
  Approvals. In the production navigation model the risk-acceptance **approver
  queue is nav-orphaned**, reachable only by typing the URL. This is exactly the
  defect class BL-4 closed for Vendor Assurance, still open for governance
  approvals.

---

## 3. Domain completeness matrix

Three independent ratings. **Code completeness** = implemented, not stubbed.
**Workflow completeness** = a customer can execute the whole journey in a
browser in a real environment. **Enterprise readiness** = operable, evidenced,
supportable, isolated, staging-validated — defensible to a buyer's security
reviewer or an auditor. Code existing never raises the second two.

| # | Domain | Code | Workflow | Enterprise | Class |
|---|---|---|---|---|---|
| 1 | Platform / Auth / Security | 90% | 85% | 55% | Fragile — fixes stranded off prod |
| 2 | Billing / Dunning | 90% | 70% | 45% | Complete in code, inert in operation |
| 3 | Findings & Remediation | 90% | 80% | 60% | Strongest domain; no notification loop |
| 4 | Risk Register | 85% | 70% | 50% | Thin but usable; no history |
| 5 | Risk Exceptions / Acceptances | 85% | 65% | 40% | Nav-orphaned in prod; undeclared flag |
| 6 | Reporting | 80% | 75% | 55% | Honest; six metrics unavailable by design |
| 7 | Vendor Assurance | 85% | 70% | 45% | Code-complete, **product-unproven** |
| 8 | Vulnerability Management | 85% | 55% | 40% | Built on an empty substrate |
| 9 | Pen-Test Management | 60% | 35% | 30% | Half a workflow — no engagement UI |
| 10 | Asset Inventory | 80% | 40% | 25% | Dark in prod and effectively unpopulated |
| 11 | AI Governance | 80% | 70% | 45% | Genuinely complete surface; unvalidated |
| 12 | Decision Workspace | 80% | 60% | 40% | Staging-validated, dark in prod |
| 13 | Intelligence | 85% | 75% | 50% | Live in prod at degraded quality |
| 14 | Support / Runbooks | n/a | 70% | 55% | Honest and unusually good |
| 15 | Incident Response | n/a | 60% | 40% | Minimum process; three untreatable gaps |
| 16 | Observability | 40% | 30% | 30% | The weakest domain |
| 17 | Release / Recovery | n/a | 50% | 35% | Large unpromoted release, no rehearsal |

**Unweighted means: workflow completeness 62%, enterprise readiness 44%.**

---

## 4. Domain reconciliation

Each entry states what is complete, what is merged to `develop`, what tier of
evidence exists, what is dark, what is operator-owned, what is unvalidated, what
is incomplete, and what is deferred.

### 1. Platform / Auth / Security — 90 / 85 / 55

**Complete and PROD:** email+password auth, MFA, SSO (SAML), invites, password
reset, seats (`SEAT_MODEL_ENABLED=true`), entitlements, API keys, audit log.
78 of 142 tables RLS-enabled and policied on both staging and production.

**Merged to develop, not on main:** the entire batch in §2.4.

**HARNESS only:** session-epoch invalidation, SSO origin fix, rate-limiter
client identity. Staging validation for Deploy 1+2 was recorded **DEGRADED** —
the security proofs passed, but staging has no organic traffic, so the absence
of `session_epoch_missing` events proves nothing.

**Operator-owned:** M-1 `app_request` flip (credential issuance,
`DATABASE_URL`/`MIGRATION_DATABASE_URL` repoints, staging soak, prod). All 78
policies are **INERT pre-flip** — owner credential, NOT FORCE. **Production
DSN external-URL repoint is owed *before* #799 arrives**, or every worker fails
live-but-broken on TLS verification.

**Incomplete / deferred:** reset, verification and invite tokens still ride in
the URL query string, so the app tier logs them in cleartext (the exposure #807
did not close); `verifyJwt` has no token-type invariant (#821); the SAML schema
validator is a no-op (#824); SEC-H1 (SSO session JWT in URL) is deferred as
must-fix-before-SSO-GA.

### 2. Billing / Dunning — 90 / 70 / 45

**Complete and PROD:** Stripe checkout, customer portal, entitlement mapping,
webhooks, seat caps.

**Merged to develop (SL-BILL-1, #828–#835), HARNESS only:** event-ordering
watermark, recovery convergence on `invoice.paid`, customer-facing
payment-failure banner, dunning metrics, derived grace period, dead
`session.billingActive` removed, suspended → Checkout → restored path.

**Dark:** `BILLING_GRACE_ENABLED=false` in **both** environments;
`GRACE_DAYS=15` awaiting reconciliation with the real Stripe retry window.

**Operator-owned (#836):** `invoice.paid` must be enabled on the Stripe webhook
endpoint — **PR-C is completely inert without it** — and the endpoint's API
version recorded. Issue #836's own text is stale: it says the eight PRs are
unmerged; they merged on 2026-08-21.

**Unvalidated:** no end-to-end dunning exercise has been run on staging since
the merge. A recorded staging defect — transposed PLATFORM/PROFESSIONAL price
IDs — remains unverified this session.

**Stale documentation:** `docs/launch/OPERATOR_RUNBOOK.md` (2026-07-21) predates
the entire package and describes billing flows that have changed. SUP-PROC-2
calls it "the most dangerous document in the repository for support purposes,
because it is confidently wrong rather than absent."

### 3. Findings & Remediation — 90 / 80 / 60

**Complete and PROD:** the two-axis lifecycle (`decision_state` ×
`operational_status`), severity vocabulary with NULL as "no SLA", org-configurable
remediation SLA (#838), actions, owners, evidence, saved views, bulk buckets,
CSV import and export, the Active Findings metric.

**Merged to develop:** vulnerability and pen-test as first-class sources,
finding→risk linkage, per-asset occurrences, the source-type filter pills for
`vulnerability` and `pen_test` (REPORT-1 — they had been ingestible,
SLA-governed and impossible to filter to).

**Dark:** `FINDING_CLOSURE_GATE_ENABLED` false in prod / true on staging.

**Missing — the single largest reporting consequence:** there is **no closure
timestamp model**. `findings.due_date` is mutable and closure is derived from
`decision_state`, so no "closed on / due on at closure" pair exists. SLA
attainment and MTTR are therefore not computable truthfully. See MET-1.

**Missing:** no notification loop. Assignment alerts are off everywhere.

### 4. Risk Register — 85 / 70 / 50

**Complete:** risks, scoring weights, scales, treatments, control and obligation
links, export.

**Merged to develop (#837, #839), HARNESS only:** `finding_risks` link table and
UI panel — `risks.source_type='finding'` was the wrong hook (single-valued and
unverified) — plus carrying the register into the Decision Workspace.

**Missing:** no risk history or snapshot table, so **risk trend over time cannot
be computed**. Only posture has a time series.

**Deferred:** the risk lifecycle epics R1–R4 (`RISK_LIFECYCLE_ENABLED` dark
everywhere, not authorized; Open Question #1 on the approver model unanswered).

### 5. Risk Exceptions / Acceptances — 85 / 65 / 40

**Complete in code:** `finding_risk_acceptances` — WORM, append-only,
separation of duties, one-live-acceptance, expiry worker, withdraw-reopens,
`sla_due_date_at_request` snapshotting. Described in `LAUNCH_READINESS.md` as
the best-tested subsystem in the repository.

**Merged to develop (#841):** SL-EXC-1 — an approved exception must not close
the finding. Measurement and treatment stay separate.

**Dark:** true on staging; **undeclared in the production engine block**.

**Nav-orphaned in production:** NAV-1 (§2.6) — the `/approvals` queue, which is
where an approver sees a pending acceptance, is absent from the legacy nav model
production runs.

**Consequence for reporting:** exception-register metrics are structurally 0 in
production and are documented as unavailable rather than reported.

### 6. Reporting — 80 / 75 / 55

**STAGING-verified (REPORT-1):** `GET /api/reports/executive.pdf` returns a
valid 7-page, 825 KB PDF. `/api/trends`, `/api/posture/latest` and
`/api/connectors` all 200.

**Complete and customer-reachable:** executive report from `/dashboard` and
`/posture`; per-framework gap report from the framework detail page; **eight CSV
exports with UI buttons** (findings, risks, controls, vendors, obligations, AI
systems, audit log, frameworks) plus posture and dashboard exports.

**Dark:** `RISK_INTELLIGENCE_ENABLED` gates only the `/executive` nav entry —
false in production, true on the staging app. A fully working leadership view is
invisible in production by decision, not by defect.

**Documented as unavailable, correctly (`docs/specs/reporting-metric-definitions.md`):**
SLA attainment, MTTR, exception-register metrics, risk trend, control
effectiveness, vulnerability exposure over time. Reported as unavailable, never
as 0.

**Structural caveat:** the executive report reads the **latest posture
snapshot**, not live data, so it can legitimately disagree with the findings
list. SR-015 forbids the tempting fix of triggering a snapshot to refresh a
number, which rewrites the customer's history.

### 7. Vendor Assurance — 85 / 70 / 45 — **NOT DONE**

**Complete in code, end to end:** upload → extraction (the
production-grade `vendorExtractionWorker`) → CUEC mapping → **determination**
(`pending | not_applicable | satisfied | gap`) → explicit promotion → an
ordinary Finding on the same SLA engine → Risk Register → exception path. Gap
determinations carry a reviewer and a timestamp enforced by a DB CHECK, a
required reason, and a snapshotted `gap_basis` so a March decision stays
explainable in September. VA-2 added the reviewer UI with the three refusals
tested: no reason → no gap; no severity → no promotion; no permission → no
determination.

**Evidence tier: HARNESS.** 16 real-Postgres end-to-end tests, 70/70 vendor
assurance isolation tests, 11 render tests, engine and app typechecks clean.

**Why it is NOT DONE.** VA-2's own commit message states it plainly: *"the
operational exercise against staging is BLOCKED … That is sequencing, not a
defect, and it is the last item in the Sept 15 definition of DONE for this
domain."* It was blocked because staging ran `4941f56e`, which lacked VA-1.

**That block is now cleared and the exercise has still not been run.** Staging
engine, app and vendor worker are all live on `4fe16808`; the promote route
returns 401 (present and authenticating) rather than 404. **The last DONE item
is unblocked as of 2026-08-21 and outstanding.**

**The fact that makes this non-negotiable:** 54 vendor documents have been
ingested and **zero findings have ever come out of the document path in any
environment**. Until one does, on staging, the domain is unproven as a product.

**Dark by ruling:** the vendor portal. `VENDOR_PORTAL_ENABLED=false` in both
environments; Sept 15 Vendor Assurance is customer-operated and document-driven.

**Cleanup owed:** the `vendor_engagement` finding source exists in the
vocabulary, has never produced a finding, and REPORT-1 asserts its absence from
the filter with a test that says it should be deleted by the Vendor Assurance
completion package.

### 8. Vulnerability Management — 85 / 55 / 40

**Merged to develop (#842, #843, #844, #845), HARNESS only:** vulnerability as a
first-class finding source with CVE/CWE/CVSS; `finding_asset_occurrences` giving
per-asset exposure; `asset_identifiers` for resolution; the observation ledger
with scope-aware recurrence; ADR-0009 (recurrence does not reopen the canonical
Finding); a ratified metrics vocabulary enforced by test — *one vulnerability
affecting 100 assets is 1 vulnerability, 100 affected assets, 100 occurrences,
never "100 vulnerabilities"*.

**Intake:** authorized CSV import only. **No scanner connector exists**
(SL-OCC-3 is not built, and SR-026/SR-060 say so explicitly).

**Customer surface:** the findings list filtered to `source_type=vulnerability`,
plus an Affected Assets panel on the finding detail. There is **no
vulnerability-specific workspace**, and none is required for a truthful story at
the finding level.

**The blocker (PLAT-ASSET-1):** the substrate is empty. Staging holds **24
assets and 2 endpoints against 5,340 findings**, with 0
`canonical_product_external_ids` and 0 `asset_product_identities`. A customer
will see **"0 affected assets" on every vulnerability** until their estate
exists in SecureLogic. The importer deliberately never creates an asset, because
a placeholder host would corrupt every exposure count downstream.

**Compounding:** `/api/assets*` is 404 in production — the registry flag is off
*and* the route additionally requires the per-org `enterprise_context`
capability. In production today there is no way to populate an estate at all.

### 9. Pen-Test Management — 60 / 35 / 30

**Merged to develop (#840), HARNESS only:** `pen_test_engagements` — the
provenance an auditor asks for and nothing more — plus `pen_test` as a finding
source and CSV import that attaches rows to an engagement via `source_id`.

**The workflow hole, verified:** `penTestEngagements.ts` exposes exactly **two**
routes, `GET` (list) and `POST` (create). There is **no application page** for
pen-test engagements anywhere in `app/src/app`, and the only reference in the
app is the `source_id` column description in the import action. **To record a
pen test today a customer must call the API directly, obtain the engagement
UUID, and paste it into a CSV column.** That is not a customer workflow.

**Missing:** no retest or verification cycle. A pen-test finding is remediated
like any other finding; there is no re-observation of the engagement's scope.

### 10. Asset Inventory — 80 / 40 / 25

**Complete in code:** unified registry over `asset_registry_v`, list, detail,
create, edit, CSV import, connector configuration pages, `asset_identifiers`,
attestations.

**Dark in production, twice over:** `ASSET_REGISTRY_ENABLED=false` on both
engine and app (the route chain puts the flag first and 404s), plus the
`enterprise_context` per-org capability.

**Effectively unpopulated everywhere** — PLAT-ASSET-1, no owner.

**The open decision, not a build:** who populates the estate — the customer by
import, a connector, or onboarding? And is per-asset vulnerability tracking part
of the Sept 15 story? Asset and scanner connectors are explicitly **not
authorized**.

### 11. AI Governance — 80 / 70 / 45

**Complete in code and reachable:** AI system inventory (list / create / CSV
import / edit / detail), governance assessment (`/ai-systems/[id]/assess`),
governance review (`/ai-systems/[id]/review`), evidence capture, vendor-AI
dependency management, and findings on both the `ai_review` and
`ai_governance_review` source types. Four engine route families back it.

**Evidence tier: CODE.** `LAUNCH_READINESS.md` recorded staging validation as
"not recorded" in July and nothing has been recorded since.

**Framework honesty:** NIST AI RMF 1.0 is among the 12 shipped framework
templates (321 requirements). **ISO/IEC 42001 is not shipped.** No certification
or conformance claim may be made against it.

**Missing:** no recurring review cadence — a governance review is an event, not
a cycle with a next-due date.

### 12. Decision Workspace — 80 / 60 / 40

**Complete in code**, and `docs/validation/decision-workspace-staging-validation.md`
exists — the domain has real STAGING evidence, unusually.

**Merged to develop (#839):** the Risk Register is carried into the workspace.

**Dark in production** on both engine and app (GATE B). Gates
`GET /api/findings/:id/context`, finding creation and bulk governance decisions.

### 13. Intelligence — 85 / 75 / 50

**Live in PROD:** the Intelligence Brief pipeline, 6 RSS feeds + 7 direct
adapters, the matcher, brief generation and delivery, Ask (`ASK_ENABLED=true`).

**Merged to develop (#817, Wave 4), evidence DEGRADED:** the per-org Brief
scheduler, the LLM control-matcher stack, the verdict cache and bounded
concurrency. Tier 1 passed but proved nothing semantic — all 13 staging orgs
reported `skipped_already_current`, so the generation path never ran.

**#826 is a HARD `develop`→`main` promotion gate** with a date-pinned window:
**2026-08-25T07:00:00Z**, the natural Tuesday cron, the first run in which orgs
are eligible again. Twenty-seven checklist boxes require live evidence.
Destructive staging fixtures are explicitly out of bounds — back-dating
published Briefs would corrupt the idempotency state Tier 1 validated.

**Quality flags dark in production:** `BRIEF_QUALITY_ENABLED` and
`SIGNAL_RECENCY_ENABLED` are both false in prod and true on staging. Per their
own IaC comments this means production ships titles cut mid-word at 77
characters and decades-old KEV entries presented as current.

**Dark:** `ASK_TOOLS_ENABLED` false in both; matcher alerts off everywhere.

### 14. Support / Runbooks — n/a / 70 / 55

**Complete (SUPPORT-1, SUPPORT-2, plus SR-015 and SR-016):** 25 SR runbooks, a
support authority model, a definition of done, and an honest readiness-gap
register.

**Ruled 2026-08-21:** for Sept 15 **L1 is an intake and triage tier**, not an
operational administration tier. `/admin/*` and staff keys are not exposed to
L1, and no support console is built before launch. The gap is closed by deciding
the boundary rather than by adding a tool.

**Open:** deferred runbooks (SR-060 scanner connectors deliberately absent
because the feature does not exist), and SUP-PROC-1 — **no support-executable
recovery procedure has been proven safe**, so none is documented as validated.
Recovery is Engineering. That is an accepted launch limitation, and the ruling
explicitly forbids manufacturing plausible-looking procedures to close it.

### 15. Incident Response — n/a / 60 / 40

**Complete (SUP-SEC-1):** `SECURITY.md`, `docs/security/INCIDENT-RESPONSE.md`
with severity, intake, roles, escalation, triage, evidence preservation,
containment authority, communications, closure and post-incident review, and a
paper tabletop of the highest-risk scenario.

**Not closed. Three findings documentation cannot fix:**
- **TT-1 — no named legal/privacy reviewer.** §12 cannot be executed during a
  live SEV1; the notification decision has nobody to make it. **Largest gap.**
- **TT-2 — cannot determine who else saw exposed data.** Reads are not audited
  at row level, so impact is reasoned about rather than evidenced.
- **TT-4 — log retention unverified.** Evidence may expire before an
  investigation starts.

Plus: no live exercise with real people, and one person holds Security Owner,
Incident Owner and Platform Operator.

### 16. Observability — 40 / 30 / 30

The weakest domain, and the one whose weakness is best documented.

- **SUP-OBS-1** — L1 has no read-only view of a user's auth state. Converts the
  most frequent support case into an escalation.
- **SUP-OBS-2** — no support surface at all. **Ruled post-launch**, with three
  non-negotiable requirements for the eventual console: least privilege,
  explicit per-organization scoping, full audit logging.
- **SUP-OBS-3** — email delivery is not answerable per customer.
- **SUP-OBS-4** — *(highest severity)* **cross-tenant exposure is detected by a
  customer noticing.** RLS is enforced and the isolation suites are extensive,
  but detection of a failure that gets past them is entirely reactive.
- **SUP-OBS-5** — request IDs are not customer-visible, so a report cannot be
  correlated to a log line without a timestamp hunt.
- **SUP-OBS-23** — L1 cannot see why a vendor extraction failed or whether it is
  queued. Recorded by VA-1b as the most common escalation in that domain.

### 17. Release / Recovery — n/a / 50 / 35

**Pending:** 93 commits, 16 migrations, 9 new tables, zero destructive DDL.

**Open gates from `develop-to-main-promotion-audit.md`:**
- **B-5, GOVERNING** — under "production mirrors staging", four gates that
  dark-shipping had shielded become promotion blockers: Stop Gate B.4 (real
  external tester), ASK-B (agentic review), ASK-C C-6 (Whisper DPA /
  subprocessor), C-9 (Ask conversation-retention ruling). None is closable by
  code. `ASK_ACTIONS`/`ASK_GOVERNED` are environment-global with no per-org
  gate, so production activation is all-or-nothing across every customer.
- **B-6 — discharged by events** (§2.3).
- **C-8 rollback** — rehearsed and passed, but for a **different** migration
  set. Not rehearsed for `20261021`–`20261036`.
- **Prod DSN repoint** — owed before the release reaches `main`.

**Recovery:** `docs/DR_PLAN.md` exists; no validated recovery procedure does
(SUP-PROC-1).

---

## 5. Re-evaluation of carried items

Priorities re-derived from today's evidence, **not** carried forward.

| Item | Was | Now | Reasoning |
|---|---|---|---|
| **PLAT-ASSET-1** — asset inventory unpopulated | P1 | **P0 as a *decision*, P2 as a *build*** | It decides an advertising claim. The decision is XS and gates GTM copy; the build is L and cannot land before Sept 15 |
| **SL-OCC-3** — scanner integrations | not built | **P2 / Oct 15+** | Explicitly unauthorized. Import is a truthful intake path for a design-partner launch |
| **Vulnerability customer surfacing** | open | **P2 — no build needed for Sept 15** | The findings filter plus the Affected Assets panel is a truthful surface. What is missing is a populated estate, which is PLAT-ASSET-1, not a UI |
| **Pen-test workflow / retest** | open | **P1 (engagement UI) / P2 (retest)** | The engagement UI is S and converts a half-workflow into a workflow. Retest is a genuine new cycle and is Oct 15 material |
| **AI Governance workflow completeness** | open | **P2 — validate, do not build** | The surface is more complete than assumed: inventory, assess, review, evidence, dependencies all exist and are reachable. What is missing is gate 6/7 evidence and a review cadence |
| **SUP-OBS-23** — extraction observability | new | **P2** | Follows directly from the L1-is-triage ruling. Real, but not a launch blocker once support is told to escalate |
| **Support Operations Console** | open | **P2 / Oct 15+ — ruled** | A privileged cross-tenant read surface shipped under launch pressure is precisely the wrong thing to hurry |
| **Closure timestamp model (MTTR/SLA)** | open | **P1, Oct 15** | The most valuable remaining *build*. Not a Sept 15 blocker only because REPORT-1 already documents the metrics as unavailable rather than approximating them |
| **Remaining IR gaps (SUP-SEC-1)** | P1 | **TT-1 → P0; TT-4 → P1; live exercise → P1** | TT-1 is a named-person decision, costs nothing, and without it the process has a hole exactly where a SEV1 needs it |
| **Vendor Portal / collaboration** | out of scope | **Confirmed out of scope; security review P2** | The ruling is sound. The prerequisite review is enumerated and un-started |
| **Deferred support runbooks** | open | **P2** | Correctly deferred; several describe features that do not exist |
| **Stale billing/operator docs** | open | **P1** | SUP-PROC-2. Confidently wrong beats absent only in the wrong direction |
| **Live Stripe / operator actions (#836)** | open | **P1** | Dunning is inert without `invoice.paid`. Cheap, and it invalidates a shipped package if skipped |
| **#826** | hard gate | **P0, unchanged, date-pinned 2026-08-25T07:00Z** | Kept intact. Nothing in this reconciliation modifies it |
| **Accumulated develop→main release** | "wait" | **P0 — promote EARLY, not last** | §2.4. Production is running without every security fix since #799. The batch is additive-only. Delay is now the risk, not the promotion |

---

## 6. Does document-driven Vendor Assurance meet its Sept 15 DONE definition?

**No. It is one item short, and that item is named in the package's own commit.**

| Gate | Status |
|---|---|
| 1 Backend | ✅ determination states, DB-enforced reviewer+timestamp, snapshotted basis, idempotent promotion |
| 2 UI | ✅ `CuecDeterminationPanel` in `CuecMappingCard` on the document detail page, reachable via Document Queue in both nav models |
| 3 E2E in a browser in a real environment | ❌ **never performed** |
| 4 Tests | ✅ 16 real-Postgres end-to-end, 70/70 isolation, 11 render |
| 5 CI | ✅ green at `7ef7c8d9` |
| 6 Staging validated by an operator | ❌ **never performed** |
| 7 CX reviewed | ❌ not recorded |

Merging three PRs is not the DONE definition. The distinction that matters here:
every claim about this domain rests on **HARNESS** evidence. Real-Postgres
integration tests with realistic fixtures are strong evidence that the code is
correct; they are no evidence at all that a person can upload a SOC 2 report and
end up with a finding. **Zero findings have ever come out of the document path
in any environment.**

The exercise was blocked when VA-2 merged and is unblocked now. It is the
recommended next package (§11).

---

## 7. Sept 15 claims we can support

Subject to the promotion in §10 and the activation decisions in §8, these are
complete customer workflows:

1. **Findings and remediation** — intake from many sources, severity-driven SLA
   from the organization's own policy, ownership, actions, evidence, and closure
   as a governed decision.
2. **Vulnerability findings** — CSV intake with CVE/CWE/CVSS, canonical
   severity, SLA, recurrence recorded rather than hidden. *At the finding
   level* — see §8.
3. **Risk Register** — with findings linked and promoted into it.
4. **Risk exceptions** — proposal, separation of duties, approval, expiry, WORM
   record, and an approved exception that does not silently close the finding.
   *Conditional on NAV-1.*
5. **Vendor assurance, document-driven** — upload a SOC 2, extract it, map CUECs
   to controls, determine applicability and satisfaction, record a gap with a
   named reviewer and a snapshotted basis, and promote it to remediation work.
   *Conditional on VA-3.*
6. **AI system inventory and governance review** — with evidence and vendor-AI
   dependency mapping. *Conditional on a staging validation pass.*
7. **Compliance** — controls, frameworks (12 templates / 321 requirements),
   obligations, policies, requirement responses, per-framework gap report.
8. **Executive reporting** — a 7-page executive PDF, posture history, eight CSV
   exports plus posture and dashboard, with metric definitions written down and
   the snapshot-staleness caveat stated.
9. **Intelligence Brief** — the free wedge, plus the signal→finding path.
10. **Billing** — self-serve checkout, customer portal, plan changes, dunning
    and recovery. *Conditional on #836.*
11. **Platform** — auth, MFA, SSO, seats, entitlements, tenant isolation, audit
    log, data-subject rights and export.

## 8. Sept 15 claims still blocked — do not advertise

Each is blocked by evidence, not opinion.

| Claim | Why it is blocked |
|---|---|
| **Per-asset vulnerability exposure / "affected assets"** | PLAT-ASSET-1. The customer sees "0 affected assets" on every vulnerability until their estate exists, and in production there is currently no way to populate one |
| **Scanner / vulnerability-tool integrations** | SL-OCC-3 does not exist. The runbooks say so explicitly |
| **Asset inventory / CMDB** | Dark in production behind two gates and effectively unpopulated everywhere |
| **Vendor self-service portal, vendor collaboration** | Deliberately unactivated. `VENDOR_PORTAL_ENABLED=false` in both environments, and its security review is un-started |
| **SLA attainment, MTTR, control effectiveness, risk trend, exposure over time** | Cannot be computed truthfully today. Documented as unavailable — a plausible but wrongly-defined metric gets quoted to a board |
| **Exception-register metrics** | Structurally 0 in production while the flag is undeclared |
| **Pen-test management as a workflow** | No engagement UI. Unless PEN-1 ships, this is an API plus a CSV column |
| **Support tooling / customer-visible operational console** | Ruled post-launch |
| **Continuous or real-time posture monitoring** | Posture is a snapshot cadence; the executive report reads the latest snapshot, not live data |
| **Enterprise Context, knowledge graph, predictive intelligence, autonomous operations, connector sync/writeback** | All dark in production, none validated |
| **Agentic Ask actions, realtime voice** | `ASK_TOOLS_ENABLED` false; B-5 gates open; the flags are environment-global with no per-org gate |
| **ISO/IEC 42001 conformance** | Not shipped. NIST AI RMF 1.0 is |
| **Automated notification of assignment or SLA breach** | Every alert flag is off in every environment |
| **Detection of cross-tenant exposure** | SUP-OBS-4. Prevention is strong; detection is reactive |

## 9. P0 / P1 / P2 gaps

### P0 — must clear before Sept 15

| ID | Gap | Owner |
|---|---|---|
| **P0-A** | `develop`→`main` promotion — production lacks every security fix since #799 | Eng + operator |
| **P0-B** | **#826** Tier 2 semantic validation, window 2026-08-25T07:00Z | Eng + operator |
| **P0-C** | Production DSN external-URL repoint before #799 arrives | Operator |
| **P0-D** | **B-5 ruling** — promote dark, or promote to target state | Operator |
| **P0-E** | **VA-3** Vendor Assurance staging operational exercise | Eng |
| **P0-F** | **PLAT-ASSET-1 ruling** — is per-asset exposure part of the Sept 15 story? | Operator |
| **P0-G** | **TT-1** — name a legal/privacy reviewer | Operator |
| **P0-H** | Ratify the §8 do-not-advertise list before GTM copy is written | Operator |

### P1 — should clear before Sept 15

| ID | Gap |
|---|---|
| **P1-A** | **PEN-1** — pen-test engagement UI |
| **P1-B** | **NAV-1** — `/approvals` nav-orphaned in the production nav model |
| **P1-C** | Declare `SECURELOGIC_RISK_ACCEPTANCE_ENABLED` in the production engine block |
| **P1-D** | **#836** — enable `invoice.paid`; record the endpoint API version |
| **P1-E** | **SUP-PROC-2** — re-validate or supersede `OPERATOR_RUNBOOK.md` |
| **P1-F** | **TT-4** log retention verification + one live IR exercise |
| **P1-G** | Production flag activation plan, staged with validation — including the Brief quality flags |
| **P1-H** | CX review pass (gate 7, unrecorded across every workflow) |
| **P1-I** | Rollback rehearsal for migrations `20261021`–`20261036` |
| **P1-J** | Staging validation of SL-BILL-1, SL-RISK-LINK, SL-EXC-1, SL-VULN-1, SL-OCC-1/2 as products, not suites |

### P2 — post-launch, Oct 15 window or later

MET-1 closure timestamps · M-1 `app_request` flip · SUP-OBS-4 cross-tenant
exposure detection · SUP-OBS-1/3/5/23 · Support Operations Console ·
VENDOR-PORTAL-1 security review then activation · PLAT-ASSET-1 build ·
SL-OCC-3 · pen-test retest cycle · risk history for trend · SEC-H1 / #821 /
#824 / tokens-in-URL app logging · SUP-PROC-1 validated recovery procedures ·
deferred runbooks · delete the dead `vendor_engagement` source · AI governance
review cadence · risk lifecycle R1–R4.

## 10. Dependency graph

```
                        ┌─ P0-B  #826 Tier 2 (2026-08-25T07:00Z, immovable)
                        ├─ P0-C  prod DSN repoint  ────┐
   PROMOTION  ◄─────────┤                              ├──► P0-A  promote (dark)
                        ├─ P0-D  B-5 ruling            │         ~Aug 26–27
                        ├─ P1-I  rollback rehearsal ───┘              │
                        └─ CI green on the candidate SHA              │
                                                                      ▼
                                                            prod gets the
                                                            security batch
   ADVERTISING          ┌─ P0-E  VA-3 staging exercise ──► advertise Vendor Assurance
   READINESS   ◄────────┤
                        ├─ P0-F  PLAT-ASSET-1 ruling ───► decides the vulnerability claim
                        │        └─ (b) build ──► asset registry flag ──► ECL gates ──► ✗ too big
                        ├─ P1-A  PEN-1 engagement UI ───► advertise Pen-Test
                        ├─ P1-B  NAV-1 approvals nav ───► advertise Exceptions
                        │        └─ P1-C flag declaration
                        └─ P0-H  do-not-advertise list ─► GTM copy

   OPERATIONAL          ┌─ P0-G  TT-1 legal/privacy reviewer ──► IR §12 executable
   READINESS   ◄────────┼─ P1-D  #836 Stripe  ──► dunning stops being inert
                        ├─ P1-E  operator runbook ──► support can answer billing
                        ├─ P1-F  TT-4 + live exercise
                        └─ P1-G  flag activation ──► prod == the validated product

   POST-LAUNCH          MET-1 ──► SLA/MTTR metrics ──► the reporting a buyer asks for
                        M-1 flip ──► RLS enforced not inert ──► the isolation claim
                        SUP-OBS-4 ──► exposure detection ──► the gap TT-2 also names
```

Two things fall out of the graph:

- **The promotion depends on nothing on the advertising path.** It can and
  should run first and in parallel.
- **PLAT-ASSET-1 branch (b) leads straight back into the Enterprise Context
  activation gates** (AD-17 grant, edge cap H1, graph load test H2). That is why
  it cannot be a Sept 15 build.

## 11. Recommended build sequence through Sept 15

Every package states: why · capability completed · dependencies · priority ·
size · schema · new external/security surface · evidence required for DONE ·
must-precede-promotion.

### R-1 — Promotion readiness pack
1. **Why.** The last promotion audit is stale by 27 merges; the candidate has
   moved and the migration batch is new.
2. **Completes.** A defensible release decision.
3. **Depends on.** Nothing.
4. **Priority.** P0. 5. **Size.** S. 6. **Schema.** No. 7. **New surface.** No.
8. **Evidence for DONE.** Delta classification at `4fe16808`; migration
   arrival-risk assessment (§2.3 is the draft); flag diff prod↔staging;
   rollback procedure written and rehearsed on a fresh database for
   `20261021`–`20261036`; all eight CI lanes green on the candidate SHA.
9. **Precedes promotion.** **Yes.**

### R-2 — #826 Tier 2 observation *(window 2026-08-25T07:00Z)*
1. **Why.** Hard `develop`→`main` gate. Wave 4 passed CI and a Tier 1 soak and
   is explicitly **not** PASS: the semantic claims were never exercised.
2. **Completes.** The reliability claim for Brief generation and the control
   matcher.
3. **Depends on.** The natural Tuesday cron. Nothing can accelerate it, and
   destructive staging fixtures are out of bounds.
4. **P0.** 5. **S** (observation, not build). 6. **No.** 7. **No.**
8. **Evidence.** The 27-box checklist on issue #826, each with live log
   evidence. **Issue #826 is kept intact and unmodified.**
9. **Precedes promotion.** **Yes — hard gate.**

### R-3 — Production DSN external-URL repoint
1. **Why.** #799 makes Postgres TLS verification mandatory. Internal Render DSNs
   fail `SELF_SIGNED`. Workers have no HTTP endpoint, so they fail
   live-but-broken and `/health` probes cannot see it.
2. **Completes.** Safe arrival of the security batch.
3. **Depends on.** Nothing. 4. **P0.** 5. **XS.** 6. **No.** 7. **No.**
8. **Evidence.** Each production service's `DATABASE_URL` hostname confirmed to
   be the External Database URL form; post-repoint deploy clean on every worker.
   *(Operator-owed — this session was correctly denied access to production
   secrets.)*
9. **Precedes promotion.** **Yes.**

### R-4 — B-5 ruling: dark promotion or target-state promotion
1. **Why.** B-5 governs the verdict. Under "production mirrors staging" four
   un-closable-by-code gates become promotion blockers; under a dark promotion
   they become *activation* blockers.
2. **Completes.** The decision that unblocks everything else.
3. **Depends on.** Nothing. 4. **P0.** 5. **XS.** 6. **No.** 7. **No.**
8. **Evidence.** A recorded operator ruling.
9. **Precedes promotion.** **Yes.**
> **Recommendation: promote DARK.** Every new capability in the batch is either
> entitlement-gated or flag-dark, so a dark promotion changes no customer-visible
> behaviour while delivering the entire security batch. Activation then becomes a
> separate, staged, reversible decision in the Sept 8–12 window.

### R-5 — Execute the promotion *(target Aug 26–27)*
1. **Why.** §2.4. 2. **Completes.** Production security parity.
3. **Depends on.** R-1…R-4. 4. **P0.** 5. **S.** 6. **Yes — 16 migrations
   arrive.** 7. **No** (dark). 8. **Evidence.** Composite true merge so
   `origin/develop..origin/main` = 0; `/version` on both production services
   returns the promoted commit; 248 migrations recorded in production
   `schema_migrations`; deploy order engine → workers → app; post-deploy health
   green on all six services. 9. **Is the promotion.**

### VA-3 — Vendor Assurance staging operational exercise **← next package**
1. **Why.** The named last item in the Sept 15 DONE definition for the domain,
   blocked when VA-2 merged and unblocked now. Zero findings have ever come out
   of the document path.
2. **Completes.** "Review a vendor's SOC 2 report and turn what it obligates you
   to do into tracked remediation work" — end to end, as a product.
3. **Depends on.** Staging on `4fe16808` — **already satisfied**.
4. **P0.** 5. **S** if clean; the defects it finds become the package.
6. **No.** 7. **No.**
8. **Evidence for DONE.** On staging, against `[SEED] Walkthrough Org`, in a
   browser: upload a real SOC 2 → extraction completes → CUECs mapped to
   controls → **all four determination states exercised**, including a refused
   gap with no reason → a gap promoted to a Finding → the Finding carries a due
   date from the org SLA policy → linked to the Risk Register → an exception
   proposed and approved without closing the finding → full provenance
   reconstructable by join: vendor → document → CUEC → reviewer → finding.
   Recorded in `docs/validation/`.
9. **Precedes promotion.** No. Precedes *advertising Vendor Assurance*: yes.

### PEN-1 — Pen-test engagement UI
1. **Why.** Today a customer must call the API for an engagement UUID and paste
   it into a CSV column. Verified: two routes, zero pages.
2. **Completes.** "Record a penetration test and track its findings to closure."
3. **Depends on.** Nothing — table and routes exist.
4. **P1.** 5. **S.** 6. **No.** 7. **No** (same entitlement + seat guards).
8. **Evidence.** Create an engagement in a browser; import findings referencing
   it; provenance visible on the finding; staging exercise recorded.
9. **Precedes promotion.** No.

### NAV-1 — Approvals reachability + flag declaration
1. **Why.** The risk-acceptance approver queue is nav-orphaned in the production
   navigation model; and `RISK_ACCEPTANCE_ENABLED` is undeclared in the
   production engine block — the same invisible-flag defect REPORT-1 fixed for
   `RISK_INTELLIGENCE_ENABLED`.
2. **Completes.** The exception workflow's approval step in the nav model
   production actually runs.
3. **Depends on.** Nothing. 4. **P1.** 5. **XS.** 6. **No.** 7. **No.**
8. **Evidence.** `/approvals` present in both nav models; a render test pins it;
   the flag declared explicitly `false` in the production block with a comment
   saying why. 9. **Precedes promotion.** Preferably yes — it is a nav entry and
   an IaC declaration, and it makes the release honest.

### TRUTH-1 — Say what is unavailable
1. **Why.** Where a capability is real but its substrate is empty, the product
   must say so rather than render a confident zero. "0 affected assets" reads as
   "you are not exposed."
2. **Completes.** The honesty standard `reporting-metric-definitions.md` sets:
   a metric with no qualifying rows is 0; a metric whose input does not exist is
   **unavailable**.
3. **Depends on.** P0-F (the PLAT-ASSET-1 ruling). 4. **P1.** 5. **XS–S.**
6. **No.** 7. **No.** 8. **Evidence.** The Affected Assets panel distinguishes
   "no assets in inventory" from "no affected assets"; render tests pin both.
9. **Precedes promotion.** No.

### GATE — Launch readiness *(Sept 5–15, no new features)*
Staging walkthrough of the full launch story on the promoted configuration ·
staged production flag activation with validation at each step · the Sept 1
security validation intake (ZAP/Burp/CI scan findings entering the platform's
own lifecycle) · TT-1 named, TT-4 verified, one live IR exercise ·
`OPERATOR_RUNBOOK.md` re-validated · CX pass · GTM copy checked against §8.

## 12. Recommended Sept 15 → Oct 15 sequence

Ordered by dependency and by what a design partner asks for second.

1. **MET-1 — finding closure timestamp model.** P1, **M**, **schema**. Writes a
   closure timestamp and the due date *as at closure* on the `decision_state`
   transition. Unlocks SLA attainment, MTTR and exception metrics — the numbers a
   partner asks for once they have used the product for a month. History cannot
   be backfilled, so **the sooner it lands the longer the series**. Evidence: the
   six metrics move from "unavailable" to defined in
   `reporting-metric-definitions.md`, each with a query.
2. **M-1 `app_request` flip.** P1, L, operator-led. Turns 78 inert RLS policies
   into enforced ones. The single largest enterprise-readiness item and the one
   a buyer's security reviewer asks about. Design and sequence already exist.
3. **SUP-OBS-4 — cross-tenant exposure detection.** P1, M. A response-level
   assertion or sampled audit flagging multi-org result sets. Also partially
   answers TT-2.
4. **VENDOR-PORTAL-1 security review**, then portal activation. P1, M for the
   review. Token lifecycle, replay, binding, tenant resolution, every elevated
   site, object-level authorization, revocation, rate limiting (the limiter
   **fails open when Redis is down**, unacceptable on an unauthenticated
   surface), upload boundaries.
5. **PLAT-ASSET-1 build** — the estate-population path chosen by the P0-F
   ruling, then **SL-OCC-3** scanner connectors. P1→P2, L. This is what makes
   per-asset vulnerability tracking visibly true.
6. **Support Operations Console.** P2, M. Least privilege, per-organization
   scoping, full audit. Start from SR-001's four questions, not from a table.
7. **Pen-test retest cycle**, **risk history for trend**, **AI governance review
   cadence**. P2, M each.
8. **Security tail:** SEC-H1 before SSO GA, #821 token-type invariant, #824 SAML
   schema validation, tokens-in-URL app logging.
9. **SUP-PROC-1 promotion path** — validate recovery procedures one at a time.
   Likely first: resend verification email, re-drive a failed Stripe webhook,
   restart a stuck worker. None is approved today.

## 13. Recommended feature cutoff

**Do not carry Aug 29 forward as a single date. Split it.**

- **Schema cutoff: Friday 2026-08-29.** Any package that adds or alters a
  migration must merge by then. Schema carries arrival risk and needs a rollback
  rehearsal; 17 days of soak before launch is the minimum this repository's own
  history justifies.
- **Feature cutoff: Friday 2026-09-05.** Non-schema, non-new-surface work — UI
  reachability, honesty fixes, copy — may land until then.
- **After Sept 5: validation, flags, documentation and defect fixes only.**

**Reasoning.** The binding constraint is validation capacity, not build
capacity. The release is 93 commits, 16 migrations and 9 tables, and almost none
of it has been exercised as a product. This codebase repeatedly finds P0/P1
defects only by *using* what it built — VA-2's own message says the last two
packages each surfaced a P1 that no test had caught, and the promotion audit
found three defects including one that broke staging outright. Between cutoff
and launch the program must fit: promotion verification, staged flag activation
with validation at each step, the Sept 1 security validation intake, one live IR
exercise, a CX pass and a full staging walkthrough. Ten days is tight for that.
Eight would not be honest.

## 14. Recommended develop→main promotion point

**Promote immediately after #826 clears — target Aug 26–27 — as a dark
promotion, before the remaining Sept 15 feature work.**

Four reasons, in order of weight:

1. **Production is running without every security fix since #799**, including
   TLS certificate verification, token digest at rest, deterministic session
   invalidation and rate-limiter client identity. Each day of delay is a day
   production runs known-fixed vulnerabilities. The promotion is remediation.
2. **The migration batch is additive-only** — 9 new tables, 3 widening CHECKs,
   zero destructive DDL. The B-6 class of arrival hazard that made the last
   release dangerous is absent here and discharged for the previous batch.
3. **A dark promotion changes no customer-visible behaviour.** Everything new is
   entitlement-gated or flag-dark. It converts B-5 from a promotion blocker into
   an activation blocker, which is where those gates belong.
4. **It separates "does the release deploy safely" from "is the feature ready."**
   If a feature slips, the deploy risk does not slip with it. A second, small
   promotion after the Sept 5 cutoff carries whatever lands in between.

**What must be true first:** R-1 (readiness pack incl. rollback rehearsal), R-2
(#826, 2026-08-25T07:00Z), R-3 (DSN repoint), R-4 (B-5 ruling), and green CI on
the candidate SHA.

**What must not happen:** promoting into the target state (flags on) in the same
step. Activation is staged, separately, in the Sept 8–12 window, with validation
at each flip.

## 15. Recommended next implementation package

**VA-3 — Vendor Assurance staging operational exercise, and the defects it
finds.**

It is the item VA-2 itself named as the last one in the Sept 15 definition of
DONE for the domain. It was blocked by sequencing; staging has been on
`4fe16808` since 17:00Z on 2026-08-21, so it is unblocked now. It needs no
schema, opens no new surface, and until it runs, the flagship Sept 15 domain
rests entirely on HARNESS evidence — with a standing fact that 54 documents have
produced zero findings in any environment.

If a pure build package is wanted instead, take **PEN-1** — S, no schema, no new
surface, and it converts the weakest advertised workflow (35%) into a real one.

**Not started.** This document ends at the recommendation, per instruction.

## 16. What should explicitly remain out of Sept 15 scope

The vendor portal · scanner and asset connectors · the Support Operations
Console · the M-1 `app_request` flip · asset-inventory population as a build ·
the risk lifecycle epics R1–R4 · Enterprise Context, knowledge graph,
predictive intelligence and autonomous operations activation · agentic Ask
actions and realtime voice · SLA/MTTR/effectiveness/trend metrics · pen-test
retest · row-level read auditing · any new capability not already merged.

**The discipline:** ship fewer complete workflows rather than more partial ones.
Eleven capabilities exist in code; five to seven are advertisable as complete
customer workflows on Sept 15. That is the launch.

## 17. Reconciled figures

| Measure | Value | Method |
|---|---|---|
| **Overall workflow completeness** | **62%** | Unweighted mean of the 17 domain workflow ratings in §3 |
| **Overall enterprise readiness** | **44%** | Unweighted mean of the 17 domain enterprise ratings in §3 |

Enterprise readiness sits ~18 points below workflow completeness, and the gap is
not distributed evenly — it concentrates in observability, release/recovery,
incident response and asset inventory. That gap is the honest description of the
platform today: **the workflows are largely built; the evidence, operability and
detection around them are not.**

---

## Appendix — what this document did not verify

Stated so nothing here is read as stronger than it is:

- **Production environment variables and DSN hostname forms.** An attempt to
  classify them was correctly denied; reading production secrets is
  operator-owned. P0-C and the production flag values in §2.5 are taken from
  `render.yaml` (declared state), not from the live dashboard, and
  `render.yaml`-declared has previously diverged from synced.
- **The staging Stripe price-ID transposition.** Recorded previously; not
  re-verified here.
- **Live test-suite execution.** Test counts are quoted from the commit messages
  and CI runs that produced them, not re-run in this session.
- **Any claim about `demo-engine`, `demo-app` or `intelligence-api`**, which are
  outside Blueprint ownership (INF-1).
