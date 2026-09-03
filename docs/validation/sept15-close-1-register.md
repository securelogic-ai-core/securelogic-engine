# SEPT15-CLOSE-1 — Launch Blocker Remediation Register

Working register for the launch-blocker remediation program. Revalidated
live (Render API + GitHub API + unauthenticated probes), not inferred from
IaC or prior notes. Every row carries the date it was last verified.

## 0. Current truth (verified 2026-08-28 01:20Z)

| Item | State | Evidence |
|---|---|---|
| `develop` | `679e6c2e` — CI run 33129252005 **green** | GitHub API `actions/runs?head_sha=` |
| `main` (prod) | `b916622d`; `main..develop` = 51 commits | `git rev-list --count` |
| Prod services | all 7 live on `b916622d` (engine 19:15Z, app 20:10Z 08-26); autoDeploy=yes | Render `/deploys?limit=1` |
| Staging services | all on `679e6c2e` (deployed 00:18–00:21Z today) | Render `/deploys` |
| Demo | app `98e97098`, engine `011e1f1d`, autoDeploy=no | Render |
| `securelogic-intelligence-api` | suspended, last deploy 2026-05 `update_failed` — dead service | Render |
| Prod `BRIEF_ORG_ID` | `72f015df-7e51-4ebb-b2bf-d132b5100786` (canonical Brief org) — **FIXED 08-26** | Render env-vars |
| Prod Brief signup | website chunk posts to `https://api.securelogicai.com`; `/health` ok; real signup proven 08-26 | live chunk + memory |
| Resend | domain `securelogicai.com` **verified** (us-east-1); inbound webhooks arriving in prod today | Resend `/domains`, prod logs |
| Prod app SSO | `NEXT_PUBLIC_ENGINE_URL` **absent**; login chunk contains `localhost:4000` → SSO dead, password login fine | live chunk + env-vars |
| Repo visibility | **PUBLIC** — both `securelogic-ai-core/…` and `SecureLogic-AI/…` | GitHub API unauth 200 |

### Capability flags (live, not render.yaml)

| Flag | Prod engine | Staging engine | Code default (prod) |
|---|---|---|---|
| `SECURELOGIC_VENDOR_ASSURANCE_ENABLED` | **false** | true | off in production |
| `SECURELOGIC_VENDOR_PORTAL_ENABLED` | unset → off | true | off everywhere |
| `SECURELOGIC_ASK_TOOLS_ENABLED` | unset → off (legacy snapshot Ask) | true | off |
| `SECURELOGIC_ASK_PROVENANCE_ENABLED` | unset | true | — |
| `SECURELOGIC_ASK_STREAMING_ENABLED` | unset → off | true (engine + app) | off |
| `SECURELOGIC_ASK_ACTIONS_ENABLED` / `_GOVERNED_` | unset → off | true / true | off |
| `SECURELOGIC_ASK_VOICE_ENABLED` (push-to-talk) | unset → **ON** (`!== "false"`) | on | on |
| `SECURELOGIC_ASK_VOICE_REALTIME_ENABLED` | unset → off | true (engine + app) | off |
| `SECURELOGIC_LEGACY_VENDOR_WRITES_ENABLED` | unset → on (legacy writers live) | false | on |
| `SECURELOGIC_SEAT_MODEL_ENABLED` | true | true | — |
| Prod app workspace flags (`RISK_WORKSPACE`, `DECISION_WORKSPACE`, …) | all false | true | — |

Prod vendor-extraction worker carries `SECURELOGIC_VENDOR_ASSURANCE_ENABLE=true`
(key misspelled, missing `D`) — inert today because VA is dark, but the worker
will idle-skip forever when VA is activated unless the key is corrected.

## 1. Defect register

| ID | Defect | Class | Status | Verified |
|---|---|---|---|---|
| JWT-1 | `verifyJwt` accepts any signed, unexpired payload — no token-type check; MFA-challenge tokens satisfy `requireAuth` structurally | P0 security | **OPEN** — Phase 1 | 08-28 (`src/api/lib/jwt.ts:157-195`) |
| STRIPE-1 | webhook claims event id before processing; outer catch returns 200 (fail-open) → no retry, no reconciliation | P0 billing truth | OPEN — Phase 2 | 08-25 audit |
| POOL-1 | `connectionTimeoutMillis: 0` — pool exhaustion is an infinite hang | P0 availability | OPEN — Phase 3 | 08-24 audit |
| CUEC-1 | `findingEntitySearch.ts` vendor-name search misses CUEC-promoted findings | P1 | OPEN — Phase 4 | #862/#863 residuals |
| CUEC-2 | `evidence.ts` returns `source_record_not_found` attaching evidence to a CUEC-promoted finding | P1 | OPEN — Phase 4 | #862/#863 residuals |
| ALERT-1 | posture / data-rights / vendor-extraction workers have no alert seam | P1 ops | OPEN — Phase 5 | 08-25 audit |
| SSO-1 | prod app bundle bakes `localhost:4000` (`NEXT_PUBLIC_ENGINE_URL` unset); needs env + rebuild | P1 prod config | OPEN — Phase 6 (operator env + redeploy) | 08-28 |
| REPO-VIS-1 | both repository copies public | P0 GTM | OPEN — operator | 08-28 |
| VAW-1 | prod vendor-extraction worker flag key misspelled `…_ENABLE` | P2 latent | OPEN — Phase 6 (operator env) | 08-28 |
| BRIEF-1 | prod `BRIEF_ORG_ID` placeholder | P0 | **CLOSED 08-26** (stale in 08-28 close-out report; corrected here) | 08-28 |
| RESEND-1 | "domain verification failing" | P1 | **CLOSED — stale**: domain verified, webhooks flowing | 08-28 |
| RACE-1 | vuln observation seen-window race reddening `cross-org-isolation` | P1 CI | **CLOSED** — #892 merged, develop green | 08-28 |
| STG-BRIEF | staging `BRIEF_ORG_ID` = placeholder → staging signup 500s | P3 | OPEN — cosmetic to launch; fix with SSO-1 env pass | 08-28 |

## 2. Gate register

| Gate | Status | Owner |
|---|---|---|
| Stop Gate A (isolation) | DB-layer PASS; A.5 human review open | operator |
| Stop Gate B (portal trust boundary) | 5/7 engineering PASS; **B.3 + B.4 open, running in parallel as operator activities** | operator |
| ASK-A | engineering PASS; A.6 review open | operator |
| ASK-B | engineering PASS (B-1…B-8) | — |
| ASK-C | engineering PASS; C-6 Whisper DPA open | operator |
| LLM-independence | PASS | — |
| Sept 1 security validation (ZAP / Burp / CI scanning) | NOT STARTED — Phase 9 | eng + operator |
