# SR-012 — Ask or AI generation fails

| | |
|---|---|
| **Playbook ID** | SR-012 |
| **Domain** | AI / Intelligence |
| **Severity default** | SEV3 |
| **Owning level** | L1 triage → L2 |
| **Release dependency** | Live in production today |
| **Feature flag** | `SECURELOGIC_ASK_ENABLED` — **`true` in production** |
| **Last validated** | 2026-08-21 against `develop@58cccb2c` |
| **Status** | Diagnosis VALIDATED. **No recovery procedure — SUP-PROC-1.** |

## Customer-visible symptoms

Ask returns an error or nothing; a request hangs; "unavailable"; an answer that is
truncated or malformed.

## What the error codes mean

| Code | Meaning | Action |
|---|---|---|
| `ask_unavailable` | Feature off or upstream unavailable | Escalate — check scope |
| `ask_failed` | Generation failed | Escalate with the timestamp |
| `rate_limit_exceeded` | Too many requests | Customer waits and retries |
| `question_too_long` | Over the input limit | Customer shortens it |
| `question_required` | Empty input | Customer retries |
| `legal_hold_active` | Conversation cannot be deleted under legal hold | **Expected** — explain, do not escalate |

## Likely causes

1. Upstream AI provider degraded or rate-limiting — the most common cause of
   `ask_failed`/`ask_unavailable`, and outside our control.
2. Request rate limit hit.
3. Question exceeds input limits.
4. Platform-wide issue → **SR-008**.

## Safe diagnostic steps

1. **Exact error text or code.** *(L1 OBSERVABLE.)*
2. **Reproducible, or one-off?** One-off strongly suggests upstream transience.
   *(L1 OBSERVABLE.)*
3. **One user or the whole org?** Whole org suggests provider or platform.
   *(L1 OBSERVABLE.)*
4. **Is the rest of the product working?** If not → SR-008. *(L1 OBSERVABLE.)*
5. Provider status and upstream errors — *(L2/ENGINEERING ONLY.)*

## Evidence to collect

Error code, timestamp with timezone, organization slug, whether reproducible,
roughly what was asked — **not the full question if it contains customer-sensitive
content**, and never paste conversation content into external tools.

## Approved L1 actions

Advise retry after a short wait for rate limits; advise shortening over-long
questions; explain legal-hold behaviour.

## Actions L1 must NOT perform

- retry repeatedly on the customer's behalf during a provider incident
- promise an answer quality outcome
- delete conversations to "clear" a problem — deletion is customer-owned and may be
  blocked by legal hold for good reason

## Escalate when

Multiple organizations affected; `ask_unavailable` persists; failures continue
after the rate-limit window.

## Recovery

**None validated (SUP-PROC-1).** Upstream provider issues are Engineering.

## Recovery verification

The customer completes a successful Ask.

## Customer communication

> "That looks like the AI service having trouble rather than anything with your
> data. Give it a few minutes and try again — if it keeps happening I'll escalate
> with the exact time so we can see what came back."

## Observability

| Signal | Where | Level |
|---|---|---|
| Error code | Customer's screen | **L1** |
| Upstream provider errors | Engine logs | L2 |
| Provider status | Provider dashboard | L2 |
| Per-org Ask usage / rate-limit state | — | **NOT OBSERVABLE to support** |

**Missing:** support cannot confirm whether a customer is actually rate-limited
(**SUP-OBS-18**).

## Related

SR-008, SR-007 · `src/api/routes/ask.ts`
