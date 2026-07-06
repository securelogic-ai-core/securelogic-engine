# ERIP Epic 6 — Autonomous Operations (design memo)

Status: RATIFIED (ERIP autonomous-decision authority).
Roadmap: `enterprise-risk-intelligence-platform.md` §4 Epic 6.
Foundation reused: the `actions` primitive, `writeAuditEvent`, the
connector-config encryption pattern (future external executors), the SoD/
approval thinking in the risk-lifecycle spec. Additive, dark.

## Decisions (ERIP-AD-24 …)

> **ERIP-AD-24 — Human approval is STRUCTURAL, not advisory.** A proposal is
> inert until a human explicitly approves it. The state machine has no path from
> `proposed` to `executed` that does not pass through `approved`. There is NO
> auto-execute in this phase — "unless explicitly configured otherwise" is a
> later, operator-gated capability, deliberately not built here.

> **ERIP-AD-25 — Separation of duties.** The approver MUST differ from the
> proposer (`approved_by_user_id <> proposed_by_user_id`), enforced in the pure
> policy AND the route. Self-approval is rejected.

> **ERIP-AD-26 — The proposal ledger is append-only in spirit; status moves
> only FORWARD.** proposed → approved → executed | failed; proposed → rejected.
> No backward transitions; every transition is audited (writeAuditEvent).

> **ERIP-AD-27 — Executors are internal-first.** The one executor this phase
> ships is `create_action` (emit an `actions` row, source_type='manual',
> action_type='orchestration:create_action' — no CHECK change). External
> executors (ServiceNow, Jira) and richer playbooks reuse the same ledger +
> state machine and are deferred (their outbound calls go through the SSRF-safe
> connector HTTP client + encrypted per-org config).

## Phases

### E6.P1 — approval-gated orchestration ledger + create_action executor (core)
- Migration `orchestration_proposals` (org-scoped, RLS NOT FORCE, app_request
  DML, dataClassification): id, org, proposal_type CHECK('create_action'),
  title, payload JSONB, status CHECK(proposed/approved/rejected/executed/
  failed), proposed_by_user_id, approved_by_user_id, execution_result JSONB,
  executed_at, timestamps.
- `orchestrationPolicy.ts` (PURE): the forward-only transition table + the SoD
  rule + payload validation per proposal_type.
- `routes/orchestration.ts` (flag + capability + asTenant):
  POST /orchestration/proposals (create → proposed),
  GET /orchestration/proposals (list),
  POST /orchestration/proposals/:id/approve (SoD-checked → approved → execute
  create_action in one tx → executed|failed; audited),
  POST /orchestration/proposals/:id/reject (→ rejected; audited).
- Flag `SECURELOGIC_AUTONOMOUS_OPERATIONS_ENABLED` (default off ×4).

### Deferred (by ruling, tracker)
- External executors (ServiceNow/Jira), notification/evidence-request
  executors, multi-step playbooks, and per-org auto-approve — same ledger +
  state machine; deferred behind explicit product/operator decisions.

## Exit
A proposal can be created, requires a DIFFERENT human to approve, executes an
internal action on approval with a full audit trail, and can be rejected —
nothing executes without approval; all dark.
