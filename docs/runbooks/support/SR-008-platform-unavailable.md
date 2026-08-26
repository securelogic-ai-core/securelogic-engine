# SR-008 — Application or engine unavailable

| | |
|---|---|
| **Playbook ID** | SR-008 |
| **Domain** | Availability |
| **Severity default** | **SEV1** |
| **Owning level** | L1 detect and escalate → L2 → Engineering |
| **Release dependency** | Live in production today |
| **Feature flag** | None |
| **Last validated** | 2026-08-21 against `develop@58cccb2c` |
| **Status** | Diagnosis VALIDATED. **Recovery is Engineering-only — SUP-PROC-1.** |

## Read this first

**If more than one organization is affected, this is SEV1 and it is escalated
immediately — before diagnosis is complete.** Do not spend time confirming scope
first. An availability event escalated early and downgraded later costs nothing;
one escalated late costs the outage.

## Customer-visible symptoms

Pages will not load or time out; every action errors; blank screens; "something
went wrong" across unrelated features. **Breadth is the signal** — unrelated
features failing together means platform, not feature.

## Likely causes

1. Engine unavailable or unhealthy
2. App unavailable
3. Database unreachable
4. A dependency degraded (storage, email, AI provider) — usually partial, and
   presents as one feature failing, not everything
5. A worker stalled — background work only; the app stays up

## Safe diagnostic steps

1. **`GET /health` on the engine.** Healthy is `{"status":"ok","db":"connected"}`.
   Anything else, or no response, is a platform event. *(L1 OBSERVABLE.)*
2. **Load the app yourself.** *(L1 OBSERVABLE.)*
3. **Scope: how many organizations?** More than one → SEV1.
   *(L1 OBSERVABLE.)*
4. **Is it everything, or one feature?** One feature → the relevant runbook.
   *(L1 OBSERVABLE.)*
5. Deploy history, service status, worker state — *(L2/ENGINEERING ONLY.)*

## Evidence to collect

What `/health` returned, first-noticed time with timezone, how many orgs, which
surfaces, whether it is total or intermittent.

## Approved L1 actions

Detect, classify, escalate, communicate. **Nothing else** — there is no L1 action
that can affect availability.

## Actions L1 must NOT perform

- restart anything
- advise customers to retry repeatedly during an outage — it adds load to a system
  already struggling
- tell customers it is "their network" without evidence
- give a restoration estimate

## Escalate when

Immediately, on any platform-wide symptom. Do not wait for confirmation.

## Escalate to

L2 / Platform Operations → Engineering. If unavailability coincides with anything
suggesting compromise, escalate to **Security in parallel** — do not serialise.

## Recovery

**Engineering-only.** No support-executable recovery exists, and none should be
improvised during an outage.

## Recovery verification

`/health` healthy, the app loads, **and an affected customer confirms**. Do not
declare recovery from health checks alone — health can be green while a customer
is still failing.

## Customer communication

> "We're aware of a platform issue affecting more than one customer, and our team
> is on it now. I'll come back to you as soon as I have something concrete rather
> than guessing at a timeline."

Never speculate about cause. Never promise a restoration time.

## Observability

| Signal | Where | Level |
|---|---|---|
| Engine health | `GET /health` | **L1** |
| App reachability | Load the app | **L1** |
| Service/deploy status, logs, workers | Render + logs | L2 |
| Ops health detail | `/admin/ops/health` | L2 (staff key) |

**Missing:** there is no status page and no shared incident view, so L1 learns
about an outage from a customer report or by probing `/health` themselves
(**SUP-OBS-12**).

## Related

SR-005, SR-007, SR-012 · `SUPPORT-AUTHORITY-MODEL.md`
