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

## Retirement readiness — **NOT READY**

Even if the empirical asset-grain agreement is high, the legacy path **cannot be
retired**, for two reasons the shadow makes explicit:

1. **The vendor / ai_system grain — the bulk of legacy coverage — is not yet measured.**
   A fuller shadow must project the legacy vendor/ai_system matches to their backing
   assets and compare those too. Until that agreement is measured, retirement is
   unevidenced.
2. **The product hypothesis is `affected_vendor` reused as a product name.** That
   reproduces the legacy behavior but does **not** add product/version precision; genuine
   convergence (and any `affected` assertion under R2) needs **product-identifying feed
   data (CPE / product / version / SBOM)**. That is the highest-leverage next investment.

Recommended before any retirement decision: (a) extend the shadow to the
vendor/ai_system→asset grain; (b) enable the flag in **staging** and collect real
telemetry; (c) rule on whether a vendor-name→asset match may stand as
`potentially_affected` during migration (keeping R2 for `affected`). Until then the
legacy path stays authoritative; the shadow keeps measuring.

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
