# Entitlement Alignment & Caps — Audit (launch-blocker items 8 + 9)

**Conclusion: already satisfied. No code change made — the goal's premise is stale,
and the implied "fix" would break a deliberate, tested contract.**

Audited 2026-06-23 against `develop`.

## Item 8 — "Engine under-gates the core platform at rank-2 (API leak)"

**Finding: there is no leak. Core-platform routes are uniformly `premium`-gated.**

Entitlement ranks (`requireEntitlement.ts`): `starter`=1, `professional`/`standard`=2,
`premium`/`platform`/`team`=4.

A **deliberate, tested two-bucket model** exists (`vendorEntitlementGate.test.ts`,
72 assertions, passing):

- **Bucket A — core platform → `premium` (rank 4), zero rank-2.** Verified premium
  with zero rank-2 gates across: `vendors`, `findings`, `risks` (+ treatments/
  settings/scale/scoringWeights), `controls` (+ mappings/assessments), `obligations`
  (+ mappings/assessments), `aiSystems` (+ governance), **`actions`** (GAP-3), and all
  `signal*Links` / `signalMatchSuggestions`.
- **Bucket B — Intelligence-Brief surface → `standard` (rank 2), never premium.**
  `posture.ts`, `topRisks.ts`, `dashboard.ts`, `intelligence*`, `subscribers`,
  `newsletterDeliveries`. These are the **rank-2 Brief dashboard** that paying
  Brief-Pro / Team customers consume (the test pins this explicitly: "rank-2
  dashboard consumes /posture/history → stays standard").

The goal framed `posture`/`topRisks`/`dashboard` as "core platform" leaking at
rank-2. They are **intentionally** Brief-surface. Re-gating them to premium would
lock Brief-Pro / Team customers out of their dashboard — a regression, not a fix.
The goal also notes "UI gating is correct"; the engine **matches** it.

PR #244 (the "partial vendor-slice fix") is **CLOSED** — the platform-wide gating
was completed via the Bucket A/B work, so #244 was superseded, not abandoned mid-fix.

**No genuinely-core-platform route is ungated or rank-2-gated.** (Ungated files are
all admin* [admin-key auth], auth/MFA/billing/customerAuth [auth flows], webhooks,
and dataExports [its own auth] — none are entitlement leaks.)

## Item 9 — "10-seat / 50-entity engine caps not enforced"

**Finding: both caps ARE enforced in the engine.**

- **50 monitored entities:** `enforceEntityLimit` (`entityLimit.ts`) — combined
  vendors + ai_systems counted against `organizations.max_monitored_entities`
  (default 50); over-cap creates return **409 `entity_limit_reached`** (wired on
  `POST /api/vendors`, `POST /api/ai-systems`). Shipped in the seat/entity-metering
  package (#248).
- **10 seats:** `teamInvites.ts` checks `organizations.max_members` (default 10) and
  returns **409 `seat_limit_reached`** on invite when seats are full; the invite
  endpoint also reports `seat_usage { used, max }`.

## Net

Items 8 and 9 require **no build**. The entitlement layer is aligned (Bucket A/B,
tested) and the base-tier caps are enforced. If a specific route is believed to be
mis-bucketed, that is a per-route product decision to raise explicitly — not a
blanket "re-gate to premium," which the tested Bucket-B contract forbids.

Remaining genuinely-unbuilt billing item: **Brief-Team → Platform credit mechanic**
(separate task) — pricing locked it TBD; that is real unbuilt logic, distinct from
the gating audited here.
