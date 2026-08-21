# Security

## Reporting a vulnerability

If you believe you have found a security vulnerability in SecureLogic AI, please
report it to **the SecureLogic security contact** (see the contact address
published on securelogicai.com), with:

- what you found and where
- the steps to reproduce it
- what you believe the impact is
- whether you have shared it with anyone else

**Please do not:**

- test against other customers' data, or attempt to access any tenant that is not
  your own
- run automated scanning or load-generating tests against production
- publicly disclose before we have had a chance to respond

**What to expect:** we acknowledge reports promptly and will tell you when we have
triaged it. We do not currently operate a paid bug-bounty program, and we will not
promise a reward.

Confirmed reports are handled under our
[incident response process](docs/security/INCIDENT-RESPONSE.md) and tracked to
remediation in SecureLogic itself — as a vulnerability finding with a severity, an
owner, a remediation SLA and evidence at closure.

## Reporting a suspected incident as a customer

If you are a SecureLogic customer and you believe you can see data that is not
yours, or that your account has been accessed by someone else, **contact support
immediately and do not delete what you have seen** — we may need it to understand
what happened.

Support will escalate it as a priority. See
`docs/runbooks/support/SR-009-suspected-cross-tenant-exposure.md` and
`SR-010-suspected-account-compromise.md` for how those reports are handled.

## Scope

This policy covers the SecureLogic AI platform and its supporting services. It does
not cover vulnerabilities in a customer's own estate — those are what the product
is for, and belong in your own vulnerability findings.

## Our own security posture

Multi-tenant isolation is enforced in the database with row-level security scoped
to the requesting organization, asserted by a dedicated isolation test suite that
runs on every change. Security-relevant events are written to an append-only audit
log that cannot be modified or truncated.

Known gaps are tracked in `docs/backlog/SECURITY_BACKLOG.md` rather than left
undocumented.
