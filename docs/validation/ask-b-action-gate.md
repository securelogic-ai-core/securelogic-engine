# Stop Gate ASK-B — Bounded Agentic Ask (formalized checklist)

Status: **FORMALIZED 2026-08-13 (LC-5).** The September-15 program deferred
Ask's `mutate`/`governed` action classes as P2 "behind Stop Gate ASK-B
(confirmation tokens + prompt-injection suite)". LC-5 opens exactly the
`mutate` class, on exactly two tools, under the mechanism this document
specifies and proves. `governed` remains closed (see the LC-5b ruling at the
end); `draft` remains unopened.

The operator's eight mandated proofs (2026-08-13 authorization) are the
checklist's dimensions B-1 … B-8. Each: **Requirement** (normative) ·
**Mechanism** (how the code makes it true) · **Evidence** (re-runnable).

Scope of "agentic" at this revision:

```
model calls a mutate tool → NOTHING EXECUTES → proposal row (frozen input,
  server-rendered summary) → token minted AFTER the model loop ends →
  raw token → HTTP payload → the user's confirmation card →
  POST /api/ask/actions/confirm {token} → atomic single-use claim →
  canonical route chain re-runs under the CONFIRMING request → outcome
  recorded + audited
```

Mutate tools at this revision: `actions.create` (POST /actions),
`actions.update` (PATCH /actions/:id) — create/update only, no DELETE verbs,
no owner-assignment field, no `blocked` status pair. The registry build-guard
(`platformToolRegistry.test.ts`) holds the allowlist closed: a third non-read
tool fails the suite until this document is extended.

---

## The checklist

### B-1. The model cannot self-confirm

- **Requirement**: no sequence of model outputs can execute a proposed
  mutation; only the human user can.
- **Mechanism**: three independent walls. (1) The orchestrator never executes
  a non-read chain — the mutate branch records a proposal and continues.
  (2) The confirmation token is minted in `runAskToolTurn` AFTER
  `runAskOrchestration` has returned: token material does not exist while the
  model is running, so it cannot appear in model context even in principle.
  (3) The confirm route requires the raw token; the model has no channel to
  the route and nothing to present to it.
- **Evidence**: `askProposalFlow.test.ts` (executor spy proves the chain is
  never run for mutate calls; transcript scan proves no token-shaped material
  in any model-visible message); `askActionsTurnPayload.test.ts` (the raw
  token appears in the HTTP payload and in nothing else the turn produced).

### B-2. Retrieved / prompt-injected content cannot trigger confirmation

- **Requirement**: hostile content in tool results (vendor documents, finding
  titles, any retrieved text) must not be able to cause a mutation, even when
  the model obeys it.
- **Mechanism**: obeying an injection can at most create ANOTHER proposal —
  inert without the user's token. Injected "confirmation tokens" are noise:
  the confirm route matches SHA-256 of a server-minted 256-bit secret, keyed
  additionally on org + user + pending + unexpired.
- **Evidence**: `askProposalFlow.test.ts` "injected tool output cannot cause
  execution" — a hostile document instructs the model to close every action
  with a fabricated token; the model obeys; the executor spy records zero
  mutate executions and the only artifact is one pending proposal.

### B-3. Authorization is re-evaluated at execution time

- **Requirement**: confirmation executes under the confirming request's
  CURRENT authorization, not a snapshot from proposal time.
- **Mechanism**: the confirm route itself carries the full text-Ask chain
  (kill switch → actions flag → API key → org context → entitlement → seat →
  org-keyed rate limit), and execution runs `executeTool`, which replays the
  canonical route's OWN full middleware chain — `requireApiKey`,
  `attachOrganizationContext` (fresh org row read, fresh entitlement),
  `requirePremiumOrCorePlatform`, seat scoping, `asTenant`/RLS — against the
  confirming request. There is no cached authorization anywhere.
- **Evidence**: `askActionsRoute.test.ts` (refused execution path: the chain's
  denial is reported honestly, the token stays consumed, and
  `ask.action.execution_refused` is audited); chain-parity structural test in
  the same file; executor inheritance semantics ratified at ASK-A
  (`askToolAuthorizationEquivalence.test.ts`).

### B-4. Confirmation is bound to the exact proposed mutation

- **Requirement**: what executes is what was proposed — not what the client
  or the model says at confirm time.
- **Mechanism**: `tool_input` is frozen server-side in the proposal row at
  creation; the confirm request carries ONLY the token; execution reads tool
  name and input from the claimed row. The confirmation card's summary is
  rendered SERVER-side (`tool.summarize`) from the same frozen input — the
  user confirms what the server rendered, not what the model narrated.
- **Evidence**: `askActionsRoute.test.ts` "confirm-body fields cannot reach
  it" (attempted overrides in the confirm body are ignored; `executeTool`
  receives the row's input verbatim); registry guard requires `summarize` on
  every mutate tool.

### B-5. Stale or modified proposals cannot execute under an earlier confirmation

- **Requirement**: a proposal is executable only in its issued form and
  window.
- **Mechanism**: rows are immutable in the product flow (no update surface
  exists for `tool_input`); the claim is conditioned on `status = 'pending'
  AND expires_at > NOW()` (TTL 15 min); declined and confirmed are terminal;
  a registry change between proposal and confirm is detected at execution
  (`getTool` miss / non-mutate class → honest 409, token consumed).
- **Evidence**: `askProposedActionsIsolation.test.ts` (expired claim → null +
  row marked expired; declined is terminal); `askActionsRoute.test.ts`
  (retired tool → 409, nothing executed).

### B-6. Replay / double-submit cannot duplicate the mutation

- **Requirement**: one token, at most one execution, under any concurrency.
- **Mechanism**: the claim is a single atomic
  `UPDATE … SET status='confirmed' WHERE … AND status='pending'` — the
  database serializes it; the loser reads zero rows. A consumed token stays
  consumed even when execution is later refused — a refusal is not a retry
  channel.
- **Evidence**: `askProposedActionsIsolation.test.ts` (sequential replay →
  null; `Promise.all` double-submit against real Postgres → exactly one
  winner); `askActionsRoute.test.ts` (refusal leaves no unclaim path — the
  store has none).

### B-7. Tenant/user context cannot change between proposal and execution

- **Requirement**: the proposal executes for the same user in the same org it
  was issued to, in that org's tenant scope.
- **Mechanism**: `organization_id` and `user_id` are frozen NOT NULL at
  proposal time and both condition the claim; the claim runs inside
  `withTenant(callerOrg)` with RLS as backstop; a caller with no human
  identity is a uniform miss (user_id NOT NULL by design — bare API keys are
  never offered mutate tools and could not confirm anyway).
- **Evidence**: `askProposedActionsIsolation.test.ts` (colleague-in-same-org
  claim → null; cross-org claim with the RAW TOKEN → null; RLS SELECT/INSERT/
  UPDATE proofs under SET ROLE app_request);
  `askActionsRoute.test.ts` (claim keyed on the CALLER's context, ignoring
  anything client-supplied); `askActionsTurnPayload.test.ts` (userless caller
  → read-only orchestration).

### B-8. Every execution is auditable

- **Requirement**: the ledger answers "what did the assistant propose, what
  did the user do about it, and what happened" without trusting any narrative.
- **Mechanism**: audit events at every transition — `ask.action.proposed`
  (per proposal, with the server-rendered summary), `ask.action.executed` /
  `ask.action.execution_refused` (with the chain's HTTP status),
  `ask.action.declined`, `ask.action.confirm_denied` (probe visibility, with
  deliberately NO token material and no failure-reason oracle). The row
  itself carries `executed_http_status` + a SHAPE-only `execution_digest`
  (the `ask_tool_invocations` discipline), and `ask.question.asked` counts
  proposals per turn.
- **Evidence**: `askActionsRoute.test.ts` (every event asserted, token
  absence asserted); `askActionsTurnPayload.test.ts` (proposed events + turn
  counter); data classification entry for `ask_proposed_actions`
  (`dataClassification.ts`).

---

## Standing bounds (enforced, not aspirational)

- **MAX_PROPOSALS = 3** per turn, enforced in the orchestrator with an honest
  budget-exhausted message to the model (`askProposalFlow.test.ts`).
- **Registry allowlist closed** at exactly `actions.create` +
  `actions.update`, POST/PATCH only (`platformToolRegistry.test.ts`).
- **Dark flag**: `SECURELOGIC_ASK_ACTIONS_ENABLED`, default OFF (new
  behavior). Off = mutate tools invisible to the model AND confirm routes
  404. Turning it off strands pending proposals unexecutable — deliberately.
- **Proposal TTL 15 minutes**; proposals are turn-scoped (a reload loses the
  card; the row expires server-side; asking again is the recovery path).

## LC-5b ruling — governed stays decision-gated

The deferred P2 item named `mutate` AND `governed`. LC-5 ships mutate only.
`governed` (mutate + mandatory rationale + audit evidence + the existing SoD
and approval gates: risk acceptance, vendor decision, finding closure) binds
Ask to the platform's highest-stakes transitions and is deliberately held
behind its own review — LC-5b — exactly as the ratified ASK-C gate held
duplex voice behind its own review. The confirmation infrastructure built
here is class-agnostic: LC-5b is additive (new registry entries + per-tool
controls), not a rework. The operator presentation owed at LC-5b: the
proposed governed tool set, and the additional controls each requires beyond
B-1…B-8.

**Gate determination for LC-5**: every dimension B-1…B-8 is closed by
construction and proven by re-runnable evidence at unit, route, and
real-Postgres layers. No operator-owed item is introduced by this gate; the
flag flip is the standing GATE-B-style operator decision it always is.
