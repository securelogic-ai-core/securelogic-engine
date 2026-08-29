# ADR-0011 — ADMIN-NET-1: admin network allowlisting is a deferred, observational control

- **Status:** **ACCEPTED (2026-08-21).** Operator ruling, delivered in-session by
  the sole SecureLogic operator.
- **Date:** 2026-08-21
- **Applies to:** `src/api/middleware/requireAdminNetwork.ts`,
  `SECURELOGIC_ADMIN_NETWORK_ENFORCED`, `SECURELOGIC_ADMIN_ALLOWED_IPS`,
  the `adminChain` in `src/api/routes/index.ts`.
- **Related:** ADR-0006 (platform scope boundaries); ADMIN-ACCESS-2 and
  ADMIN-AUDIT-1 in `docs/backlog/SECURITY_BACKLOG.md`.

---

## Decision

**`SECURELOGIC_ADMIN_NETWORK_ENFORCED` must NOT be enabled in staging or
production under the current operating model.** The admin-network middleware
remains **observational**: it resolves the client, classifies it against the
allowlist, emits `admin_network_evaluated`, and refuses nothing.

**The control is preserved, not removed.** Specifically retained:

- `requireAdminNetwork` stays **first** in `adminChain`.
- Its telemetry stays, including `admin_network_evaluated` and
  `admin_network_error`.
- The corrected client-identity resolution via `infra/clientIp.ts` — preferring
  Cloudflare's unforgeable `CF-Connecting-IP` — stays. It must not regress to
  `req.ip`.
- The allowlist capability itself stays.

**And explicitly:**

- The operator's dynamic public IP **must not become a production authorization
  dependency.**
- `SECURELOGIC_ADMIN_ALLOWED_IPS` **must not be repeatedly updated to chase** a
  changing public address. That is an availability hazard disguised as a control.

**Classification: ADMIN-NET-1 — DEFERRED ENFORCEMENT / OBSERVATIONAL CONTROL.**
It is **not** an incomplete launch blocker.

---

## Context

The sole operator administers the platform primarily from an iPad, on a public
IP that changes with Wi-Fi, cellular, location and ISP behaviour. There is no
stable trusted egress address to allowlist.

Enforcing against a moving address has one predictable outcome: the operator is
locked out of production admin — including the very endpoints used to diagnose
being locked out. The middleware's own header records the precedent. Measured on
live staging 2026-08-11, one client arrived as `172.70.134.76` and its next
request as `172.71.190.23`, both Cloudflare edge nodes, because Render fronts
every service with Cloudflare and `trust proxy` is 1. Enforcing while the code
read `req.ip` would have returned **401 on 100% of production admin requests**.

That specific defect is fixed — resolution now runs through `clientIp.ts`. But
the fix makes the control *correct*, not *appropriate*. Correctness was never
the blocker; a stable address to allowlist is, and one does not exist.

**The allowlist has also never been validated.** It holds two addresses that
predate the `clientIp` fix and have never once been compared against a
correctly-resolved client IP, because until that fix no code path produced one.

---

## The truthful security statement — verified, with one correction

The operator proposed recording:

> *"SecureLogic administrative access is identity/credential restricted. Network-origin
> classification is logged for security telemetry but is not currently an enforcement
> boundary because the sole operator does not have a stable trusted egress address."*

Verified against the implementation. The second sentence is **accurate**. The
first is **not**, in one word, and the standing rule is that we do not claim
controls the code does not enforce.

**There is no administrator *identity*.** `requireAdminKey` compares a bearer
value from the `x-admin-key` header against `SECURELOGIC_ADMIN_KEY`, a static
shared secret (optionally a comma-separated rotation set, max 10). There is no
per-person account, no MFA, no session, and no way to tell which human acted.
That is a **credential**, not an identity.

**The accurate statement, and the one to use:**

> **SecureLogic administrative access is credential-restricted**, using a
> timing-safe comparison against a rotatable shared admin key, with Redis-backed
> IP lockout and rate limiting, failing closed when misconfigured.
> **Network-origin classification is resolved and logged for security telemetry
> but is not an enforcement boundary**, because the sole operator has no stable
> trusted egress address.
> **Administrative actions are not yet attributable to an individual**, and
> administrative audit is presently application-log telemetry rather than a
> durable, queryable audit record. Both are tracked as ADMIN-ACCESS-2 and
> ADMIN-AUDIT-1.

Use that wording in any security questionnaire, customer answer, or trust
document. Do not shorten it back to "identity-restricted".

---

## What actually protects `/admin` today — audited, not assumed

`adminChain`, in execution order, applied at `router.use("/admin", ...)` **before**
every one of the 32 admin route modules:

| # | Middleware | What it actually does | Failure mode |
|---|---|---|---|
| 1 | `requireAdminNetwork` | Resolves the client via `clientIp.ts`, classifies against the allowlist, logs `admin_network_evaluated` | **DARK** — classifies and continues. Refuses nothing. Fails *closed* only when enforcement is on |
| 2 | `adminLockout` | Redis-backed. 5 failures / 10-min window → 15-min lockout, shared across instances, keyed on the resolved client | **Fails closed** — 503 if Redis is not ready |
| 3 | `requireAdminKey` | Timing-safe `crypto.timingSafeEqual` over a length-checked (16–256) value; constant work across the rotation set; never logged | **Fails closed** — 500 `server_misconfigured` if the key is unset/invalid; 401 otherwise |
| 4 | `adminRateLimit` | Redis, 300 requests / 60s, keyed on `resolveThrottleIdentity` | **Fails closed in production** (503); fails open in dev |
| 5 | `adminAudit` | Logs `admin_request` — method, route, status, duration, requestId. Never logs the key or auth headers | Telemetry only |

**Verified positives:**

- Ordering is correct and deliberate: an off-network caller would be rejected
  before it can burn a lockout counter legitimate admins share, before any
  timing-safe comparison, and before it consumes rate-limit budget.
- The admin key travels in a **header**, not a query string, so it does not land
  in request logs the way reset/verify tokens have elsewhere in this platform.
- Key comparison is constant-work across the rotation set: a mismatch still
  performs a dummy compare.
- Failed authentication is recorded — `admin_auth_failed` and
  `admin_lockout_triggered`.
- The key is never logged anywhere in the chain.
- No bypass path was found. **No P0.**

---

## Material weaknesses found

### ADMIN-AUDIT-1 — administrative actions are not durably audited (**P1**)

`adminAudit` writes `logger.info`. That is **stdout**, retained by the hosting
provider, not by the product. It is not queryable, not tenant-linked, not
covered by any retention policy this platform controls, and not usable as
evidence.

**Measured: 1 of 32 admin route modules writes a durable audit row.** Only
`adminProviderSuppressionRecovery.ts` does — appropriately, since it mutates a
shared external mail account.

For a governance, risk and compliance product this is a credible finding against
us in our own customers' vendor reviews. A durable helper already exists
(`src/api/lib/auditLog.ts`), so the fix extends an established pattern rather
than inventing one.

**Not launch-critical**, and therefore not implemented in this task per the
standing instruction: `/admin` is not reachable without the key, the chain fails
closed, and telemetry does exist. It is a P1 for the Enterprise Capability
Baseline.

### ADMIN-ACCESS-2 precondition — authentication without identity (**P1, scoped by operating model**)

One shared static credential means administrative actions cannot be attributed
to a person, and `adminAudit` has no actor field to populate even if it wrote
durably.

**With a single operator this is a limitation, not an exploitable weakness.** It
becomes P1-blocking the moment a second human needs administrative access —
which is exactly the role separation recorded for the Enterprise Capability
Baseline.

### Observation (P2) — shared lockout bucket on unparseable client

`adminLockout` falls back to a **single shared bucket** when no client address
is parseable, so one abusive caller could lock out everyone. Behind Cloudflare a
`CF-Connecting-IP` should always be present, so this should not trigger in the
deployed topology. Recorded, not actioned.

---

## Prerequisite for future enforcement

> **A stable, independently recoverable trusted administrative network path must
> exist and be validated before network allowlisting becomes an authorization
> boundary.**

"Independently recoverable" is load-bearing: the recovery path must not depend
on the administrative plane it protects. An allowlist whose break-glass lives
behind the allowlist is not a control, it is a single point of failure with
audit logging.

Enforcement may be revisited when SecureLogic has an appropriately designed VPN,
a zero-trust administrative access layer, fixed corporate egress, or equivalent.
**No vendor is chosen here.** See ADMIN-ACCESS-2.

When that day comes, the sequence is already built for it: dark mode emits
`admin_network_evaluated` with the resolved IP, its source and the would-be
verdict. Observe → prove → enforce. A `source` of `"express"` behind Cloudflare
means the trusted header did not arrive and the address under test is a CDN
node; that is treated as NOT allowed under enforcement, because silently
allowlisting a CDN edge would hand admin access to everyone sharing it.

---

## Consequences

- `/admin` remains credential-restricted with network classification logged.
  Say it that way.
- The `admin_network_evaluated` stream accumulates the evidence a future
  enforcement decision will need, at no availability cost.
- ADMIN-NET-1 is **not** a Sept 15 blocker and must not be counted as one.
- ADMIN-AUDIT-1 and ADMIN-ACCESS-2 enter the security backlog for the Enterprise
  Capability Baseline.

## Enforcement

- Do **not** set `SECURELOGIC_ADMIN_NETWORK_ENFORCED=true` in any environment
  without superseding this ADR.
- Do **not** remove the middleware, its telemetry, or the `clientIp.ts`
  resolution.
- Do **not** add the operator's current IP to the allowlist as a workaround.
- Any PR that changes admin network behaviour must reference this ADR.
