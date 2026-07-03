# Ask — Enterprise Validation Report (Sprint 3B)

**Date:** 2026-07-01
**Scope:** "Ask SecureLogic" (`POST /api/ask`) product-knowledge / navigation answering.
**Method:** Deterministic static audit of Ask's injected knowledge against source-of-truth, plus a built-but-unrun live end-to-end harness.
**Status:** Findings only. No code changed, nothing committed. Operator review requested.

> **Naming note:** "Sprint 3B — Enterprise Ask Validation" is not a package in the governing docs. The doc-sanctioned Sprint 3A is the staging→prod URL-drift work (the current branch); Sprint 3 proper is RLS / GDPR reaper / signal-ingestion / ops hardening. This is a read-only validation/audit, not a new build package.

---

## 1. Executive summary

Ask is a **premium-gated LLM endpoint** (`requireEntitlement("premium")` → Anthropic `claude-sonnet-4-6`). It answers from exactly two sources:

1. **Static product knowledge** injected into the system prompt — the header menu (8 groups / 14 destinations), 14 how-to workflows, and 4 "does-not-exist" honesty limits. Rendered by `renderProductKnowledge()` (`src/api/lib/productKnowledge.ts`), machine-derived from `app/src/lib/navigation.ts` + the workflow registry and drift-locked by tests.
2. **Per-request org posture data** (findings/risks/vendors/actions/posture/risk-scale) for "what is my …" questions.

We generated **458 realistic customer questions across 20 domains** and computed, per question, whether the knowledge Ask is actually given can answer it — deriving every expected answer only from the committed source-of-truth files.

**Headline result:**

| Static verdict | Count | Share | Meaning |
|---|---:|---:|---|
| **COVERED** | 229 | 50.0% | Ask is given correct nav/workflow ground truth → expected to answer well. |
| **SURFACING_GAP** | 122 | 26.6% | The feature **exists as a real app route** but is **not injected** into Ask's prompt → Ask is flying blind. |
| **HONESTY_TEST** | 107 | 23.4% | The feature does **not exist** → correct answer is an honest disclaimer; hallucination is the failure mode. |

**The core finding is not a bug in Ask's code — it is a knowledge-surfacing gap.** `renderProductKnowledge()` emits only the header menu + workflows. The app has **89 routes; 61 are never surfaced to Ask.** Every account / settings / billing / team / notifications / onboarding feature is a real, shipped page that Ask has **zero knowledge of**. For those domains Ask can only disclaim ("I can't help with that") or hallucinate a path — both are enterprise-visible failures.

The 12 core GRC domains (Vendors, AI Governance, Compliance, Controls, Frameworks, Policies, Obligations, Risk, Findings, Actions, Assessments, Evidence) are **well covered** — this is where the workflow registry investment paid off.

---

## 2. What was validated, and how (determinism)

- **Corpus:** `docs/validation/ask/corpus.json` — 458 questions, each tagged with one source-of-truth `target` (`workflow` id / injected menu destination / real-but-ungated route / `absent`).
- **Grader:** `scripts/validation/ask-static-audit.ts` (run with `npx tsx`). It imports the **same** committed artifacts the engine imports — `applicationKnowledgeIndex.generated.ts`, `workflows.generated.ts`, and `renderProductKnowledge()` — and computes each expected answer + verdict from them. It cannot drift from what Ask actually sees. **No LLM, no network.**
- **Result data:** `docs/validation/ask/results.json` (per-question expected answer, verdict, failure class).

Every expected answer is therefore *derived*, not authored — satisfying the "expected answers from source-of-truth only" constraint structurally.

---

## 3. Findings ranked by severity

### FINDING 1 — SEV-HIGH — Account/admin domains are 100% invisible to Ask (missing knowledge)
Eight domains have **zero COVERED** questions; every question is a SURFACING_GAP against a route that exists but is not injected:

| Domain | Real routes that exist | Injected? | Questions |
|---|---|---|---:|
| Billing / Subscription | `/pricing`, `/billing-return`, `/api/billing/portal` | ❌ | 26 |
| Users / Teams | `/account/team`, `/api/account/team/members`, `/accept-invite` | ❌ | 26 |
| Settings (SSO, webhooks, security, API keys) | `/settings/*`, `/account/api-keys` | ❌ | 15 |
| Notifications / Alerts | `/account/alerts` | ❌ | 11 |
| Profile / Account | `/account`, `/account/privacy` | ❌ | 15 |
| Onboarding | `/getting-started` | ❌ | 14 |

**Impact:** A paying admin asking "how do I invite a teammate?", "where do I update our card?", "how do I turn on SSO?", or "where are my notification settings?" gets no correct answer — Ask has no knowledge these pages exist. Enterprise buyers probe exactly these.
**Root cause:** `renderProductKnowledge()` renders only `index.navigation` (the header menu). The account/settings surfaces live in the `UserMenu` (`app/src/components/UserMenu.tsx`) and in `/settings` + `/account` routes that are **not** in `app/src/lib/navigation.ts`, so they never enter the knowledge index's injected section.
**Recommended fix (platform-level, not a patch):** extend the source of truth so Ask sees these surfaces — either add the UserMenu/settings destinations to `navigation.ts` (or a sibling "secondary navigation" array) and render them in `renderProductKnowledge()`, or author workflows for the top account tasks (invite user, manage billing, configure SSO, set alerts). This keeps the single-source-of-truth + drift-test discipline intact.

### FINDING 2 — SEV-MEDIUM — "Exceptions" domain has no feature; high hallucination risk
There is no exceptions / exception-register UI. The real mechanism is **risk acceptance via the `treat_risk` workflow**. Exceptions scored 5 COVERED (questions phrased as risk acceptance) / 10 HONESTY_TEST. Nothing in the injected knowledge explicitly tells the model "there is no exceptions module; use risk acceptance," so a question like "where do I file a policy exception?" can produce an invented module.
**Recommended fix:** add one line to `NOT_USER_ACTIONS` in `productKnowledge.ts`: exceptions are handled as risk acceptance (a `treat_risk` treatment), not a separate feature.

### FINDING 3 — SEV-MEDIUM — Risk-scoring configuration is ungated (missing knowledge)
Ask receives the org's risk scale in the *data* context and explains inherent/residual well, but has **no knowledge** of the config pages `/settings/risk-scale` and `/settings/risk-policy` (9 SURFACING_GAP). "How do I change our rating scale?" cannot be answered correctly.
**Recommended fix:** covered by Finding 1's settings-surfacing fix.

### FINDING 4 — SEV-MEDIUM — Posture detail & Vendor Risk views are ungated
`/posture` (3) and `/vendors/risk` (9) are real pages not injected. Ask can discuss posture/vendor-risk *data* but can't direct a user to the dedicated views.
**Recommended fix:** add both as injected destinations (or a workflow "view your posture detail" / "view the vendor risk heatmap").

### FINDING 5 — SEV-LOW — "Reports" is ambiguous (Briefs vs exports)
Reports split 9 COVERED (Intelligence Brief via `view_brief`) / 9 HONESTY_TEST (no in-app custom report builder; exports are API-only: `/api/export/executive-report`, `gap-report`, etc.). Correct behavior is to point to Briefs and note exports are generated, not built in-app — but there's no injected knowledge of the export surface, so "download an executive report" is under-served.
**Recommended fix:** one `NOT_USER_ACTIONS`/overview line clarifying Briefs = the executive report surface; structured exports exist but there is no custom report-builder page.

---

## 4. Per-domain coverage matrix

| Domain | COVERED | SURFACING_GAP | HONESTY_TEST | Read |
|---|---:|---:|---:|---|
| Vendors | 22 | 0 | 5 | strong |
| Risk | 18 | 0 | 2 | strong |
| AI Governance | 19 | 0 | 5 | strong |
| Controls | 16 | 0 | 2 | strong |
| Assessments | 18 | 0 | 10 | strong (honesty tests are the parent-item rule) |
| Evidence | 15 | 0 | 13 | strong (honesty tests = "global evidence library" ≠ real) |
| Findings | 14 | 0 | 2 | strong |
| Frameworks | 14 | 0 | 4 | strong |
| Actions | 14 | 0 | 2 | strong |
| Obligations | 13 | 0 | 2 | strong |
| Compliance | 12 | 0 | 4 | strong |
| Policies | 12 | 0 | 3 | strong |
| Assets | 10 | 0 | 3 | strong |
| Dashboard | 9 | 3 | 5 | good (`/posture` gap) |
| Reports | 9 | 0 | 9 | ambiguous (Finding 5) |
| Vendor Risk | 5 | 9 | 4 | gap (`/vendors/risk`) |
| Exceptions | 5 | 0 | 10 | no feature (Finding 2) |
| Risk Scoring | 4 | 9 | 2 | config gap (Finding 3) |
| **Billing** | 0 | 12 | 3 | **blind** |
| **Subscription** | 0 | 12 | 2 | **blind** |
| **Users** | 0 | 12 | 3 | **blind** |
| **Teams** | 0 | 11 | 3 | **blind** |
| **Settings** | 0 | 14 | 1 | **blind** |
| **Notifications** | 0 | 11 | 2 | **blind** |
| **Profile** | 0 | 15 | 3 | **blind** |
| **Onboarding** | 0 | 14 | 3 | **blind** |

### Surfacing-gap routes, ranked (real pages Ask cannot see)
`/account` (28) · `/account/team` (23) · `/getting-started` (14) · `/account/alerts` (11) · `/vendors/risk` (9) · `/settings/risk-scale` (6) · `/settings/security` (5) · `/settings/risk-policy` (5) · `/pricing` (5) · `/billing-return` (4) · `/posture` (3) · `/settings/sso` (3) · `/account/api-keys` (3) · `/settings/webhooks` (2) · `/account/privacy` (1).

---

## 5. Automated failure-class detection (as requested)

The offline audit classifies each question into the failure classes it *risks* at live time; the live harness (§6) confirms which actually occur.

- **missing_knowledge** (122): the feature exists but Ask isn't told about it → risk of wrong navigation or disclaim. → Findings 1, 3, 4.
- **missing_feature** (107): the feature doesn't exist → risk of hallucination. → Findings 2, 5 + intentional honesty tests (mobile app, dark mode, Drive auto-collection, custom roles, invoice/wire billing, etc.).
- **incorrect_navigation / wrong_menu / hallucination**: cannot be proven offline (they depend on live LLM output). The harness in §6 grades these directly; every SURFACING_GAP and HONESTY_TEST question is a probe for them.
- **missing_workflow**: none — all 14 referenced workflows resolve; no corpus question targets a workflow Ask lacks. (0 corpus errors.)

---

## 6. Live end-to-end harness (built, NOT run)

`scripts/validation/ask-live-harness.mjs` fires the same 458 questions at a live `/api/ask` and (optionally) grades actual-vs-expected with a cheap LLM judge into PASS / MINOR / FAIL / UNKNOWN, keyed to the static verdict (a SURFACING_GAP the model *honestly disclaims* = MINOR; one it *hallucinates a path for* = FAIL; a HONESTY_TEST it *invents a feature for* = FAIL).

**It does not run without an explicit operator opt-in.** With no `ASK_CONFIRM=1` it prints the plan + cost estimate and exits, making zero calls.

**Operator inputs (env):**
- `ASK_BASE_URL` — staging engine URL (never prod unless intended).
- `ASK_API_KEY` — a tenant API key whose org has **premium/platform entitlement AND seeded posture data**.
- `ASK_CONFIRM=1` — required to actually fire.
- `ASK_JUDGE=1` + `ASK_JUDGE_API_KEY` — optional LLM-judge grading.
- `ASK_LIMIT=20` — optional smoke run; `ASK_RPM` (default 18, under the 20/min cap).

**Commands:**
```bash
# Dry run — safe, zero calls, prints plan + cost
node scripts/validation/ask-live-harness.mjs

# Smoke (20 questions)
ASK_BASE_URL=https://<staging> ASK_API_KEY=<premium-key> ASK_LIMIT=20 ASK_CONFIRM=1 \
  node scripts/validation/ask-live-harness.mjs

# Full run + LLM judge
ASK_BASE_URL=https://<staging> ASK_API_KEY=<premium-key> \
  ASK_JUDGE=1 ASK_JUDGE_API_KEY=<anthropic-key> ASK_CONFIRM=1 \
  node scripts/validation/ask-live-harness.mjs
```
Output: `docs/validation/ask/live-responses.json`.

### Estimated LLM call count, cost, and risk
- **Calls:** 458 Ask calls (`claude-sonnet-4-6`) + 458 judge calls (`claude-haiku-4-5`) if judging.
- **Cost (worst case, no prompt caching; re-confirm current rates):** Ask ≈ **$8.59** (~4.5k in @ $3/M + ~0.35k out @ $15/M each); judge ≈ **$0.85**; **total ≈ $9.4**. Prompt caching on the static ~3k-token system prompt typically cuts Ask input cost ~50% → realistic **$5–6**.
- **Wall time:** ~25–45 min (rate-limited at 18/min; the endpoint hard-caps 20/min/org).
- **Risk:** real billable calls — this repo has a history of Anthropic balance-exhaustion incidents; watch the console balance. Point at staging. Ensure the org is seeded, or "what is my …" answers grade against an empty context.

---

## 7. Recommended next actions (smallest correct sequence)

1. **Close the surfacing gap (Finding 1).** Extend the source-of-truth so Ask sees the account/settings/billing/team/notifications/onboarding surfaces — add a secondary-navigation array (UserMenu + `/settings` + `/account`) to `navigation.ts`, render it in `renderProductKnowledge()`, and extend the drift test. Optionally author 4–6 account workflows (invite user, manage billing, configure SSO, set alerts, onboarding). This single change flips ~122 SURFACING_GAP questions to COVERED and is a reusable platform improvement, not a per-answer hack.
2. **Add 2 honesty lines (Findings 2, 5)** to `NOT_USER_ACTIONS`: exceptions = risk acceptance; Briefs = the executive-report surface / no in-app report builder.
3. **Surface `/posture` and `/vendors/risk` (Finding 4).**
4. **Then run the live harness** against staging (smoke first, then full + judge) to confirm which gaps produce honest disclaimers vs hallucinations, and to establish a PASS-rate baseline the fixes can be measured against.

### What should wait
Do not re-architect Ask into retrieval/RAG or add a structured navigation-response schema yet — the static knowledge model is sound; it is simply under-populated. Fix the population first, re-measure with the harness, and only then consider structural changes.

---

## 8. Artifacts

| File | What |
|---|---|
| `docs/validation/ask/corpus.json` | 458 tagged questions (20 domains) |
| `scripts/validation/ask-static-audit.ts` | deterministic grader (no LLM/network) |
| `docs/validation/ask/results.json` | per-question expected answer + verdict + failure class |
| `scripts/validation/ask-live-harness.mjs` | live end-to-end harness (built, not run) |
| `docs/validation/ask/ASK_VALIDATION_REPORT.md` | this report |
