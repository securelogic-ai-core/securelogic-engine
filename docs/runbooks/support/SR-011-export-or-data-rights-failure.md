# SR-011 — Export or data-rights request fails

| | |
|---|---|
| **Playbook ID** | SR-011 |
| **Domain** | Data & Privacy |
| **Severity default** | SEV2 — regulatory deadlines attach to these requests |
| **Owning level** | L1 triage → L2 → Engineering |
| **Release dependency** | CSV exports live today. **Data-rights worker flags are `false` in production** — confirm reachability before treating a data-rights workflow as available. |
| **Feature flag** | Data-rights worker: off in production |
| **Last validated** | 2026-08-21 against `develop@58cccb2c` |
| **Status** | Diagnosis VALIDATED. **No recovery procedure — SUP-PROC-1.** |

## Read this first

**A data-rights request usually has a legal clock running.** Even when the
technical problem is minor, the deadline is not. Escalate early and record the
original request date — not the date it reached support.

## Customer-visible symptoms

An export fails or downloads empty; an export never arrives; a data-rights request
appears stuck; a deletion/erasure request does not complete.

## Likely causes

1. Export too large or timed out.
2. Delivery by email failed → **SR-002** pattern (suppression).
3. **The data-rights workflow is not enabled in this environment** — check before
   promising it. Its worker flags are off in production.
4. **Erasure may be blocked by design.** Retention rules and immutable records
   (WORM audit trails, legal hold) can legitimately prevent deletion of some data.
   That is a legal determination, **not a support explanation to improvise**.
5. Platform issue → **SR-008**.

## Safe diagnostic steps

1. **Which request — an export, or a data-rights/erasure request?** Completely
   different paths. *(L1 OBSERVABLE.)*
2. **When was it originally requested?** Record it; the clock started then.
   *(L1 OBSERVABLE.)*
3. **Empty, failed, or never arrived?** *(L1 OBSERVABLE.)*
4. **Is this a regulatory request from a data subject?** If yes, escalate
   immediately regardless of technical simplicity. *(L1 OBSERVABLE.)*
5. Worker state, job outcome, retention/legal-hold status — *(L2/ENGINEERING ONLY.)*

## Evidence to collect

Request type, **original request date**, organization slug, requesting user,
whether a regulatory deadline applies, exact error, timestamp.

## Approved L1 actions

Classify and escalate. Retry an ordinary CSV export once. **Nothing else** — this
domain has legal consequences for improvisation.

## Actions L1 must NOT perform

- state whether data can or cannot be deleted — that is a legal determination
- promise a completion date for a regulatory request
- delete records manually to satisfy an erasure request
- export data on the customer's behalf through another route

## Escalate when

Any data-rights or erasure request, always. Any export failure that recurs. Any
request with a named regulatory deadline.

## Recovery

**None validated (SUP-PROC-1).** Data-rights processing is Engineering, with legal
input where erasure is constrained.

## Recovery verification

The customer confirms receipt of a complete export, or Engineering confirms the
data-rights request completed.

## Customer communication

> "I've logged this with the original request date and escalated it — requests like
> this have timelines attached and I want it in the right hands straight away. I'm
> not going to guess at what can be deleted or by when; the team will come back to
> you with an accurate answer."

## Observability

| Signal | Where | Level |
|---|---|---|
| Export succeeded / failed | Customer's screen | **L1** |
| Export job outcome | Engine logs | L2 |
| Data-rights request state | — | **NOT OBSERVABLE to support** |
| Retention / legal-hold status | — | **NOT OBSERVABLE to support** |

**Missing:** there is no support-visible view of a data-rights request's state, on
the workflow with the hardest external deadline (**SUP-OBS-19**).

## Related

SR-002, SR-008 · `docs/legal/` (erasure determinations)
