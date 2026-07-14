# Launch Readiness Checklist

**Standard set 2026-07-14.** We optimize for launch readiness, not implementation count.

A workflow is **complete** only when ALL SEVEN hold:

| # | Gate | Means |
|---|------|-------|
| 1 | Backend | Implemented, not stubbed |
| 2 | UI | Customer-facing surface exists |
| 3 | E2E | A customer can execute the whole workflow in a browser, in a real environment |
| 4 | Tests | Automated tests exist |
| 5 | CI | Those tests **actually run** in CI |
| 6 | Staging | Validated on staging by an operator |
| 7 | CX | Customer experience reviewed |

**Do not start another workflow until the current one satisfies all seven, unless explicitly authorized.**

Legend: ✅ done · ⚠️ partial / conditional · ❌ absent · — not applicable

---

## Status

| Workflow | Backend | UI | Tests | CI | Staging Validation | Launch Ready |
|---|---|---|---|---|---|---|
| **Findings** | ✅ | ✅ | ✅ | ✅ | ⚠️ not recorded | ⚠️ **closest to ready** |
| **Decision Workspace** | ✅ | ✅ | ✅ | ✅ | ❌ blocked — Blueprint sync | ❌ |
| **Risk Acceptance** | ✅ | ✅ | ✅ | ✅ | ❌ pending (unblocked #652) | ❌ |
| **Vendor Assessment** (core) | ✅ | ✅ | ✅ | ✅ | ⚠️ not recorded | ⚠️ |
| **Vendor Assurance** (SOC 2 AI extraction) | ✅ | ✅ | ✅ | ✅ | ❌ staging-flag only | ❌ |
| **Pen Test** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ **does not exist** |
| **AI Governance** | ✅ | ✅ | ✅ | ✅ | ⚠️ not recorded | ⚠️ |
| **Incident Response** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ **does not exist** |
| **Executive Dashboard** | ✅ | ✅ | ⚠️ gaps | ✅ | ❌ needs flags + worker history | ❌ |
| **Operations Center** | ✅ | ✅ | ✅ | ✅ | ⚠️ not recorded | ⚠️ **demoable on staging** |
| **Reporting** | ✅ | ⚠️ no home | ❌ **zero** | — | ❌ | ❌ |

**Nothing is Launch Ready (all seven) today.** Gates 6 and 7 are unrecorded across the board — no workflow has a signed-off staging validation or CX review on file.

---

## CI fact (verified, corrects a long-standing wrong belief)

The app **is** covered by CI. `.github/workflows/ci.yml:88` runs `cd app && npm ci --include=dev && npm run test` as a step inside the **already-required `test` job** — deliberately folded there rather than added as a separate job, so it blocks merges without a branch-protection change. All app render tests (`*.render.test.tsx`) gate merges today.

Three suites gate a merge:
- `npm test` — root `vitest.config.ts` (engine + app pure-helper `.test.ts`)
- `cd app && npm run test` — `app/vitest.config.ts`, jsdom (`.test.{ts,tsx}`)
- `npm run test:isolation` — real Postgres, cross-org (`cross-org-isolation` job)

Any claim that "the app has no CI job" is stale. Do not repeat it.

---

## Per-workflow detail

### Findings — the healthiest workflow
Backend `src/api/routes/findings.ts` (1598 lines, 9 routes). UI `app/src/app/findings/`. Real SQL, no mocks.
- **Gap:** `src/api/__tests__/findingsReviewRoute.test.ts` is a `readFileSync` + `toContain` **source-text grep**, not a behavioural test. It asserts the source contains a string, so it cannot fail on broken behaviour.
- **To reach Launch Ready:** replace that grep test; record staging validation + CX review.

### Decision Workspace
Two-switch flag `SECURELOGIC_DECISION_WORKSPACE_ENABLED` — engine `render.yaml:442` + app `:1225` both `"true"` on staging, `"false"` in prod (GATE B).
- **Blocker (gate 6):** the staging flags are committed in IaC but **no Blueprint sync has run**, so staging still answers 404. This is an operator action, not a code change.

### Risk Acceptance
Backend `src/api/routes/riskAcceptances.ts` (6 routes, WORM table, expiry worker). UI = `RiskAcceptancePanel` in the Decision Workspace. The best-tested subsystem in the repo (isolation suite: SoD, no-permanent-pardons, one-live-acceptance, expiry/withdraw reopen, WORM, cross-org).
- **Fixed in #652** (see below): the list route ignored `?finding_id=`, so every finding's panel showed the org's whole register and approve/withdraw acted on **another finding's signed record**; and the app-side flag was never declared, so the UI rendered nowhere.
- **Remaining (gate 3/6):** needs a Blueprint sync to activate both staging flags, then an operator walkthrough.
- **Known gap (not a blocker):** there is **no approver queue**. `finding_risk_acceptances` appears in no queue surface; `GET /api/risk-acceptances` and `/summary` have zero UI consumers. Today an approver can only reach a proposal via a hand-passed finding URL. There is also no notifier. **This is a real CX gap (gate 7).**

### Vendor Assessment (core) — works in prod today
`vendors.ts`, `vendorAssessments.ts`, `vendorReviews.ts`. **No feature flag** — gated only by `requireEntitlement("premium")`. Full UI: vendor → assess → review → findings.

### Vendor Assurance (SOC 2 upload → AI extraction → CUEC mapping → PDF/XLSX)
`vendorAssuranceDocuments.ts` (1734 lines) + `vendorExtractionWorker`.
- **Blocker:** per committed `render.yaml`, `SECURELOGIC_VENDOR_ASSURANCE_ENABLED` appears **only** in the staging engine block (`:414`). The prod engine block has neither the flag nor `R2_*`; the prod extraction worker has `R2_*` + `ANTHROPIC_API_KEY` but **not the flag**, so it idle-skips every tick. **Per IaC, the whole surface 404s in production.** (A dashboard override may exist — operator-verifiable, not code-verifiable.)
- **Nav:** the Vendor Assurance queue link lives only in `WORKSPACE_NAV_ITEMS` (`navigation.ts:162`), served only when `risk_workspace` is on — `"false"` in prod. In prod nav there is **no link**; direct URL only.

### Pen Test — DOES NOT EXIST
Zero routes, tables, migrations, pages, tests. Every grep hit is control-library prose (CIS-18 "Penetration Testing" as a control *name*), an LLM `documentType: "Penetration Test Report"` label inside the **vendor** doc pipeline, or placeholder UI copy.
**If Pen Test appears on any launch or sales surface, that is a false claim.** Building it is a from-scratch domain package (entity + migration + routes + worker + UI + tests), not a finishing task.

### AI Governance — no feature flag, works today
`aiSystems.ts` (731), `aiGovernanceAssessments.ts` (670), `governanceReviews.ts` (463). Full UI under `app/src/app/ai-systems/`. Needs a premium/platform entitlement on the demo org.
- **Architectural debt (not a blocker):** `GovernanceAssessmentForm.tsx:94` posts documents to **`/api/vendor-assessments/analyze-document`** — AI-governance document analysis reaches through the *vendor* analyzer. It works; it is a cross-domain reach-through, not a shared abstraction.

### Incident Response — DOES NOT EXIST
No `incidents` table, no `/api/incidents`, no `/incidents` page, no worker. Hits are: control-library text (IR-1 keyword maps that detect whether a customer *has* an IR policy), the Brief's `vendor_incident` **news category**, and a ServiceNow connector that creates a ticket **in the customer's system**. SecureLogic stores no incident object, timeline, severity lifecycle, or post-incident review.
**Same warning as Pen Test.**

### Executive Dashboard — cannot be demoed on short notice
Real domain data (`risk_history`, `risk_forecasts`), not ad hoc. But **three flags are `"false"` in every service block**: `RISK_INTELLIGENCE`, `PREDICTIVE_INTELLIGENCE`, `ASSET_REGISTRY`.
- **Compounding blocker:** `risk_history` is written only by `riskHistoryWorker`, itself gated on those flags. Flipping them yields an **empty table** → the page renders *"No risk history yet."* A trustworthy demo needs flags on **AND the snapshot worker to have run on ≥2 separate days** to produce a trend line. **Plan days ahead, not hours.**
- **Test gap:** zero engine tests for `predictiveIntelligence.ts`.

### Operations Center — demoable on staging today
`/findings` in work-first mode (`SECURELOGIC_RISK_WORKSPACE_ENABLED` — `render.yaml:1220` `"true"` on staging, `:1100` `"false"` prod). 13 queues driven by real `GET /api/findings/summary` SQL. Deepest test coverage in the repo. Renders an em-dash rather than a fake `0` when a summary field is absent — correct discipline, pinned by `opsCenter.render.test.tsx`.

### Reporting — biggest unguarded risk
No `/reports` page exists. "Reporting" is 8 export links scattered across 5 pages. All engine export routes read real SQL (no mock data).
- **THE GAP:** `executiveReport.ts`, `gapReport.ts`, `auditPackage.ts`, `findingsExport.ts` have **zero test files between them** — ~2,882 lines of PDFKit/CSV generation with 14+ raw SQL queries, producing the board-facing deliverables a buyer actually takes to their board, and **nothing asserts they produce a valid file, correct numbers, or don't 500.** Green CI tells you nothing about them.
- Intelligence Brief itself is genuinely real and the most mature output (23 engine test files). Debt: `/briefs` list reads `newsletter-issues` while `/briefs/[id]` reads both that and `intelligence-briefs` — dual-path wiring worth naming, not a demo blocker.

---

## Demo hazards (operator, read before any demo)

1. **Demo as a platform-tier account.** `app/src/app/dashboard/page.tsx:317` renders `SamplePostureDashboard()` — **fabricated numbers** (posture 67, 4 findings, 3 actions, 8 vendors) — to any **non-platform** user. It is honestly fenced (amber "SAMPLE PREVIEW" banner, blurred, `pointer-events-none`) and the gating is a tested pure function, but a demo on a free/Brief-Pro account shows fake data.
2. **Executive Dashboard needs days of lead time** (flags + accumulated worker snapshots).
3. **Vendor Assurance is staging-only** per committed IaC; in prod nav there is no link to it.
4. **Pen Test and Incident Response cannot be demoed. They do not exist.**

---

## Next actions, in order

1. **Operator: run a Blueprint sync on staging.** Unblocks gate 3/6 for Decision Workspace *and* Risk Acceptance. Nothing else moves until this happens.
2. **Operator: staging walkthrough of Risk Acceptance** (propose → approve as a different user → withdraw → expire), then CX review.
3. **Close the Risk Acceptance CX gap:** surface `finding_risk_acceptances` in an approver queue, or accept URL-handoff and say so explicitly.
4. **Test the export surface** (`executiveReport`/`gapReport`/`auditPackage`/`findingsExport`) — the largest untested customer-facing code in the repo.
5. **Decide the truth about Pen Test and Incident Response**: build them, or remove them from every launch/sales surface. Do not leave them implied.

---

*Maintained as reality changes. Evidence-backed only — if a cell says ✅, a file backs it.*
