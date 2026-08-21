<!--
Copy this file to SR-<NNN>-<slug>.md and fill every section.

RULES THAT KEEP THESE USABLE:
  * Written for someone at 2am who has never seen the code. Short sentences.
  * Every diagnostic must be runnable from the tools support actually HAS.
    If a step needs database access or source reading, it is not a support step —
    it is an escalation, and it belongs under "Escalate when".
  * Never put a credential, DSN, tenant identifier, customer email or internal
    hostname in here. Reference the secret store by name instead.
  * If a recovery step has not been proven safe, mark it UNVALIDATED. Do not
    dress up an untested procedure as a procedure.
  * Delete sections that genuinely do not apply. Do not leave "N/A" everywhere —
    it trains people to stop reading.
-->

# SR-NNN — <Title>

| | |
|---|---|
| **Playbook ID** | SR-NNN |
| **Domain** | Authentication / Billing / Documents / Findings / Vulnerabilities / AI / Email / Availability / Data & Privacy / Security |
| **Severity default** | SEV1 / SEV2 / SEV3 / SEV4 |
| **Owning level** | L1 / L2 / Engineering / Security |
| **Last validated** | YYYY-MM-DD against `<develop SHA or release>` |
| **Status** | VALIDATED / PARTIALLY VALIDATED / UNVALIDATED |

## Customer-visible symptoms

What the customer says, in their words. Include the exact on-screen message or
error code where one exists.

## Business impact

Who is blocked from doing what. State whether money, evidence, or an audit
deadline is involved — that is what decides urgency, not the stack trace.

## Severity & escalation classification

Why this is the severity above, and what would raise or lower it.

## Likely causes

Ordered most→least common. Say which are self-service, which need L2, which are
defects.

## Safe diagnostic steps

Numbered. Each step says what to run/look at and **what the answer means**. Every
step here must be safe to run against production with no side effects.

## Evidence to collect

The minimum an escalation needs so the next person does not start over:
request ID, timestamp with timezone, organization slug (not name), the error
code, what the customer was doing. **Never paste tokens, cookies or full URLs
containing query strings.**

## Approved support actions

What this level may do, explicitly. If none, say "None — diagnosis only."

## Actions support must NOT perform

The specific dangerous-and-tempting ones for this failure. Be concrete.

## Escalate when

The trigger conditions, not a vague "if unsure".

## Escalate to

Named destination. Include the security path where relevant.

## Recovery / rollback

The procedure, or **UNVALIDATED — do not attempt without Engineering**.

## How to verify recovery

The observable that proves it worked, from the customer's side where possible.

## Customer communication

What to say while diagnosing, and what to say at resolution. Plain language, no
internal architecture, no speculation about cause.

## Observability

| Signal | Where | Who can see it |
|---|---|---|
| | | |

**Missing observability:** what support cannot currently see and needs.

## Related

Code paths, runbooks, ADRs, prior incidents.
