# Gate 3 — Checkout validation (staging) — RESULT

**Verdict:** ⏳ **PENDING OPERATOR VALIDATION** (not FAIL — code prerequisites PASS; operator checkout validation outstanding)
**Evaluated:** 2026-07-01

## Status summary
- **Code prerequisites:** ✅ verified (tier→price map, allow-list, invalid-tier rejection, 503-on-missing-var, UI-label consistency — see below).
- **Operator checkout validation:** ⏳ outstanding (4 Stripe checkout-page totals + 4 Price-object cross-checks + screenshots — see "Operator handoff").
- **Code remediation:** none required at this time.
- **This is NOT a FAIL** — no defect was found. The gate simply cannot close without the operator-only Stripe evidence.

**Runbook:** `docs/launch/OPERATOR_RUNBOOK.md` → Gate 3 (lines 145–189)
**Release gate:** `docs/launch/RELEASE_CHECKLIST.md` §4 (billing gates)

---

## Why this is not a machine-executable PASS

Gate 3's PASS criteria are **dollar amounts read off Stripe-hosted checkout
pages and Stripe Price objects**, captured as screenshots (runbook :172–177).
The authoritative amount is the **Stripe Price** — "only catchable by exercising
checkout and reading the Stripe Price," which is exactly why the gate exists.
That requires a browser, a Stripe test-card session, and Stripe Dashboard
access — none available to the automated session. Code and UI labels **cannot
substitute** for the Stripe Price.

---

## Expected amounts (runbook)

| Tier token | Plan | Expected |
|---|---|---|
| `professional` | Brief Pro | $49.00 / mo |
| `teams` | Team Professional | $199.00 / mo |
| `platform` | Platform Professional | $800.00 / mo |
| `platform_annual` | Platform Annual | $7,200.00 / yr ($600/mo billed annually) |
| (invalid) | — | rejected (`400 invalid_tier`) |

---

## Code-side pre-checks (machine-verified — SUPPORTING, not a substitute)

✅ **Tier → Price env-var map** (`src/api/routes/billing.ts:89-98`): each tier
resolves to its own `STRIPE_PRICE_ID_*` var — `professional`→`STRIPE_PRICE_ID_PROFESSIONAL`,
`teams`→`_TEAMS`, `platform`→`_PLATFORM`, `platform_annual`→`_PLATFORM_ANNUAL`.

✅ **Allow-list** (`billing.ts:87`): `VALID_TIERS = {professional, teams, platform, platform_annual}`.

✅ **Invalid-tier rejection** (`billing.ts:117-123`): unknown tier → `400 invalid_tier`
**before** any Stripe call (returns before the `checkout.sessions.create` at :162).
Verified by inspection only — a live test needs a staging API key (the check sits
behind `requireApiKey`, :113), which the session does not handle.

✅ **Missing env var** (`billing.ts:130-137`): unset `STRIPE_PRICE_ID_*` → `503 billing_not_configured`.

✅ **UI-label drift check** (runbook flags this at :157) — all in-app surfaces are
internally consistent with the expected amounts:
- $49/mo: `signup/SignupForm.tsx:32`, `verify-email/page.tsx:29`, `account/page.tsx:286`, `components/UpgradeCard.tsx:59`, `pricing/page.tsx:20`
- $199/mo: `SignupForm.tsx:33`, `verify-email:30`, `account:295`, `UpgradeCard:92`, `pricing:35`
- $800/mo: `SignupForm.tsx:34`, `verify-email:31`, `account:304`, `UpgradeCard:72`
- $600/mo billed annually (= $7,200/yr): `SignupForm.tsx:35`, `verify-email:32`, `account:313`, `UpgradeCard:84`
- Public `/pricing` shows only $49/$199 (Platform tiers omitted) — matches runbook §0.3 note; not a Gate 3 blocker.

**Caveat:** these labels are hardcoded UI strings, NOT the Stripe Price. They
prove internal consistency and rule out label drift; they do **not** prove the
Stripe Price charges the right amount. Gate 3 exists precisely to catch a Stripe
Price that disagrees with these labels.

---

## Operator handoff — what closes Gate 3

Prerequisite: confirm `STRIPE_PRICE_ID_PROFESSIONAL/_TEAMS/_PLATFORM/_PLATFORM_ANNUAL`
are set on the **staging** engine (else checkout returns `503`, not Stripe).

On staging (test mode), for each of the 4 tiers, with test card `4242 4242 4242 4242`:
1. Start checkout; read the Stripe-hosted page total; confirm it matches the table.
2. Cross-check each Stripe **Price object** `unit_amount` × `interval`.
3. Confirm an invalid tier is rejected (`400 invalid_tier`).

**Evidence required:** screenshots of the 4 Stripe checkout pages + the 4 Stripe
Price objects.

---

## Rollback
**None required.** Gate 3 is read-only validation; no code/config changed. Operator
test-mode checkouts create no live charges.
