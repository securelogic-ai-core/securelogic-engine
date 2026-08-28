# SEPT15 TRUTH LEDGER — read-only reconciliation, 2026-08-28

Reconciles every item the close-out report and the SEPT15-CLOSE-1 register called
open, blocking, carried or deferred against **current** truth. Nothing was
written, merged, promoted, flagged or reconfigured to produce this document.

**Evidence channels used today (2026-08-28 02:00–02:30Z):** local git on
`origin/develop` `679e6c2e` and `origin/main` `b916622d`; GitHub REST (issue/PR
state, repo visibility); Render CLI `services` / `deploys` / `logs` (read-only);
unauthenticated HTTPS probes of `api.securelogicai.com`, `app.securelogicai.com`,
`securelogicai.com`; `npm audit --omit=dev`.

**Evidence NOT available this session:** Render **env-var reads** were blocked by
the sandbox classifier. Every env-var value below is therefore either (a) proven
*behaviourally* by a live probe or log line, or (b) explicitly marked
`NOT RE-VERIFIED — register value 08-28 01:20Z`. No env value is asserted from
`render.yaml`. Authenticated production **database** reads remain operator-owed.

**Standing rule applied:** an old audit statement is not evidence. Five items the
close-out carried as open were closed days ago; three findings in this ledger
were discovered *today* and appear in no prior document.

---

## 0. Platform truth, verified today

| Fact | Value | Channel |
|---|---|---|
| `develop` | `679e6c2e` | git |
| `main` | `b916622d` | git |
| `main..develop` | 51 commits / 92 files | git |
| `develop..main` | 5 commits, **1 file** (`website/src/components/BriefSignupForm.tsx`) | git |
| Prod services | all 7 `live` on `b916622d`, autoDeploy **yes** | `render deploys list` |
| Staging services | `live` on `679e6c2e` (2026-08-28 00:19–00:21Z) | `render deploys list` |
| `securelogic-intelligence-api` | **suspended** | `render services` |
| `api.securelogicai.com/health` | 200 | probe |
| Prod VA engine routes | `/api/vendor-assurance/documents`, `/api/vendor-engagements`, `/api/vendor-portal/session` → **404** (dark) | probe |
| Prod pen-test route | `/api/pen-test-engagements` → **401** (live); miss-control → 404 | probe |
| Prod voice | `/api/ask/transcribe/status` → `{"configured":true}` — **Whisper is LIVE** | probe |
| Prod org data | posture snapshot 08-28 01:28Z: `domainCount 0`, `openFindingCount 0`, `overallScore null` | prod logs |
| Prod Stripe traffic | **zero** webhook events since 08-20 | prod logs |
| Prod errors | **zero** `level:error` in 48h | prod logs |

---

## 1. The ledger

| # | Item | First found | Fixed by | develop | prod | Current evidence (2026-08-28) | True status | Sept 15 | Oct 15 | Next action |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `BRIEF_ORG_ID` placeholder | 08-26 | operator env + pinned redeploy, 08-26 | n/a | ✅ | **Independent proof:** prod engine log `brief_signup_complete`, `organizationId:"72f015df-7e51-4ebb-b2bf-d132b5100786"`, 2026-08-26 15:28:16Z. A placeholder would have thrown `22P02`. | **FIXED — VERIFIED IN PROD** | none | none | none. Close-out resurfaced it from a memory line written *before* the fix. |
| 2 | Brief production signup | 08-26 | website deploy 08-26 + item 1 | — | ✅ | live chunk `page-fd876920…js` posts to `https://api.securelogicai.com`; no `localhost` in any website chunk; health 200; signup recorded (item 1) | **FIXED — VERIFIED IN PROD** | none | none | none |
| 3 | Brief / Resend delivery | 08-25 | domain verification restored 08-26 | — | ⚠️ | Domain send path works, **delivery does not look healthy**: prod Resend webhooks since 08-26 = **10 `email.sent`, 32 `email.delivery_delayed`, 2 `email.bounced`, 0 `email.delivered`**. Every event `senderEnvironment:"unknown"`, `wouldRejectUnderEnforcement:true` (shared staging/prod Resend credential). Prod has **no send-site logging at all** — 0 lines. Last `brief_send` event on record is still the **08-25 403 failure**. | **PARTLY FIXED — DELIVERY UNPROVEN. Re-scoped today.** | **REQUIRED** — the Brief is the wedge | required | 1) watch the 09-01 07:00Z cron for `sent ≥ 1`; 2) add send-site logging; 3) split the Resend credential per environment |
| 4 | `verifyJwt` no token-type check (#821) | 08-20 | none | ❌ | ❌ | `src/api/lib/jwt.ts:157–195` — verifies signature + `exp` only; no `typ`/purpose claim. `main` and `develop` **byte-identical**. Issue #821 **open**. Working branch is named `fix/jwt-token-type-boundary` and contains **no fix** (HEAD == develop). | **CONFIRMED OPEN — old, parked** | not exploitable today (1 org, no MFA population); XS fix | **REQUIRED** (ASVS V3) | B6 ruling → one-guard PR |
| 5 | Stripe webhook fail-open | 08-25 | none | ❌ | ❌ | **Re-scoped:** the claim is *fail-closed* (`stripeWebhook.ts:1444` → claim INSERT failure returns **500**, Stripe retries). The real defect: the id is claimed **before** processing, and a downstream throw hits the outer catch (`:1765`) which answers **200 `updated:false`** — so Stripe never retries *and* the id stays claimed, so a manual replay short-circuits as `idempotent_replay`. Zero prod Stripe traffic since 08-20. | **CONFIRMED OPEN — old, narrower than filed** | none (0 paying customers) | **BLOCKER** | B6 ruling → BILL-WH-1: release the claim on failure, or claim-on-success |
| 6 | DB pool unbounded | 08-24 | none | ❌ | ❌ | `src/api/infra/postgres.ts:50` and `:71` — `new Pool({ connectionString, ssl })`. No `max`, no `connectionTimeoutMillis` → pg defaults `max 10`, **timeout 0 = wait forever**. (Register's path `lib/postgres.ts` was wrong; file is `infra/`.) | **CONFIRMED OPEN — old** | none at 1 org | **BLOCKER** | B8 operator DB reads → R1-1 PR |
| 7 | Worker alert seams | 08-25 | none | ❌ | ❌ | 5 worker packages exist; **only 4 are Render services** (`delivery-worker` is not deployed standalone). Of the 4, only `intelligence-worker` imports `sendFailureAlert`. **New today:** prod `data-rights-worker` has emitted **0 log lines in 31h** and has no periodic liveness tick — healthy-and-idle is indistinguishable from dead, from outside, with no alert path. | **CONFIRMED OPEN — old; new live evidence** | needs written acceptance (B11) | **BLOCKER** (C8) | one helper + 3 call sites, plus a liveness tick for data-rights |
| 8 | `NEXT_PUBLIC_ENGINE_URL` / SSO | 08-26 | none | n/a | ❌ | **Reproduced live today:** prod chunk `/_next/static/chunks/app/login/page-eca125a7905baa72.js` contains `localhost:4000`. SSO-only blast radius; password login unaffected. | **OPERATOR ACTION — CONFIRMED LIVE** | none unless SSO advertised | BLOCKER if SSO sold | set the key, **rebuild** the app (baked at build time) |
| 9 | Repository visibility | 08-25 | none | — | — | GitHub REST, authenticated: `securelogic-ai-core/securelogic-engine` → `"private": false`, `"visibility": "public"`. | **OPERATOR ACTION — CONFIRMED** | **BLOCKER** (GTM) | BLOCKER | privatise, or ratify intentional-public + LICENSE + secret scrub |
| 10 | `findingEntitySearch` misses CUEC findings | 08-22 | none | ❌ | n/a (VA dark) | `findingEntitySearch.ts:78–90` — `ASSESSMENT_SOURCES.vendor` = `vendor_assessments` + `vendor_reviews` only. Does not consume `vendorFindingLinkage.ts` (which 3 other files do). | **CONFIRMED OPEN — latent** (0 promoted CUECs anywhere) | none (VA dark) | REQUIRED if VA sold | rewire to `vendorFindingLinkage` |
| 11 | `evidence.ts` `source_record_not_found` | 08-22 | none | ❌ | n/a | `evidence.ts:71/279/287` resolves `vendor_review → vendor_assessments`. **Two rulings on record contradict each other:** the source-id canon says the CUEC producer (`vendorAssuranceDocuments.ts:1672`, writes `vendors.id`) is wrong; `vendorFindingLinkage.ts`'s header says the producer must **not** be changed. | **CONFIRMED OPEN — latent; needs a RULING, not a patch** | none | REQUIRED if VA sold | rule: fix the producer, **or** mint a distinct `vendor_cuec` source_type (the `20260928` precedent) |
| 12 | `open_findings` semantic collision | 08-27 | none | ❌ | ❌ | `vendors.ts:514` counts `f.status='open'` as `open_findings_count`; `:667` counts `operational_status <> 'closed'` as `open_findings`. Same word, two populations, two live surfaces. | **CONFIRMED OPEN — new, deferred by design** | none | hardening | naming decision, then rename |
| 13 | Observation seen-window race (#892) | 08-27 | **#892 merged 2026-08-28 00:17Z** | ✅ | ❌ | merged PR confirmed via GitHub; fix + `vulnerabilityScanIngestion.test.ts` present on develop, absent from main | **FIXED IN CODE — NOT PROMOTED** | none | none | rides the next promotion |
| 14 | #889 Brief signup copy | 08-26 | **merged to `main` 2026-08-26 18:11Z** | ❌ | ✅ | reverse divergence is exactly 1 file | **FIXED IN PROD — owed onto develop** | none | none | cherry-pick `4a2627d5` before the next promotion |
| 15 | #886 env-label inconsistency | 08-25 | none | ❌ | ❌ | **Confirmed and WIDER than filed.** Staging engine logs `"env":"production","appEnv":"staging"`. All prod workers log `"service":"securelogic-engine"` (wrong service name) and `"appEnv":null`. Issue open. | **CONFIRMED OPEN — P2, larger scope** | none | hardening | fix env + service identity across all services |
| 16 | #254 template `source_regulation` | **06-23** | PR #254 open, unmerged | ❌ | ❌ | `templateLoader.ts:233` INSERT columns = `organization_id, title, description, jurisdiction, priority, template_source` — **`source_regulation` is never written**, so template obligations score 0 in the matcher. | **CONFIRMED OPEN — 2 months, never closed** | none | hardening | rebase + merge #254, or close with a ruling |
| 17 | VA UI-honesty | 08-27 | none | ❌ | ❌ | **On `main` (what prod runs):** `navigation.ts:123` and `:229` — `{ type:"group", label:"Vendor Assurance", platform: true }` with **no `featureFlag`**, in *both* nav models. Pages exist and are platform-gated; every prod VA **engine** route 404s (probed). A platform-tier user sees three nav entries whose data can never load. | **CONFIRMED OPEN — new, live in prod today** | **REQUIRED** — a design partner clicks it on day one | — | flag-gate the nav group; declare the VA flag on the app services |
| 18 | Pre-PEN-FLAG production gap | 08-27 | PEN-FLAG-1 (#890) merged develop 08-27 | ✅ | ❌ | prod `/api/pen-test-engagements` → **401** (route live) vs 404 route-miss control | **FIXED IN CODE — NOT PROMOTED** | none (only org is premium) | — | rides the next promotion, or accept live |
| 19 | PLATFORM-R1 (13 items) | 08-24 | none merged | ❌ | ❌ | `docs/investigation/platform-operations-security-scale-audit.md` §R1; R1-1 == item 6 | **CONFIRMED OPEN — program** | R1-1 only | **BLOCKER** (C8 slice) | R1-1 → R1-2 → R1-6 → R1-3 → R1-4 |
| 20 | ZAP / Burp (SECURITY-VALIDATION-1) | planned 08-25 | not started | — | — | no artifact in `docs/validation/`. Prerequisite **SEC-APP-1 unmet**: `app/` prod deps = **6 HIGH + 3 moderate** (`next`, `postcss` direct; `sharp`, `nanoid`, `fast-uri`, `brace-expansion` transitive). Root = 0; all 5 worker packages = 0. | **NOT STARTED** | **BLOCKER** (B14 + B7) | BLOCKER (C3) | SEC-APP-1 → freeze staging → run the DAST sequence |
| 21 | B.3 independent portal security review | 08-13 | — | — | — | gate doc: **"NOT SATISFIABLE HERE"**; no reviewer named; gate docs untouched since 08-16 | **HUMAN VALIDATION GATE** | blocks **portal only** | BLOCKER if portal sold | name a reviewer; staging portal is live for it |
| 22 | B.4 external staging tester | 08-13 | — | — | — | gate doc: **"NOT SATISFIABLE HERE"**; prerequisite met since 08-13 | **HUMAN VALIDATION GATE** | portal only | BLOCKER if portal sold | invite one external tester through staging |
| 23 | A.5 Stop Gate A sign-off | 08-13 | — | — | — | A.1–A.4 **PASS**; A.5 **"NOT SATISFIABLE HERE — operator-owned"** | **HUMAN VALIDATION GATE** | blocks VA activation | BLOCKER if VA sold | same reviewer as B.3 |
| 24 | A.6 ASK-A sign-off | 08-13 | — | — | — | A.1/A.3/A.4/A.5 **PASS**; A.6 operator-owned. **New today:** **A.2 (contributor-seat scoping) is DEFERRED and carried as an explicit P0 before Contributors are enabled — and `SECURELOGIC_SEAT_MODEL_ENABLED` is `true` in prod.** | **HUMAN VALIDATION GATE + a carried P0** | blocks Ask tool-path activation | BLOCKER | sign A.6; close A.2 before any Contributor seat |
| 25 | C-6 Whisper subprocessor / DPA | 08-13 | — | — | ⚠️ LIVE | **Upgraded from inference to proof:** prod `/api/ask/transcribe/status` returns `{"configured":true}`, which is `OPENAI_API_KEY set && askVoiceEnabled()`. **Production is transcribing audio through OpenAI Whisper today**, with the DPA/subprocessor sign-off unrecorded. | **HUMAN GATE — and prod is already live on it** | **REQUIRED**: sign, or set `SECURELOGIC_ASK_VOICE_ENABLED=false` in prod | BLOCKER (LEGAL-DPA-1) | owner decision this week |

### Items in neither the close-out nor the register

| # | Item | Evidence | Status | Impact | Next |
|---|---|---|---|---|---|
| 26 | SEC-APP-1 — `app/` ships 6 HIGH advisories | `npm audit --omit=dev` today | **OPEN — old (08-24)** | Sept 15 REQUIRED (DAST re-reports it) | `npm audit fix` (no majors), rebuild staging |
| 27 | #855 VA-3 — a clean SOC 2 fails to extract | PR **open** since 08-21 | **OPEN** — core VA workflow defect | blocks VA activation | reconcile onto develop, merge |
| 28 | Prod vendor-extraction worker flag key misspelled `…_ENABLE` | register 08-28 01:20Z; **NOT re-verified** (env reads blocked) | **OPERATOR — unconfirmed today** | blocks VA activation | live detection signal: `vendor_extraction_worker_disabled_skip` must stop when VA is turned on |
| 29 | Staging `BRIEF_ORG_ID` placeholder | register 08-28; **NOT re-verified** | OPERATOR — P3 | none | fold into the env pass |
| 30 | `securelogic-intelligence-api` dead | `render services`: **suspended** | dead service | none | delete |
| 31 | Prod has **zero** outbound-email send-site logging | 0 matching log lines across 6 patterns | **NEW — found today** | Brief delivery is unfalsifiable from prod | log every send attempt with outcome |
| 32 | Prod/staging share one Resend credential; prod cannot attribute its own mail | every webhook `senderEnvironment:"unknown"`, `wouldRejectUnderEnforcement:true` | **OPEN — old defect, new proof** | Sept 15 required for Brief truth | separate credentials per environment |

---

## 2. Contradictions resolved

- **Close-out vs live config (items 1–2).** Both were closed by the operator on 08-26. The close-out reused memory-index lines written on 08-25 and never re-read Render, Resend or the live chunk. **Process defect, not a platform defect.**
- **"Resend failing" vs "domain verified" (item 3).** Both were true at different times. Today the *domain* is fine and the *delivery outcome* is not — a third state neither prior document had.
- **Stripe "fail-open" (item 5).** Half-right. The idempotency claim is fail-closed; the outer catch is fail-open. The fix is narrower than the register implied.
- **Stop Gate B "NOT PASSED" vs "no leakage found".** Consistent: B.1/B.2/B.5/B.6/B.7 PASS on engineering criteria; B.3/B.4 are human records never produced. The gate is **incomplete**, not failed.
- **CUEC source_id (item 11).** Two governing statements genuinely conflict. This is a decision, not a bug fix.
- **"Pen-test is dark until its flag" (item 18).** False in prod today — the API is live; the flag exists only on develop.
- **"develop is ahead of main"** is *not* a defect and is not counted as one anywhere above.

---

## 3. Classification

| Class | Items |
|---|---|
| **Stale — already fixed** | 1 `BRIEF_ORG_ID`, 2 Brief signup, 3 Resend *domain*, 13 #892 (code), 14 #889 (prod) |
| **Old and still open** | 4 verifyJwt (8d), 5 Stripe (3d), 6 pool (4d), 7 alert seams (3d), 9 repo public (3d), 8 SSO env (2d), 26 SEC-APP-1 (4d), 27 #855 (7d), 16 #254 (**2 months**), 32 Resend credential sharing |
| **New from the Aug 20–28 train** | 10/11 CUEC consumers (latent), 12 `open_findings`, 17 VA UI-honesty, 18 pen-flag gap (closed in code), 13 #892 (closed) |
| **New — discovered by this reconciliation, today** | 3 deliverability signal (0 delivered / 32 delayed / 2 bounced), 31 no send-site logging, 7 data-rights 31h silence, 15 #886 wider than filed, 24 ASK-A A.2 is a carried P0 with the seat model ON, 11 two contradictory rulings |

**Programme reading.** The integration train introduced few defects and closed the
two that mattered. The accumulation is in two places: **parked hotfixes waiting on
one owner ruling (B6)**, and **operator configuration that `render.yaml` declares
but the live services never received**.

---

## 4. Direct answers

1. **Genuine P0s open today — 4.** Engineering: `verifyJwt` (#821), Stripe fail-open, DB pool. Operator: repository public. *None is currently impacting: prod holds 1 org, 0 findings, 0 Stripe traffic, 0 errors in 48h.* **C-6 becomes the 5th the day a design partner logs in** — prod is transcribing audio today.
2. **Genuine P1s open today — 9.** Engineering (7): worker alert seams + data-rights liveness, SEC-APP-1, VA UI-honesty nav, CUEC-1, CUEC-2, #855, send-site email logging. Operator (1): `NEXT_PUBLIC_ENGINE_URL` + rebuild. Human (1): C-6.
3. **Stale / already resolved — 5:** `BRIEF_ORG_ID`, Brief production signup, Resend domain verification, #892, #889. The close-out was also **incomplete**: it omitted SEC-APP-1, VA UI-honesty, #855, #254, the pen-flag gap and the worker flag key.
4. **Newly discovered — 8.** Five found today (deliverability signal, no send-site logging, data-rights silence, #886 scope, ASK-A A.2 / seat-model interaction — plus the contradictory CUEC rulings); three from the train (`open_findings`, VA UI-honesty, pen-flag gap).
5. **Require engineering — 12:** verifyJwt · Stripe · pool · alert seams + liveness · SEC-APP-1 · VA nav gate · CUEC-1 rewire · CUEC-2 (after a ruling) · #855 · #254 · #889 cherry-pick · send-site email logging. (Then #886 and the `open_findings` rename as hardening, and the execution of SECURITY-VALIDATION-1.)
6. **Require operator action only — 7:** repository visibility · `NEXT_PUBLIC_ENGINE_URL` + app rebuild · vendor-extraction worker flag key · staging `BRIEF_ORG_ID` · delete `securelogic-intelligence-api` · B8 DB reads (`max_connections`, peak activity) · separate Resend credentials per environment.
7. **Require human validation only — 5:** B.3, B.4, A.5, A.6, C-6.
8. **What prevents Vendor Assurance activation today:** A.5 sign-off (human) · **#855 — a clean SOC 2 cannot extract, so the core workflow is broken** · the VA nav honesty fix · the vendor-extraction worker flag key · CUEC-1/CUEC-2 (latent at 0 rows, real the moment a CUEC is promoted) · the legacy-writes demotion decision · the VA-3 staging exercise. **Not** B.3/B.4 — those are portal gates.
9. **What prevents Vendor Portal activation today:** B.3 + B.4 (human, never produced) · prod R2 credentials for uploads · the AI1-7 injection-boundary test · VENDOR-PORTAL-1. Prod portal routes 404 today (verified); staging is live for B.3/B.4.
10. **What prevents read-only Ask activation today:** A.6 sign-off (human) · an activation decision for `ASK_TOOLS` + `ASK_PROVENANCE` (both 404 in prod today, verified) · no per-org LLM spend ceiling (AI1-2) · **A.2 contributor-seat scoping, a carried P0, with the seat model already ON in prod**. ASK-A/ASK-B engineering criteria pass.
11. **What prevents the Sept 15 design-partner launch today:** repository visibility · SECURITY-VALIDATION-1 not run (SEC-APP-1 is its prerequisite) · the **B6 ruling** on the three parked P0s (fix, or accept in writing) · VA UI-honesty live in prod · C-6 with voice **proven live** · **Brief delivery unproven since the 08-25 failure, with a negative deliverability signal today** · copy-truth B9 and a named reviewer B10.
12. **What prevents the Oct 15 commercial launch today:** everything in 11, **plus** Stripe fail-open and the DB pool as commercial P0s · BCDR timed restore rehearsal · M-1 `app_request` flip after a ≥7-day soak · SV-1 remediation closed + regression · IR-LIVE-1 · LEGAL-DPA-1 / ASSURE-1 · data lifecycle (E-2 / TDG / VA-ERASE-1) · enforced SDLC (SEC-GATE-1, SEC-BRANCH-1, Node 22, CI-COVER-1) · the PLATFORM-R1 October slice · PLATFORM-AI1 · E-3 per-org gates · DB-NET-1 · and the portal / SSO packages if either is sold.

---

## 5. SEPT 15 — true remaining work, strict priority

1. **REPO-VIS-1** — owner ruling. Operator, minutes, unblocks GTM copy.
2. **B6 ruling** — fix or accept in writing: SEC-TOKEN-1 (`verifyJwt`), BILL-WH-1 (Stripe), R1-1 (pool, after B8 reads). If *fix*: three XS PRs.
3. **C-6 decision** — sign the Whisper subprocessor terms, **or** set `SECURELOGIC_ASK_VOICE_ENABLED=false` in prod today. Production is transcribing now.
4. **SEC-APP-1** (`app` 6 HIGH) → rebuild staging → **SEC-GATE-1**.
5. **SECURITY-VALIDATION-1** on the frozen staging candidate; P0/P1 into the Findings lifecycle and closed before promotion.
6. **VA UI-honesty** — flag-gate the Vendor Assurance nav group; declare the flag on the app services.
7. **Brief delivery truth** — add send-site logging; split the Resend credential per environment; watch the 09-01 07:00Z cron for `sent ≥ 1`; alert-path smoke (B11); add a liveness tick to `data-rights-worker` or accept the seam gap in writing.
8. **ENV-DRIFT-1 operator pass** — `NEXT_PUBLIC_ENGINE_URL` + **rebuild**, vendor-extraction flag key, staging `BRIEF_ORG_ID`, `APP_ENV`, delete the dead intelligence-api service.
9. **Release candidate** — cherry-pick `4a2627d5` (#889) onto develop; rule on pen-test live-vs-gated; construct the RC deliberately.
10. **Copy truth (B9), named reviewer (B10), sealed secrets export (B4).**

## 6. OCT 15 — true remaining work

1. SV-1 remediation closed + regression scan (C3).
2. BCDR-1 timed restore rehearsal; RPO/RTO from measurement (C1).
3. M-1 `app_request` flip after a ≥7-day staging soak (C2).
4. BILL-WH-1 (Stripe) and R1-1 (pool) if not taken at B6.
5. PLATFORM-R1 October slice: R1-2 / R1-6 / R1-3 / R1-4 / R1-5, plus dead-letter alerting and the worker alert seam (C8).
6. LEGAL-DPA-1 / ASSURE-1; C-6 sign-off if deferred.
7. Data lifecycle: E-2 Increment 4 or an "erasure unavailable" disclosure; TDG activation; VA-ERASE-1 before the first external vendor (C6).
8. Enforced SDLC: SEC-GATE-1, SEC-BRANCH-1, RUNTIME-NODE-22, CI-COVER-1 (C7).
9. PLATFORM-AI1 re-scoped (AI1-0/7/8/1/2) (C9); E-3 per-org gates (C10); DB-NET-1 / ADMIN-ACCESS-CF-1 (C11).
10. If sold: VENDOR-PORTAL-1 + B.3/B.4 (C12); SSO-GA-1 + the SSO env fix (C13). Then the CUEC ruling + producer fix + search rewire, #855, the #254 ruling, the `open_findings` rename, and #886.
