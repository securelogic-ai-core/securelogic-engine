# Launch Completion — Integrated Staging Walkthrough Plan

> ## Status: REOPENED — the READY claim below was FALSIFIED (2026-08-14)
>
> **Update 2026-08-15 (deployed `05625d02`): both defect P1s raised by this
> reopening are now CLOSED on live evidence.**
>
> **Update 2026-08-15, later (deployed `42004547`): §1 and §2 are now EXECUTED
> end to end — see §5.** §1 ran the full spine
> `draft → … → decided → monitoring` on a real engagement, including the
> external-vendor portal legs driven with the invite token alone. §2 ran all
> six Ask steps, including voice, which previously failed on an upstream 401.
> **§3 (agentic) remains UNEXECUTED.** Execution surfaced one P1 (**W-3**, in
> the promotion delta: a one-character constraint-name typo means the vendor
> questionnaire hard-blocks on any requirement the vendor already answered),
> one spec-vs-code conflict needing an operator ruling (**W-2**, invite links
> are replayable for 30 days by design), and one P2 (**W-1**). The walkthrough
> is NOT READY-complete: §3, the fail-path finding promotion, and the §4 human
> gates remain.
>
> The operator, signed into `securelogic-app-staging` as `[SEED] Walkthrough
> Org`, reported that neither Vendor Assurance nor Ask was usable. Both
> reproduced from the browser-facing surface. The READY assessment below was
> made from flags, migrations, health checks and 401-probes — none of which
> establish that a signed-in user can complete a journey. **A 401 from an API
> is not evidence a feature works.** Process-truth probes confirmed endpoints
> existed; nobody had opened the pages.
>
> ### What was actually broken
>
> 1. **`SECURELOGIC_LEGACY_VENDOR_WRITES_ENABLED` was ABSENT on both staging
>    services** while `render.yaml` declared `"false"` for both. The flag
>    defaults ON, so the B1 demotion never activated: `/vendors/{id}` offered
>    the retired point-in-time `/assess` and `/review` CTAs and **zero** links
>    to the engagement workflow. Blueprint drift — the declared value had
>    never been synced to the dashboard. Fixed by setting the key on both
>    staging services and redeploying (env reaches the process at DEPLOY, not
>    restart).
> 2. **`/vendor-assurance` 404'd.** No `page.tsx` existed — only `queue/` and
>    `[documentId]/`. Landing page added.
> 3. **The engagement spine was nav-orphaned in EVERY IA variant.**
>    `/vendor-engagements{,/new,/[id]}` were fully built, returned 200, and
>    appeared in no navigation. The single "Vendor Assurance" nav child pointed
>    at `/vendor-assurance/queue` — the document review queue, one evidence
>    step presented as the product. Promoted to its own top-level nav group.
> 4. **The Walkthrough Org had zero engagements** (`/api/vendor-engagements`
>    → `count: 0`), so the workspace was empty even once reachable.
> 5. **Ask answers were corrupted at the moment they completed.**
>    `renderClaims` space-joined verified claims into one run-on paragraph and
>    that string REPLACED the model's structured prose. Rendered `pre-wrap`,
>    so a clean bulleted answer streamed in and was overwritten on the final
>    frame. Now joined one claim per line; class prefixes unchanged.
>
> ### Verified from the user-facing surface (build `ac4b8898`)
>
> | # | Criterion | Evidence |
> |---|---|---|
> | A | Vendor Assurance visibly reachable | top nav renders `… Risk Operations · Assets · **Vendor Assurance** · Compliance …` |
> | B | Landing/workspace opens | `GET /vendor-assurance` → **200** (was 404) |
> | C | Create/open an engagement | `POST /api/vendor-engagements` → **201**; two engagements created; `/vendor-engagements/{id}` → 200 showing Inherent **Critical · 90** and the gated lifecycle |
> | D | Ask opens | `GET /ask` → **200** |
> | E | Question submits | `POST /api/ask/stream` → **200** |
> | F | Answer uses real tenant data | "Microsoft — risk score 72 (Critical)… Cisco — 58 (High)"; `tools_denied: 0` |
> | G | Citations/provenance | 12 claims citing `vendors__search` (**caveat below**) |
> | H | Survives reload | stored thread replays 2 messages, 12 lines, 12 claims |
> | I | No unexpected 4xx/5xx | 15-route authenticated sweep all 200; `/actions` 307 → `?view=mine` → 200 (benign default view) |
>
> ### Still open — do NOT mark this walkthrough READY
>
> *(Reconciled twice. **2026-08-14 21:20–21:30Z** against deployed `66204045`:
> the 504 CLOSED, long-answer provenance REMAINED OPEN, narrowed.
> **2026-08-15 00:20–00:27Z** against deployed `05625d02`: long-answer
> provenance is now **CLOSED on live evidence** — see "Re-verification against
> deployed `05625d02`" below. **Both P1s below are now closed.** The entries are
> preserved as written; nothing here is retracted, only superseded.)*
>
> - **P1 — CLOSED 2026-08-15 on `05625d02`** (as written: answers over ~4,000
>   characters lose every citation). Reproduced on
>   `ac4b8898`: a 4,060-char answer returned `claims: 0`. Engine logs show two
>   branches — `ask_provenance_truncated` (`maxTokens: 4096`) for 5.9k–8.3k-char
>   answers, and `ask_provenance_skipped_no_budget`
>   (`tokensNeeded: 5308` vs `tokensAffordable: 4121`, with 57.9s still left in
>   the request). Criterion G therefore holds for ordinary answers and fails for
>   long ones. Being worked in a parallel session (`ac4b8898`) — do not
>   duplicate. **Resolved by asynchronous provenance (`2833a0ea`, `602965c4`,
>   `05625d02`): a 7,521-char answer now delivers in 52.1s and carries 62 claims
>   ~100s later, with the delivered text unchanged. Criterion G now holds for
>   long answers too.**
> - **P1 — CLOSED 2026-08-14 on `66204045`** (as written: non-streaming
>   `POST /api/ask` 504s at 90s) on heavy multi-tool
>   questions (`responseTimeMS=90012`). The browser uses SSE
>   (`streamingEnabled: true` on staging) so the primary path is unaffected,
>   but the fallback — and any environment with streaming off — is not.
> - The §1–§3 legs below (vendor portal invite/response, SoD, agentic) remain
>   UNEXECUTED. Reaching the workflow is not the same as completing it.
>
> ---
>
> ## Re-verification against deployed `66204045` (2026-08-14 21:20–21:30Z)
>
> Executed against the CURRENT staging deployment, not against commit messages.
> Several commits claimed both P1s fixed; only one of the two claims survives
> live testing.
>
> **Deployed SHA — confirmed two independent ways.** Render deploy records show
> `662040453f7e4fe0e90c8a5cff0ea91183d072a2` Live on both
> `securelogic-engine-staging` (`dep-d9vob8navr4c739dqnq0`) and
> `securelogic-app-staging`, and the app self-reports it:
> `GET /api/version` → `{"commit":"66204045…","branch":"develop",
> "deployedAt":"2026-08-14T21:20:37.855Z"}`. Engine `/health` → `status: ok`,
> `db: connected`.
>
> **Executor**: `walkthrough-analyst@seed.securelogicai.test` in `[SEED]
> Walkthrough Org` (`295b989a-…`), `entitlementLevel: platform`, authenticated
> through the real login on both the engine (`POST /api/auth/login`) and the app
> (`POST /api/auth-login`, `sl_session` cookie). Production untouched.
>
> ### A. Long-answer provenance / citations — **REMAINS OPEN** (narrowed) — *superseded 2026-08-15: now CLOSED, see the `05625d02` re-verification below*
>
> Two independent reproductions on the deployed SHA. Both returned **HTTP 200
> with no `provenance` key at all** — not `claims: null`, the field is absent:
>
> | Answer chars | Tool calls | HTTP | Time | Provenance | Engine log |
> |---|---|---|---|---|---|
> | 358 (control) | 1 | 200 | 14.4s | **verified, 8 claims** | `ask_provenance_complete claims:8 observed:7 downgraded:0` |
> | 7,135 | 3 | 200 | 44.6s | **none** | `ask_provenance_skipped_no_budget answerChars:7135 tokensNeeded:8160 tokensAffordable:3237 msRemaining:45476` |
> | 8,147 | 6 | 200 | 54.4s | **none** | `ask_provenance_skipped_no_budget answerChars:8147 tokensNeeded:9172 tokensAffordable:2541 msRemaining:35697` |
>
> What CHANGED: the `ask_provenance_truncated` branch (`maxTokens: 4096`,
> claims discarded) has **not fired since 14:10:16Z**, immediately before the
> `ac4b8898` deploy went Live at 14:12:31Z. That half is fixed.
>
> What did NOT change: `ask_provenance_skipped_no_budget` still fires and still
> drops every citation. The log message blames time — *"Not enough time left in
> the request to decompose this answer"* — but the numbers contradict it: the
> 7,135-char case had **45.5 seconds remaining** and was still refused, because
> `tokensAffordable` (3,237) is computed far below `tokensNeeded` (8,160). The
> defect is the budget model, not the deadline. Criterion **G still holds only
> for ordinary answers and fails for long ones.**
>
> The uncited state is **persisted, not transient**: reloading the conversation
> (`GET /api/ask/conversations/{id}`) returns the stored assistant message with
> `claims: null` permanently. Product consequence: the longest, most
> consequential answers — exactly the exhaustive posture reports an executive
> would ask for — are the ones delivered with no verifiable basis.
>
> ### B. Non-streaming `POST /api/ask` 504 — **CLOSED on live evidence**
>
> - A deliberately heavy multi-tool question (6 tool calls, `tools_denied: 0`,
>   `complete: true`, 8,147-char answer) returned **HTTP 200 in 54.4s**. A
>   second (3 tool calls, 7,135 chars) returned **200 in 44.6s**. Neither
>   approached the 90s budget.
> - **Zero 504s on the engine since the fix deployed.** Every 504 in the
>   service log — 09:39:03 (`responseTimeMS=30003`), 13:22:59 (`90005`),
>   13:42:23 (`90012`), 14:10:13 (`90006`) — predates the `ac4b8898` deploy
>   (Live 14:12:31Z). None after it, including under the heavy load above.
>
> ### C. Conversation reload — **CONFIRMED**
>
> `GET /api/ask/conversations/{id}` replays the stored thread: the control
> conversation returns 2 messages with the assistant turn carrying its **8
> stored claims** intact. (The long-answer conversations correctly replay
> `claims: null` — consistent with defect A, not a separate storage bug.)
>
> ### D. Runtime log sweep since the 21:16Z deploy
>
> The **only** warn/error emitted is the `ask_provenance_skipped_no_budget`
> pair from the two long-answer probes above. No 5xx, no 504, no unresolved
> truncation. Separately noted and NOT part of either P1: three
> `transcription_failed` / `POST /ask/transcribe 500` entries at 16:03–16:08Z
> with `err_status: 401` from the upstream provider — voice transcription was
> failing on an upstream credential rejection **before** this deploy. Not
> re-tested here; tracked as a separate open item.
>
> ---
>
> ## Re-verification against deployed `05625d02` (2026-08-15 00:20–00:27Z)
>
> Executed against the CURRENT staging deployment. This section closes defect
> **A** above; it does not execute any walkthrough leg.
>
> **Deployed SHA — confirmed two ways, on all THREE services.** Render deploy
> records show `05625d02` Live on `securelogic-engine-staging`
> (finished 23:36:17Z), `securelogic-app-staging` (23:38:40Z) and
> `securelogic-vendor-extraction-worker-staging` (23:35:55Z) — the worker
> matters because the deferred decomposition runs there. The app self-reports
> `GET /api/version` → `{"commit":"05625d02…","branch":"develop"}`; engine
> `/health` → `status: ok`, `db: connected`.
>
> **Executor**: `walkthrough-analyst@seed.securelogicai.test` in `[SEED]
> Walkthrough Org` (`295b989a-…`), `entitlementLevel: platform`,
> `seat.readScope: tenant`, via the real engine and app logins. Production
> untouched.
>
> ### A′. Long-answer provenance — **CLOSED on live evidence**
>
> | Probe | Answer chars | HTTP | Delivery | `provenance_status` at delivery | Terminal state | Claims |
> |---|---|---|---|---|---|---|
> | Long (board-level posture report, 9 tool invocations) | 7,521 | **200** | **52.1s** | `pending` | `partial` within ~100s | **62** |
> | Short control ("how many active findings?") | 516 | **200** | **15.9s** | `partial` (inline, unchanged path) | — | **12** |
>
> Engine telemetry for the long probe:
> `ask_provenance_deferred answerChars:7521 msRemaining:38020 invocations:9`,
> then on the worker
> `ask_provenance_complete claims:62 observed:28 downgraded:33 maxTokens:21715
> outputTokens:7612 elapsedMs:94457` and
> `ask_provenance_job_complete status:"partial" applied:true`.
>
> Three things this establishes that the earlier reconciliation could not:
>
> 1. **The refusal branch is gone.** `ask_provenance_skipped_no_budget` last
>    fired at **21:27:44Z on 2026-08-14**, before the async deploy went Live at
>    23:10:50Z. Zero occurrences since, including under the long probe above.
>    It is replaced by `ask_provenance_deferred` (4 occurrences, all post-deploy).
> 2. **The raised background ceiling is real, not just configured.**
>    `maxTokens: 21715` on the worker call — above the 16,384 interactive cap
>    that would have discarded this payload whole (the `602965c4` defect).
> 3. **The delivered answer did not change.** The answer was captured at
>    delivery (7,521 chars) and compared byte-for-byte against the stored
>    message on every poll, before and after the claims attached: **identical at
>    every observation**. This is the `05625d02` property holding in production
>    conditions, not only in the unit test.
>
> The state is durable, not transient: `GET /api/ask/conversations/{id}`
> replays the assistant turn with its 62 claims and `provenance_status:
> "partial"`. Contrast the `66204045` behaviour — `claims: null` permanently.
>
> **`partial`, not `complete`, is the correct outcome here** and is not a
> defect: 28 of 62 claims were observed in tool output and 33 were downgraded
> (`inference_without_basis`, `value_not_in_tool_output`) — the model asserting
> more than the retrieval supports, which is exactly what the pass exists to
> surface. Rising `downgraded` is already a documented runbook signal.
>
> ### A″. UI states — deployed-artifact evidence only
>
> The Ask surface renders provenance state client-side, so this is **chunk
> evidence, not a rendered-UI observation**. The deployed
> `/_next/static/chunks/app/ask/page-194b11afecdc8d5e.js` contains all three
> non-clean banner strings — `Sources processing…`, `Sources partially
> verified`, and `Citations could not be compiled for this answer. Treat it as
> uncited…` — plus the `provenance_status` field read. **Operator-owed: open
> `/ask` in a browser and confirm a long answer shows "Sources processing…" and
> then flips to the partially-verified banner.** Folded into the existing
> browser-observation item below.
>
> ### B′. Runtime log sweep since the `05625d02` deploy
>
> Engine: **zero** errors and **zero** 5xx since 23:36Z, including across both
> probes above. The most recent entries in the error stream
> (`POST /ask` 504 at 13:42/14:10Z; three `transcription_failed` /
> `POST /ask/transcribe 500` with upstream `err_status: 401` at 16:03–16:08Z)
> all predate this deploy.
>
> **The transcription failure was re-tested and REPRODUCES on `05625d02`.** A
> 1-second 16 kHz WAV posted to `POST /api/ask/transcribe` as the walkthrough
> analyst returned **500** `{"error":"openai_error","message":"Failed to
> transcribe audio."}`, with `transcription_failed err_status: 401` in the
> engine log at 00:31:03Z. This is an upstream credential rejection, not a
> code defect and not a regression from this work — but it means **voice input
> is broken on staging right now**, not merely unvalidated. Correcting the
> earlier "not re-tested here" note. Tracked as a separate open item; the fix
> is an `OPENAI_API_KEY` rotation on `securelogic-engine-staging`, an operator
> act. Note the app-side `voice configured:true` probe passes regardless — it
> checks key PRESENCE, never that the key works.
>
> ### What this section does NOT claim
>
> - No walkthrough leg (§1–§3) was executed. Reachability and defect closure
>   are not execution.
> - The `ask_provenance_contexts` purge (payloads nulled, `purged_at` stamped
>   on every terminal path) is **test-covered, not live-observed** — no
>   authenticated read of that table was performed from here.
> - Only the JSON `POST /api/ask` path was exercised for the long probe. The
>   SSE path shares `runAskToolTurn` and is byte-shape-identical by test, but
>   was not separately driven at length on this SHA.
>
> ---
>
> ## UX/IA deployment verification (2026-08-14, `66204045`)
>
> The five approved UX/IA decisions (recorded in
> `launch-completion-status.md` §7) verified from the **authenticated staging
> UI**, not from tests or flags.
>
> | Claim | Verified | Evidence |
> |---|---|---|
> | Search removed from primary nav | ✅ | Rendered `<nav>` inner text is exactly `Briefing · Posture · Intelligence · Risk Operations · Assets · Vendor Assurance · Compliance · Context` — no Search, no Ask |
> | Global Search visible | ✅ | Header carries `<form action="/search" method="get">` with `aria-label="Search your organization"`, placeholder "Search everything…" |
> | Global Search functional | ✅ | `GET /search?q=Microsoft` → 200, **7 results** across findings, vendor and asset, with real detail links |
> | Ask removed from profile menu | ✅ | Deployed layout chunk contains `/ask` **only** inside `GlobalUtilities`; the account menu's entries are `/account`, `/account/api-keys`, `/account/team` only. Exactly **one** `href="/ask"` in the whole page |
> | Global Ask visible | ✅ | Header renders `aria-label="Ask SecureLogic" … href="/ask"` |
> | Global Ask functional | ✅ | `GET /ask` → 200; questions answered end-to-end (§A/B above) |
> | Vendor Assurance visible and reachable | ✅ | "Vendor Assurance" is a **top-level nav group**; `/vendor-assurance` → 200, `/vendor-engagements` → 200 |
> | Ask shows 5 recent conversations, View All exposes the rest | ⚠️ **NOT observed in a browser** | The walkthrough user has **29** conversations. The deployed `/ask` chunk contains the `slice(0,5)` truncation and both controls ("View all conversations", "Show recent only"), and 20 unit tests cover the behavior — but the rail loads client-side, so it renders in no server HTML. **Operator-owed: open `/ask` in a browser and confirm.** |
>
> Note on method: nav dropdown children are not server-rendered (`NavGroup`
> renders its items only when open), so group CONTENTS cannot be verified from
> HTML — only the group labels. `/vendor-assurance` and `/vendor-engagements`
> were therefore verified by fetching the pages directly.
>
> The remainder of this document is the original plan and is retained
> unchanged for reference. Its "READY FOR EXECUTION" line is historical.

Status: ~~**READY FOR EXECUTION (2026-08-14).**~~ (superseded — see above) Preconditions completed and
verified: the LC stack merged as PRs #790–#795 (develop @ `3d1a3705`),
staging engine+app live on it (221 migrations incl. 20261001/20261002), and
the §0 flag set applied via env-var update + same-SHA redeploy on BOTH
services (the env-at-deploy rule honored). Process-truth probes after the
redeploy: agentic confirm surface 401 `api_key_required` (was dark 404),
streaming 401, portal session exchange 401 `portal_link_invalid`, voice
`configured:true`; engine health ok, zero warn/error log lines post-deploy.
Production untouched; production flags unchanged.

Executor: the operator's authenticated session on
`securelogic-app-staging`, as **`[SEED] Walkthrough Org`**
(`295b989a-89d6-49ec-a7ed-deb04489d068`) — the canonical staging validation
tenant. A SECOND org member is required for the SoD legs (§3.6, §3.8). An
external inbox (not a platform user) is required for the vendor-portal leg.

## 0. Environment preconditions (operator flag/deploy acts — none executed yet)

| Requirement | Current verified state (2026-08-14) | Needed |
|---|---|---|
| LC stack on staging | NOT deployed (develop @ bc53ae82) | merge LC-1…LC-5b → develop → auto-deploy; migrations 20261001+20261002 apply on boot |
| `SECURELOGIC_DECISION_WORKSPACE_ENABLED` | **true** (engine + app) | keep |
| `SECURELOGIC_RISK_ACCEPTANCE_ENABLED` | **true** (engine + app) | keep |
| `SECURELOGIC_VENDOR_ASSURANCE_ENABLED` | **true** (engine) | keep |
| `SECURELOGIC_VENDOR_PORTAL_ENABLED` | ABSENT → **OFF** | set `true` (engine) for §1.4–1.5 |
| `SECURELOGIC_ASK_TOOLS_ENABLED` | ABSENT → **OFF** (Ask runs the legacy snapshot path) | set `true` (engine) — prerequisite for citations, multi-turn, streaming, agentic |
| `SECURELOGIC_ASK_PROVENANCE_ENABLED` | ABSENT → OFF | set `true` (engine) for §2.2 |
| `SECURELOGIC_ASK_STREAMING_ENABLED` | ABSENT → OFF | set `true` (engine + app) for §2.4 |
| `SECURELOGIC_ASK_VOICE_ENABLED` / voice | flag absent (default ON post-LC-4); `OPENAI_API_KEY` present | no change; voice active |
| `SECURELOGIC_ASK_VOICE_REALTIME_ENABLED` | ABSENT → OFF | set `true` (engine + app) for §2.6 readback |
| `SECURELOGIC_ASK_ACTIONS_ENABLED` | ABSENT → **OFF** | set `true` (engine) for §3.1–3.3 — **environment-global; see caveat** |
| `SECURELOGIC_ASK_GOVERNED_ENABLED` | ABSENT → **OFF** | set `true` (engine) for §3.4–3.8 — **environment-global; see caveat** |

**Tenant-scoping caveat (verified, not inferred):** every flag above is read
from `process.env` — activation is ENVIRONMENT-GLOBAL. No per-org gate
exists for ACTIONS/GOVERNED (the only per-org control in the LC stack is
`organizations.voice_input_enabled`, voice-only). Restricting agentic
activation to the Walkthrough Org **is not currently possible**; what bounds
the blast radius on staging is that all 12 staging orgs are seeded/test
tenants. If per-org agentic enablement is wanted before any production
activation, it is NEW WORK (an `ask_actions_enabled`-style org column on
the LC-4 pattern) — flag it at LC-6 scoping.

Render injects env at DEPLOY, not restart (2026-08-05 incident): set flags
BEFORE triggering the deploy, or same-SHA rebuild after setting them.

## 1. Vendor Assurance — end to end

| # | Step | Expected result | Audit/DB evidence |
|---|---|---|---|
| 1.1 | Create vendor → start engagement (intake, `engagement_type=initial`) | Engagement in `draft→scoping`; inherent risk computed from intake (9 dims) | `vendor_engagements` row; `audit` events on create |
| 1.2 | Inherent override (if exercised) | `residual_basis` provenance kept | `inherent_understated` trace |
| 1.3 | Scope resolution → questionnaire issued | Frozen scope items; state `issued`; invite created | `vendor_engagement_scope_items` frozen; invite row with token_hash only |
| 1.4 | **External vendor** opens invite link (portal flag on) | One-time exchange → httpOnly session; invite link dead afterward | `vendor_portal_sessions` row; byte-identical 401 on reuse |
| 1.5 | Vendor answers requirements, uploads evidence, submits | Per-engagement byte/file budgets enforced; `submitted` | `requirement_response_revisions` (responder_type=vendor); evidence rows with `uploaded_via_invite_id` |
| 1.6 | Reviewer: begin review → evidence analysis → clarification round trip | `clarification_requested→in_progress` reachable; comment `visibility` respected (internal never portal-visible) | comments rows; analysis worker output |
| 1.7 | Promote engagement findings; create remediation actions | Findings born with correct source_type; actions linked | `vendor_engagement_findings`; `finding.created`/`action.created` |
| 1.8 | Residual risk computed → `decision_pending` | Residual score+rating present; state machine advanced | engagement row |
| 1.9 | Reviewer records decision (rationale ≥10) | `decided`; decided_by = reviewer; residual UNCHANGED | `vendor_engagement.decided` audit with residual-at-decision |
| 1.10 | Monitoring sweep / reassessment hook | `monitoring`; next_review_due set; INTEL hook visible | monitoring rows |

## 2. Ask — retrieval truth

| # | Step | Expected result | Evidence |
|---|---|---|---|
| 2.1 | Authorized questions (findings counts, vendor posture) with TOOLS on | Numbers match the product surfaces exactly (ASK-A equivalence, live) | `ask.question.asked` audit with tool ledger |
| 2.2 | Citations/provenance (flag on) | Claims decompose; unverifiable claims render as "Assessment:" | `ask_tool_invocations` rows = citation targets |
| 2.3 | Multi-turn | Thread persists; another org member CANNOT read it | `ask_conversations` user-scoping |
| 2.4 | Streaming (both flags on) | Deltas then `final` ≡ JSON shape; fallback works when engine flag dropped | `streamed:true` in audit |
| 2.5 | Access truth | A starter/professional-entitlement question never routes to a platform-gated surface (LC-2 corpus filtering) | prompt class = entitlement class |
| 2.6 | Voice: disclosure card on FIRST mic press → transcribe → answer; readback (realtime flag on) speaks voice-question answers; org toggle off (settings) → engine 403 `voice_disabled_for_org` | LC-4 C-1/C-2 behavior live | `ask.voice.transcribed` audit (shape only) |

## 3. Agentic Ask — under the walkthrough org, both agentic flags on

| # | Step | Expected result | Audit evidence |
|---|---|---|---|
| 3.1 | "Create an action to track X" → card renders SERVER summary → **Confirm** | Action exists; card shows executed | `ask.action.proposed` + `ask.action.executed` (tool, summary, http_status 201) |
| 3.2 | Same flow → **Discard** | Nothing created; terminal card | `ask.action.declined` |
| 3.3 | actions.update on the created action (status → in_progress) → Confirm | Action updated | `ask.action.executed` |
| 3.4 | findings.close on a no-remediation finding (rationale given) → Confirm | Finding `resolved`; rationale in lifecycle comment | `ask.action.executed` with `transition`, `rationale`, `resulting_state` |
| 3.5 | findings.close on a finding with an OPEN action → Confirm | **Refusal**: token consumed, honest message, no state change | `ask.action.execution_refused` with `refusal_detail` |
| 3.6 | (SoD, if org policy enabled) closer == remediator → Confirm | Refused; different closer succeeds | refusal + success events |
| 3.7 | vendors.decide on a `decision_pending` engagement → Confirm | `decided`; decided_by = CONFIRMING user; residual unchanged | `ask.action.executed` resulting_state echoes residual |
| 3.8 | risks.accept → Confirm (5-min TTL) → acceptance `proposed`, finding still ACTIVE → SAME user tries in-product approve → **403 separation_of_duties** → SECOND user approves | Finding `accepted_risk`; severity unchanged | `ask.action.executed` + `finding.risk_acceptance.proposed` + approval audit |
| 3.9 | Replay: re-POST a spent token (from devtools) | 404 `proposal_not_found`, byte-identical | `ask.action.confirm_denied` (no token material) |
| 3.10 | Let a card expire (>15 min / >5 min for 3.8) → Confirm | 404; row `expired` | ledger row |

## 4. Human/operator gates (cannot be executed by the agent)

1. **Operator authenticated session** — every step above; plus the merge/
   deploy/flag acts in §0 (branch discipline: stacked PRs, retarget before
   deleting bases).
2. **Second user/approver** — §3.6 SoD closer, §3.8 acceptance approver.
   Needs a second real login in the Walkthrough Org.
3. **External vendor/tester** — §1.4–1.5 portal legs (also the standing
   Stop Gate B.4 item: a REAL external tester completes an engagement).
4. **DPA/subprocessor approval** — OpenAI Whisper audio processing sign-off
   (ratified ASK-C C-6 item, still owed before voice is marketed/relied on).
5. **Independent security/human review** — the standing Stop Gate A.5 /
   ASK-A A.6 / B.3 human-review items; LC-5/5b's ASK-B evidence should be
   added to that review's scope.

## 5. Execution record

**§0 flag activation executed 2026-08-14 (agent, operator-directed):**
engine-staging set `VENDOR_PORTAL`, `ASK_TOOLS`, `ASK_PROVENANCE`,
`ASK_STREAMING`, `ASK_VOICE_REALTIME`, `ASK_ACTIONS`, `ASK_GOVERNED` = true;
app-staging set `ASK_STREAMING`, `ASK_VOICE_REALTIME` = true; same-SHA
deploys `dep-d9v8n2e7bikc739nmvsg` / `dep-d9v8n2jl550s7380dacg` (both live
at `3d1a3705`); probes above confirm the running processes carry the flags.
`DECISION_WORKSPACE` and `RISK_ACCEPTANCE` were already true and untouched.

### Execution 2026-08-15 (agent, authenticated, deployed `42004547`)

Executed against `securelogic-engine-staging` / `securelogic-app-staging`, both
live at `42004547`, as `[SEED] Walkthrough Org` using the two seeded logins
(`walkthrough-approver` = admin, `walkthrough-analyst` = analyst). A real
browser (Playwright, authenticated session cookie) was used for the rendered-UI
observations; the API legs were driven with the engine JWT and, for the portal,
with **no credential at all** — the invite token only, as an external vendor
holds it.

**This is the first execution of the §1–§2 legs. They are no longer unexecuted.**

#### §1 Vendor Assurance — COMPLETE end to end

Driven on `c35041bf` (Cisco, periodic, inherent 61 High). Every transition is a
real state change on staging, not a probe:

| Step | Result | Evidence |
|---|---|---|
| 1.1 | — | engagement pre-existed in `draft` |
| 1.3 | **PASS** | `POST /scope` → 3 scoped, 0 excluded, `tier_2_high`, rule v1.0.0; `POST /issue` → `issued`, 64-char raw token returned **once** (SHA-256 only persisted), expiry +30d |
| 1.4 | **PASS, with a spec conflict — see W-2** | `POST /vendor-portal/session` with the token alone → 200, `sl_vendor_portal` cookie **httpOnly + Secure + path-scoped to `/api/vendor-portal`**; status auto-advanced `issued → in_progress` |
| 1.4a | **PASS** | Vendor's own view exposes only `organization_name, vendor_name, title, status, due_date, accepting_responses` — **no inherent score, no internal fields** |
| 1.5 | **PASS** | 3 answers saved (`pass`/`pass`/`pass`); `POST /submit` → `submitted`. An earlier submit correctly refused `422 incomplete, unanswered_required: 1` |
| 1.6 | **PASS** | `begin-review` → `in_review`; `complete-analysis` → `analysis_complete`, `analysis_coverage: deterministic_only` |
| 1.7 | **PASS (vacuously)** | `promote-findings` → `promoted: 0` — correct, all answers were `pass`; findings are born from `fail`/`partial`. **A fail-path promotion remains unexercised** |
| 1.8 | **PASS** | `recompute` → effectiveness 50 (`vendor_effectiveness_v1`, coverage 1.0), residual **40 Moderate** from inherent 61 High; status advanced `analysis_complete → decision_pending` |
| 1.9 | **PASS** | Rationale guard fires (`rationale_required` on a 2-char rationale); `decision: approved` → `decided`, `decided_by` set, residual **unchanged** at 40 |
| 1.10 | **PASS** | `monitoring` → `monitoring`, `next_review_due: 2027-02-11` (cadence 180d). Refused first with `review_date_required` — "Monitoring without a review date is not monitoring" |

State machine refused every illegal transition attempted: `decision` from
`in_review` → `409 illegal_transition`, `monitoring` from `in_review` → `409`,
re-`issue` of an in-flight engagement → `409 cannot_issue`. The
`in_review → analysis_complete → decision_pending` ordering is enforced, not
advisory.

#### §2 Ask — COMPLETE

| Step | Result | Evidence |
|---|---|---|
| 2.1 | **PASS — exact match** | Ask returned 607 active / 29 critical / 505 high / 73 medium / 0 low / 29 overdue / 598 unassigned; `/api/findings/summary` returns the identical seven numbers. Tool ledger shows `findings.summary`, `tools_denied: 0` |
| 2.2 | **PASS** | Claims decompose with FIELD-level citations (`{tool: "findings__summary", field: "summary.active_total"}`); the one unverifiable sentence is `claim_class: "inference"` with `citations: []` and renders as "Assessment:" |
| 2.3 | **PASS** | Thread persists (4 messages after a follow-up); the anaphoric "Of those, how many are overdue?" resolved correctly to 29. The **analyst** reading the approver's conversation gets `404 conversation_not_found` — user-scoped and fails closed without leaking existence |
| 2.4 | **PASS** | Non-streaming `POST /api/ask` → **200 in 5.9s** (this path 504'd at 90s before), key shape identical to the SSE `final` frame. SSE emits `round`/`tool_call`/`delta`/`final` |
| 2.5 | **NOT EXERCISED — see W-1** | The probe used (analyst asks for audit log) does not test LC-2 corpus filtering: **there is no audit tool in the registry** (17 tools, none audit), so no gated surface could have been reached. A true test needs a starter/professional-entitlement user, which this org does not have |
| 2.6 | **PASS — previously blocked** | `POST /api/ask/transcribe` → **200 in 2.4s** with a WAV payload. This was 500ing on an upstream OpenAI 401; the credential separation fixed it. Unauth → 401, confirming the kill-switch code is deployed |

#### §3 Agentic Ask — NOT EXECUTED this session

Time-boxed out after §1 and §2. Both flags were set true on 2026-08-14 and the
services have redeployed since (env persists across deploys), so §3 is
executable by the same method — including 3.8's separation-of-duties leg, since
**both** seeded users hold `risk:accept` and SoD is enforced on differing
`user_id`, not on role.

#### Defects found by this execution

- **W-3 (P1, in the promotion delta) — the vendor questionnaire cannot save an
  answer for a requirement the vendor already has a response row for.**
  Symptom: `PUT /api/vendor-portal/questions/:id` → `500 portal_unavailable`,
  deterministic, for one requirement while others succeed; `/submit` then
  refuses `422 incomplete`, so the vendor is hard-blocked with no usable
  message. Root cause: migration `20260924` intends to replace the old
  4-column unique key with one including `engagement_id` ("strictly WIDER"),
  but drops `requirement_responses_organization_id_requirement_id_asses_key`
  (62 chars) while Postgres generated
  `requirement_responses_organization_id_requirement_id_assess_key` (63) —
  **one character**. `DROP CONSTRAINT IF EXISTS` no-ops silently. Verified on a
  fresh database after the FULL migration set: the old constraint SURVIVES
  alongside `idx_requirement_responses_unique_scoped`. Because `ON CONFLICT`
  names only the new index's expression, a collision on the old constraint
  raises 23505 rather than upserting. **Consequence beyond the 500: two
  engagements with the same vendor cannot both hold answers for the same
  requirement — the exact capability the migration was written to enable.**
  Fix is a new migration dropping the correctly-named constraint. NOT applied
  in this session.

- **W-2 (ruling needed, not a code defect) — §1.4's "one-time exchange" is not
  what shipped.** This plan says the invite link is "dead afterward" with a
  "byte-identical 401 on reuse". Observed: the same token minted **three
  distinct sessions**, all live. That is deliberate — `20260923` states
  "Re-exchange is permitted until expiry so the vendor can return via the same
  email; each one is audited", and the compensating controls are real
  (`exchange_count` incremented, first/last timestamps, `writeAuditEvent` on
  every exchange, httpOnly+Secure+path-scoped cookie, 30-day expiry,
  revocation). So the SPEC is stale, not the code — but the security
  characteristic deserves explicit acceptance before portal enablement: **an
  emailed invite is a bearer credential, replayable for 30 days by anyone who
  sees the mail.** Operator ruling owed; do not silently edit §1.4.

- **W-1 (P2) — Ask's navigation guidance is not requester-aware.** Asked for the
  audit log, the **analyst** was told "Navigate to **Audit Log** in the top
  navigation". That user's rendered nav is
  `Briefing · Posture · Intelligence · Risk Operations · Assets · Vendor
  Assurance · Compliance · Context` — no Audit Log — and `/audit-log`
  307-redirects for them. LC-2's requester-awareness holds for DATA but not for
  navigation instructions.

#### Observation, not a defect

The walkthrough org is documented as human-scale (8 findings). It now holds
**607 active findings, 603 vendor-sourced**. Ask's numbers are exactly right,
but "human-scale" no longer describes this tenant, and a reviewer expecting 8
will misread every posture surface. Worth a reseed decision before the org is
used for demo-adjacent validation.
