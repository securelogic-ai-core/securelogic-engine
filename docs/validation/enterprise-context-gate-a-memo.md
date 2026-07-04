# GATE A — Enterprise Context access model, AD-17 grant shape, entity/edge caps

**Status: BLOCKED — awaiting Simmee ruling.** Per the goal, Item 9 (Enterprise gating) and
production enablement cannot proceed until these three are decided. Everything built so far
(Items 1–8) is DARK and additive; nothing here changes until the ruling is implemented as its
own slice. This memo states the problem, the options, and a recommendation for each.

Prepared 2026-07-04. Grounded in the real code: `src/api/middleware/requireEntitlement.ts`,
`src/api/lib/enterpriseContextFeatureFlag.ts`, `src/api/lib/enterpriseEntityLimit.ts`,
`organizations.max_enterprise_entities`.

---

## The problem (why this is a ruling, not a default)

ECL routes are gated by `requireEntitlement("premium")`. In the current model
(`requireEntitlement.ts`) **`premium` is rank 4 and collapses `premium` / `platform` / `team`
into one level** — there is no distinct "enterprise" rank. So today ECL would reach **every
rank-4 org**: Platform Professional, Brief Team, AND Enterprise, indistinguishably. The
commercial display tiers are Intelligence Brief (Free) · Brief Pro · Brief Team · Platform
Professional · Enterprise, but the internal entitlement keys don't carry a distinct Enterprise
capability. This is AD-17. Until it's ruled, enabling the flag would expose Enterprise Context
to non-Enterprise customers.

---

## Decision 1 — Platform-vs-Enterprise access model

Who is ECL (enterprise entities, graph, applicability, connectors) *for*?

- **Option 1A — Enterprise-tier only (RECOMMENDED).** ECL is the Enterprise wedge; only
  Enterprise orgs get it. Cleanest commercial story, matches the "Enterprise Context" naming,
  and the caps/scale concerns (H1/H2) are bounded to a small, high-touch cohort.
- **Option 1B — Platform Professional + Enterprise.** ECL ships to all "platform" customers.
  Broader reach, but exposes the unbounded-edge (H1) and recursive-graph-load (H2) risks to a
  much larger cohort before those are hardened, and weakens Enterprise differentiation.
- **Option 1C — Add-on capability, tier-independent.** ECL is a purchasable add-on any paid tier
  can buy. Most flexible commercially; most work (billing SKU + capability plumbing) and the
  fuzziest packaging story.

**Recommendation: 1A.** It's the tightest blast radius for the un-hardened scale paths and the
clearest packaging. 1C is a fine *future* once ECL is proven.

## Decision 2 — AD-17 grant shape (how "Enterprise" is distinguished)

- **Option 2A — Per-org capability grant column (RECOMMENDED).** Add
  `organizations.enterprise_context_enabled BOOLEAN` (or a `capabilities JSONB`) + a
  `requireCapability("enterprise_context")` middleware checked *in addition to* the flag.
  Decouples the grant from the tier rank, so Enterprise can be granted per-org (and to design
  partners / pilots) without reworking the entitlement ladder. Matches AD-17's "capability grant"
  language. Operator sets the column (no code deploy) to onboard an Enterprise org.
- **Option 2B — New `enterprise` entitlement rank (5).** Extend `EntitlementLevel` +
  `entitlementRank` + the org-tier resolution so `enterprise` outranks `premium`. Simple mental
  model, but touches the shared entitlement ladder (blast radius beyond ECL) and can't grant ECL
  to a pilot without moving their whole tier.
- **Option 2C — Stripe-metadata-only.** Derive Enterprise from Stripe product metadata at
  context-attach time. No schema change, but couples a security gate to billing state and is
  hard to grant for non-Stripe/manual Enterprise deals.

**Recommendation: 2A.** A capability column is the least-blast-radius, most-operable grant, and
composes with the existing feature flag (flag = global kill-switch; capability = per-org grant).

## Decision 3 — Entity + edge caps

- **`max_enterprise_entities`** already exists as a per-org column (separate counter, enforced by
  `enforceEnterpriseEntityLimit`). Its *value* is unset/operator-tunable.
- **Edge cap (H1)** — `enterprise_relationships` writes are currently **unmetered** (a prod-enable
  gate). Needs a companion cap before enable.

- **Option 3A — Conservative defaults, operator-tunable via UPDATE (RECOMMENDED).** Ship
  Enterprise defaults (proposed: **`max_enterprise_entities` = 10,000**, **`max_enterprise_edges`
  = 50,000** per org) as column defaults; operator raises per-org by `UPDATE` (no DDL). Add the
  edge cap column + `enforceEnterpriseEdgeLimit` in the Item 9 slice. Numbers are a starting point
  for the H2 load test (Item 10) to validate, not a promise.
- **Option 3B — High/uncapped for Enterprise.** Matches "Enterprise = big," but leaves H1/H2
  unbounded — unsafe until the recursive-graph load test (Item 10) proves the resolver holds at
  that fan-out.
- **Option 3C — Tiered caps (Platform vs Enterprise).** Only meaningful if Decision 1 is 1B/1C.

**Recommendation: 3A**, with the specific default values to confirm. The Item 10 scale work will
pressure-test them and can propose revisions with real EXPLAIN/latency numbers.

---

## What implementing the ruling looks like (Item 9 slice, after the ruling)

1. Decision 2 grant: migration (capability column, default false) + `requireCapability` middleware,
   mounted alongside the ECL flag on every ECL route; tests (granted vs not → 200 vs 404/403).
2. Decision 3 edge cap: `organizations.max_enterprise_edges` (+ default) + `enforceEnterpriseEdgeLimit`
   on the edge-create path; tests (at/over cap → 409).
3. Ledger: the operator action to grant the capability per Enterprise org (and to tune caps).
4. Still DARK until GATE B (production enablement is out of this goal's authority).
