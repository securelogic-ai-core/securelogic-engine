# Support runbooks in the Definition of Done

## The single question

When a package changes customer-facing behaviour, ask **once**:

> **Does this change introduce or materially change a customer-visible failure
> mode, an operator recovery action, a security escalation path, or a support
> diagnostic?**

**If yes** — the corresponding support runbook is created or updated **in the same
package**, and the PR says which one.

**If no** — nothing is required. Say nothing. Do not add "no runbook needed" to
the PR; a ritual answer to a question nobody asked is how a check becomes noise.

## This is deliberately not a checklist

There is no template box, no required section, no reviewer sign-off line. A
support-documentation step that fires on every PR gets satisfied rather than
answered, and a runbook written to satisfy a box is worse than no runbook — it
looks like coverage.

## Almost always NO

- pure refactors, renames, type-only changes
- test-only changes
- performance work with no behaviour change
- dependency bumps
- documentation
- anything behind a flag that is **off in production** — the failure mode is not
  reachable by a customer yet. Write the runbook in the package that **turns the
  flag on**, when the behaviour becomes real. (This is why the vulnerability and
  occurrence runbooks are deferred rather than missing.)

## Almost always YES

- a new customer-visible error code or failure state
- a change to what a customer sees when something fails
- a new operator recovery action, or a change to an existing one
- anything that changes what support may safely do, or removes something they
  could do before
- a new security escalation trigger
- **a flag flip that makes previously-dark behaviour reachable in production**

## Worked examples from this repository

| Change | Runbook needed? | Why |
|---|---|---|
| SL-VULN-1 — vulnerability source type | **Not yet** | Real, merged to `develop`, unreachable in production |
| SL-OCC-1 — `409 asset_has_vulnerability_occurrences` on asset delete | **Not yet** | New operator-visible refusal, but the surface is not live |
| Promoting `develop` → `main` with the above | **YES** | Everything deferred above becomes reachable at once |
| `BILLING_GRACE_ENABLED` → true in production | **YES** | Changes what a delinquent customer sees and when |
| Typing a test fixture to `Record<string,string>` | **No** | Nobody outside CI can observe it |
| Adding `cross-org-isolation` assertions | **No** | Test-only |

## Where this is enforced

In review, by a human, as part of reading the diff — not by tooling. The cost of
missing one is a support gap; the cost of automating it is that every PR grows a
paragraph of untruthful ceremony.
