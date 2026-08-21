# SR-030 — Cannot link a finding to the Risk Register, or promotion fails

| | |
|---|---|
| **Playbook ID** | SR-030 |
| **Domain** | Findings / Risk |
| **Severity default** | SEV3 |
| **Owning level** | L1 triage → L2 |
| **Release dependency** | **Requires the `develop` → `main` promotion.** Unflagged — the routes are live on promotion. |
| **Feature flag** | The **Decision Workspace** UI is `false` in production; the Risk Register panel renders in both layouts, so linking is reachable either way. |
| **Last validated** | 2026-08-21 against `develop@58cccb2c` |
| **Status** | Diagnosis VALIDATED. **No recovery procedure — SUP-PROC-1.** |

## Customer-visible symptoms

Link or promote fails; the risk picker is empty; promotion asks for ratings the
customer expected to be filled in.

## What the error codes mean

| Code | Meaning |
|---|---|
| `risk_not_found` / `finding_not_found` | The id is not this organization's, or does not exist. **Deliberately undifferentiated** — distinguishing them would let the endpoint reveal other tenants' ids |
| `risk_id_required` | No risk selected |
| `link_not_found` | Already unlinked, or not theirs |
| `finding_promote_to_risk_failed` | Promotion rejected — usually incomplete ratings |

## Likely causes

1. **Promotion requires the full rating set** and the customer expected defaults.
   Title and domain default from the finding; **ratings never do** — a rating the
   platform invented would be one nobody can defend in an audit.
2. The risk picker is bounded to active risks — the one they want may not be listed.
3. Seat/permission: deciding a finding belongs on the register is a governance act
   and contributor-level seats are denied.
4. Already linked.

## Safe diagnostic steps

1. **Link, or promote?** Different paths, different causes. *(L1 OBSERVABLE.)*
2. **Exact error text.** *(L1 OBSERVABLE.)*
3. **For promotion, which fields are empty?** *(L1 OBSERVABLE.)*
4. **Does the customer's role allow it?** Their admin can confirm.
   *(L1 OBSERVABLE.)*
5. Whether the link row exists — *(L2/ENGINEERING ONLY.)*

## Approved L1 actions

Explain that promotion asks for ratings by design. Guide to completing them, or to
linking to an existing risk instead.

## Actions L1 must NOT perform

- create the risk on the customer's behalf
- **suggest plausible ratings** — the register's value is that a named person
  stands behind each entry
- link or unlink records

## Escalate when

A risk the customer can see is rejected as not-found; linking succeeds but the link
does not appear; **any risk or finding from another organization is visible** →
**SR-009, SEV1**.

## Recovery

**None validated (SUP-PROC-1).**

## Customer communication

> "Promotion deliberately asks you for the likelihood and impact rather than
> guessing them — a rating we invented wouldn't have anyone behind it if an auditor
> asked. If you'd rather attach it as evidence to a risk you already have, that's the
> 'link' option and it doesn't need ratings."

## Observability

| Signal | Where | Level |
|---|---|---|
| Error text | Customer's screen | **L1** |
| Risk Register panel state | Finding detail | **L1** |
| `finding.risk_linked` / `promoted_to_risk` audit events | `security_audit_log` | L2 |

## Related

SR-024, SR-033 · `src/api/routes/findingRiskLinks.ts` · ADR-0004
