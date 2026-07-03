# Gate 1 — Stripe Billing Portal configuration — RESULT

**Verdict:** ✅ **PASS (with documented limitation)**
**Evaluated:** 2026-07-01T19:39:59Z
**Runbook:** `docs/launch/OPERATOR_RUNBOOK.md` → Gate 1 (lines 54–99)
**Sprint / branch context:** `fix/sprint3h-billing-portal-client-submit`

---

## PASS criteria evaluation

Runbook PASS criteria (OPERATOR_RUNBOOK.md:85–86): *"Both vars set on both
services; both redeployed; staging 'Manage billing' opens the portal and returns
to /account."*

| # | Condition | Status | Source of truth |
|---|-----------|--------|-----------------|
| 1 | Both vars set on both services | ✅ | Operator-attested (secrets are `sync:false`; not machine-readable): `STRIPE_PORTAL_RETURN_URL` verified correct; `STRIPE_PORTAL_CONFIGURATION_ID` = captured **live-mode** `bpc_` value |
| 2 | Both services redeployed | ✅ (prod attested, not machine-provable) | Prod `/version` confirms engine up on commit `959951b9`/`main`; redeploy *timing* is **operator-attested via the Render deploy event** (`/version deployedAt` is request-time, not deploy time — see caveat below). Staging operator-attested |
| 3 | Staging "Manage billing" opens + returns to `/account` | ✅ | Operator-attested — staging functional validation passed on the same code path + equivalent Stripe **test-mode** portal configuration |

The runbook's functional browser click-through is **staging-only** (step 4,
OPERATOR_RUNBOOK.md:74; evidence requirement :83). Production's Gate 1
obligations are **config-only** (steps 2–3, :72–73). There is **no** production
customer browser step in Gate 1.

---

## Evidence — production engine health/config (machine-verified)

Command: `curl https://securelogic-engine.onrender.com/version` and `/health`
Captured: 2026-07-01T19:39–19:42 UTC

```
GET /version  → 200
{"commit":"959951b9b34cd089f3bb0aaa561950404519ced1","service":"securelogic-engine","branch":"main","deployedAt":"<request-time — see caveat>"}

GET /health   → 200
{"status":"ok","db":"connected"}
```

What `/version` reliably proves (fields sourced from Render build env,
`src/api/routes/index.ts:182-184`):
- Engine is **up and healthy**, DB **connected**.
- Running **commit `959951b9`** on **`main`** (`RENDER_GIT_COMMIT` / `RENDER_GIT_BRANCH`).

### ⚠️ Caveat — `deployedAt` is NOT a deploy timestamp
`/version` computes `deployedAt: new Date().toISOString()` at **request time**
(`src/api/routes/index.ts:185`), not at deploy time. Observed proof: two checks
minutes apart returned different `deployedAt` (`19:34:04Z` → `19:42:06Z`) for the
**same commit**. Therefore `deployedAt` **cannot** be used to confirm a redeploy
or reconciled against the Step 3 redeploy timestamp. **Do not use it as deploy
evidence.**

### Authoritative redeploy confirmation (operator-only)
Redeploy timing must come from the **Render deploy event** for
`securelogic-engine`: confirm the deploy shows commit `959951b9` and occurred
**after** the `STRIPE_PORTAL_CONFIGURATION_ID` save. This is the timestamp the
operator recorded in Step 3. A deploy after the env save ⇒ the var is in the
running process (Render applies env changes on deploy). Confirmation that the
var *value* is correct remains the deferred functional test below.

---

## Documented limitation (residual risk carried past Gate 1)

Per operator decision, **no synthetic/fake customer was created in production.**
Consequently:

1. The prod `STRIPE_PORTAL_RETURN_URL` *value* and the live `bpc_` config's
   *capabilities* are operator-attested, not independently observed (secrets +
   live Stripe — not machine-verifiable from the repo).
2. The production Manage-Billing path has not been exercised end-to-end against a
   real subscription.

Mitigation basis: staging validated the identical code path
(`app/src/app/api/billing/portal/route.ts`, `src/api/routes/billing.ts:212`) with
an equivalent test-mode portal configuration.

### Deferred production acceptance
The **first real customer/admin subscription's first Manage-Billing session** is
the deferred production validation. At that time confirm:
- portal opens (no `billing_error=portal_failed`, no `billing_not_configured`),
- plan-change + cancel options visible (confirms live `bpc_` config applied),
- browser returns to prod `/account`,
- engine logs show no `billing_portal_misconfigured` / `portal_failed`.

This closes the limitation without ever creating a synthetic production customer.

---

## Sequencing note
Gate 3 (checkout validation) is **NOT** started — awaiting explicit operator
approval.
