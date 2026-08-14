# Launch Completion — Integrated Staging Walkthrough Plan

> ## Status: REOPENED — the READY claim below was FALSIFIED (2026-08-14)
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
> *(Reconciled 2026-08-14 21:20–21:30Z against deployed `66204045` — see
> "Re-verification" below. One of these two is now CLOSED on live evidence; the
> other REMAINS OPEN, narrowed. The entries below are preserved as written.)*
>
> - **P1: answers over ~4,000 characters lose every citation.** Reproduced on
>   `ac4b8898`: a 4,060-char answer returned `claims: 0`. Engine logs show two
>   branches — `ask_provenance_truncated` (`maxTokens: 4096`) for 5.9k–8.3k-char
>   answers, and `ask_provenance_skipped_no_budget`
>   (`tokensNeeded: 5308` vs `tokensAffordable: 4121`, with 57.9s still left in
>   the request). Criterion G therefore holds for ordinary answers and fails for
>   long ones. Being worked in a parallel session (`ac4b8898`) — do not
>   duplicate.
> - **P1: non-streaming `POST /api/ask` 504s at 90s** on heavy multi-tool
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
> ### A. Long-answer provenance / citations — **REMAINS OPEN** (narrowed)
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

Walkthrough steps: to be filled during execution — step → pass/fail →
evidence link.
