# Launch Completion — Integrated Staging Walkthrough Plan

Status: **READY FOR EXECUTION (2026-08-14).** Preconditions completed and
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
