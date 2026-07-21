# Enterprise Risk Graph — Convergence Report (C3 shadow)

- **Status:** Shadow instrumentation READY (C3). Empirical rates pending an operator
  staging enablement of `SECURELOGIC_SIGNAL_APPLICABILITY_ENABLED` (operator action —
  out of implementation scope). This report defines the measurement, states the
  structural prediction from the shipped code, and sets the retirement gate.
- **Companion:** `CONVERGENCE-ROADMAP.md` (C0–C9), `ENTERPRISE-RISK-GRAPH.md` (R1–R3).
- **Retirement:** the legacy path is **NOT** retired here and must not be without explicit approval.

## What the shadow compares

Per `(signal, org)`, in shadow mode (flag on, `MODE=shadow`), the engine runs BOTH:
- **Legacy (authoritative):** `runMatcherForSignal` — canonical **vendor/asset name**
  match of `cyber_signals.affected_vendor` against the org's active
  vendors/ai_systems/registry assets → the asset ids it would suggest/link.
- **Shadow (new):** `cyber_signals` → **Canonical Product** (C1, from
  `affected_vendor`+`affected_cve`) → **tenant asset resolver** (C2b, product→asset,
  org-scoped, R2-gated) → asset ids (or `needs_review`/`ambiguous`).

`compareApplicabilityShadow` (pure) categorizes each into: `agree`, `partial`,
`legacy_only` (false-**negative** candidates for the new path), `shadow_only`
(false-**positive** candidates), `both_empty`, `shadow_unresolved` (needs_review /
ambiguous). Counts-only telemetry (`signal_applicability_shadow`) is logged — no
customer surface, no writes to customer tables, legacy path authoritative.

## What the wired shadow compares (grain)

The C3 hook lives in the legacy **generic asset branch** of `runMatcherForSignal`, so
`legacyAssetIds` = the legacy **registry-asset** matches (`assetMatches`). Feeds conflate
vendor and product in `affected_vendor`, so the shadow treats it as a **product-name
hypothesis** (`canonicalProductIdentity({ vendor, product: affected_vendor, cve })`) and
resolves product→asset. This makes the shadow's match condition **identical** to the
legacy asset branch's (both `canonicalizeVendorName(asset.name) == canonical(affected_vendor)`)
— so on the registry-asset grain the two should largely **agree**, and the shadow's
value is the *differences*.

## Structural prediction (from the shipped code, pre-empirical)

| Case | Legacy (asset branch) | Shadow | Category |
|---|---|---|---|
| 0 registry assets match | `[]` | `no_match` | `both_empty` (agree) |
| exactly 1 matches | `[a]` | `resolved([a])` | `agree` |
| >1 match (tenant duplicate) | `[a,b]` (suggests both) | `ambiguous` → needs_review | `shadow_unresolved` |

So the expected story on this grain: **high agreement, with the only systematic
disagreement being that the new path routes ambiguous multi-matches to human review
instead of blindly suggesting all** — a *safety improvement*, not a regression.

**Critical limitation (honesty):** this hook does **not** compare the legacy
**vendor / ai_system** matches — the bulk of what the legacy matcher does. Those become
vendor/ai_system-typed suggestions, not registry-asset matches, and are outside
`assetMatches`. A signal that matches a *vendor* (not a registry asset) yields
`assetMatches = []` and a shadow `no_match`, recorded as `both_empty` — which **masks**
the fact that the legacy path found a vendor. **Agreement on this grain therefore
OVERSTATES true coverage** and must not be read as retirement evidence.

## Disagreement categories

1. **`shadow_unresolved` (tenant duplicates)** — >1 active asset shares a canonical
   name; the new path correctly routes to human `needs_review` while legacy suggests
   all. A safety-positive difference.
2. **`shadow_only`** — the shadow resolves an asset the legacy asset branch missed
   (e.g. a name normalized differently). Genuine recall gain, to verify.
3. **Unmeasured vendor/ai_system grain** — the dominant *gap*, invisible to this hook.

## False positives / false negatives

- **False positives (new path):** structurally near-zero — normalize-then-EXACT match
  to the org's own active asset only; ambiguous cases go to review, not assertion.
- **False negatives (new path):** on the asset grain, low (same match condition). But
  the **vendor/ai_system grain is entirely unmeasured**, so a true FN rate cannot be
  claimed from this shadow.

## Unresolved ambiguities

- **Tenant duplicates** (`multiple_active_assets_match_product`) → `needs_review` (never
  auto-decided).
- A CVE-only signal with an empty `affected_vendor` → `needs_review`
  (`no_product_name_for_asset_match`) — no identifier to resolve.

## C3b — vendor / ai_system → tenant-asset grain (now measured)

C3 measured only the registry-asset grain. **C3b** adds the **vendor** and
**ai_system** grains, reusing the same comparator, resolver, flag, and telemetry
event (extended with a `grain` field). For each legacy vendor/ai_system match:
- **legacy side** = the matched entity's **Tier-0 backing asset(s)** (`assets` where
  `backing_kind ∈ {vendors, ai_systems}`, `backing_id` = the matched entity), read-only;
- **shadow side** = resolve the entity's own name product→asset (C2b resolver);
- **compare** the two asset-id sets with the same categories.

Because a vendor/ai_system is registered as an asset named after itself, the
product→asset resolution should land on that **same backing asset** → `agree` when
one active asset carries that canonical name; `shadow_unresolved` when the org has a
duplicate; `both_empty` when the entity isn't registered/active or belongs to another
org (org-scoped — verified: another org's vendor never resolves).

### Telemetry — the report is built from `signal_applicability_shadow` events

Each event now carries: `grain` (`asset|vendor|ai_system`), `agreement`,
`shadow_status`, `shadow_reason`, and counts (`legacy_count`, `shadow_count`,
`agreed_count`, `legacy_only_count` = FN candidates, `shadow_only_count` = FP
candidates, `unresolved_ambiguity`). No tenant identifiers — counts only.

Aggregation to produce, **per grain and overall**:
- **Total comparisons** = event count.
- **Agreement rate** = `(agree + both_empty) / total`.
- **Disagreement categories** = histogram over `partial / legacy_only / shadow_only / shadow_unresolved`.
- **Unresolved / ambiguous rate** = `shadow_unresolved / total`.
- **Vendor vs AI-system breakdown** = group by `grain`.
- **False-positive review bucket** = signals with `shadow_only_count > 0` (shadow
  asserted an asset legacy didn't) — queue for human confirmation.
- **False-negative review bucket** = signals with `legacy_only_count > 0` (legacy
  matched an asset the shadow didn't resolve) — queue for human confirmation.
- **Examples with provenance** = the shadow logs are per-`(org, signal)`; join the
  `signalId`/`organizationId` on the event back to `cyber_signals` (source,
  affected_vendor/cve) + the matched entity for a fully-provenanced example row.
  *(Provenance is preserved — the shadow reads the same WORM-consistent inputs and
  writes nothing; no evidence is created or altered.)*

## Retirement readiness — **NOT READY**

All three grains (asset, vendor, ai_system) are now **instrumented**, but retirement
still requires evidence not yet in hand:

1. **Empirical rates must be collected in staging.** The shadow is dark; an operator
   must enable it (below) and run a representative window before any agreement rate is
   real. No rate = no retirement.
2. **The product hypothesis is the entity name reused as a product.** That reproduces
   legacy behavior but adds **no product/version precision**; genuine convergence (and
   any `affected` assertion under R2) needs **product-identifying feed data
   (CPE / product / version / SBOM)** — the highest-leverage next investment.
3. **A migration ruling** is needed on whether a vendor/ai_system-name→asset match may
   stand as `potentially_affected` during cutover, keeping R2 for `affected`.

Recommended retirement gate (per grain): agreement rate ≥ a ratified threshold for a
full release window, `shadow_only` (FP) reviewed to ~zero, `legacy_only` (FN) explained,
and the product-identifier gap (2) resolved for the classes being retired. Until then
the legacy vendor/AI linkage stays authoritative; the shadow keeps measuring.

## How to obtain the empirical numbers (operator)

1. In **staging** (never prod), set `SECURELOGIC_SIGNAL_APPLICABILITY_ENABLED=true`
   (mode defaults to `shadow`) on the engine service.
2. Run the ingestion pipeline over a representative signal window.
3. Aggregate the `signal_applicability_shadow` telemetry: agreement rate =
   `agree / total`; disagreement histogram over the categories; FP proxy =
   `shadow_only_count` sum; FN proxy = `legacy_only_count` sum; unresolved =
   `shadow_unresolved` share.
4. Compare against the prediction above; feed the retirement gate
   (`CONVERGENCE-ROADMAP.md` §12).

## Rollback criteria (shadow)

- Any measurable effect on the legacy path, latency regression, or error rate → set
  the flag `"false"` (shadow is try/catch-isolated and writes nothing, so rollback is
  immediate and lossless).
- The shadow never gates, writes, or surfaces — `MODE=surface` remains unbuilt until a
  ratified cutover.
