# Vendor Onboarding 2.0 — Methodology v1 (FROZEN)

**Status:** FROZEN by owner ruling 2026-09-03. Decisions M1–M5 and M3-amended are
settled. Do NOT reopen any decision below during implementation unless code or
repository evidence reveals a genuine contradiction that makes the approved
methodology technically unsafe or impossible — in which case STOP and report
rather than adapt.

Baseline: `develop` `d75b8dc8`. Production `main` `2340bad4`.

---

## 1. Why this exists

Criticality, inherent risk and residual risk were being conflated. Onboarding
asked the customer to choose a classification (`vendors.criticality` was a
dropdown) that the platform can derive from factual intake, while
`business_criticality` was simultaneously one of nine weighted dimensions inside
the inherent-risk model. The same word named a business-importance judgement and
a scoring input.

v1 separates them into **peers**:

- **Criticality** — business importance: how much it matters if this service is
  unavailable or materially degraded.
- **Inherent Risk** — relationship exposure before controls or evidence.
- **Assessment Tier** — assurance depth, a joint function of both plus policy.
- **Residual Risk** — unchanged; risk after controls, evidence and findings.

---

## 2. Canonical hierarchy (M-ruling 4)

```
Organization -> Vendor -> Vendor Relationship / Service -> Engagement / Assessment
```

A vendor may hold multiple relationships with different criticality, inherent
risk, applicable domains and assessment tiers. UX may optimise the common
one-vendor/one-service case; the data architecture must support many.

---

## 3. Criticality v1 (`vendor_criticality_v1`)

Answers: "How important is this vendor/service to the organization if it becomes
unavailable or materially degraded?"

**Excluded by ruling** — control effectiveness, SOC reports, evidence quality,
data sensitivity, privileged access, AI usage, regulatory exposure. None of these
may ever influence Criticality.

### Dimensions, levels and weights

| Dim | Question | Levels (score 10 / 40 / 70 / 100) | Weight |
|---|---|---|---|
| C2 `max_tolerable_disruption` | How long could the business operate acceptably without it? | `>1_month` / `1_week_to_1_month` / `1_to_7_days` / `<24_hours` | **0.26** |
| C1 `operational_dependency` | How much of day-to-day operation depends on it? | `incidental` / `supporting` / `significant` / `essential` | **0.22** |
| C3 `business_reach` | How much of the organization is affected if it degrades? | `single_team` / `single_function` / `multi_function` / `enterprise_wide` | **0.18** |
| C5 `substitutability` | How replaceable is it, and how quickly? | `interchangeable` / `replaceable_weeks` / `replaceable_months` / `no_viable_alternative` | **0.15** |
| C4 `process_coupling` | How is it positioned in business processes? | `peripheral` / `supports_critical_path` / `in_critical_path` / `embedded_no_manual_fallback` | **0.11** |
| C6 `concentration` | How concentrated is our dependence on this one supplier? | `none` / `low` / `moderate` / `single_point_of_failure` | **0.08** |

Weights sum to exactly 1.00 — assert with a unit test, mirroring the existing
`DIMENSION_WEIGHTS` invariant.

**Concentration stays a low-weight PEER (owner ruling).** It is deliberately NOT
a substitutability multiplier at this stage: concentration and substitutability
must remain separately explainable, and nonlinear scoring would obscure which
fact drove the rating. Multiplier treatment is recorded as a possible FUTURE
methodology refinement, to be revisited only on portfolio evidence.

### Bands

Reuse the shipped `BAND_MIN_SCORE` unchanged: Low 0 / Moderate 25 / High 50 /
Critical 75. Criticality and Inherent Risk therefore read on one scale.

### Escalation floors (named, rare by design)

| Rule | Floor | Condition |
|---|---|---|
| **CR1** | Critical | `mtd = <24_hours` AND `substitutability = no_viable_alternative` |
| **CR2** | High | `business_reach = enterprise_wide` AND `mtd` in (`<24_hours`, `1_to_7_days`) |
| **CR3** | High | `process_coupling = embedded_no_manual_fallback` AND `substitutability = no_viable_alternative` |

Output: `{score, band, arithmetic_band, basis}`. No `tier` — tier is a joint
function and does not belong to either engine.

---

## 4. Inherent Risk v2 (`vendor_inherent_v2`)

Exposure only. `business_criticality`, `operational_dependency` (and its
`recoverability` sub-factor) and `concentration` are REMOVED — they are
Criticality's, and duplicating them would double-count.

Weights are the exact rationals `v1_weight / 0.70`, so they sum to exactly 1 by
construction rather than by rounding. Relative proportions of the surviving
dimensions are preserved — minimum honest drift.

| Dimension | v1 | **v2** | Exact |
|---|---|---|---|
| `data_exposure` | 0.20 | **0.2857** | 2/7 |
| `access_exposure` | 0.18 | **0.2571** | 9/35 |
| `regulatory_exposure` (declared — see note) | 0.12 | **0.1714** | 6/35 |
| `ai_exposure` | 0.09 | **0.1286** | 9/70 |
| `hosting_model` | 0.06 | **0.0857** | 3/35 |
| `fourth_party_exposure` | 0.05 | **0.0714** | 1/14 |

Sub-factors unchanged: `data_volume` amplifies `data_exposure`; `ai_autonomy`
multiplies `ai_involvement`.

**Regulatory exposure is DECLARED intake, not derived** (correction recorded
during VO-6, 2026-09-03). The v1 engine carries a comment claiming derivation
from active obligations via `resolveRegulatoryExposure()`; that function was
never built, and `obligations` has no breach-notification attribute. Deriving a
level would require inventing a count→level mapping — a methodology constant.
The dimension, weight and levels are unchanged; only the SOURCE is declared, as
the shipped v1 engagement intake already does. Derivation is a follow-on that
needs an owner-ruled mapping.

**No double-count.** No business-dependency concept remains in v2. The one pair
that sounds similar measures opposite directions: `fourth_party_exposure` is
THEIR supply chain as exposure to us; `concentration` is OUR dependence on them,
and now lives only in Criticality.

**Floors retained in IR:** E1, E2, E3 unchanged.
**Floors relocated to Tier (ruling M2):** E1b and E4 — see §5.

### Measured effect of the v1 -> v2 change (same facts)

| Scenario | IR v1 | IR v2 | Delta |
|---|---|---|---|
| Cloud infrastructure | 78 Critical | 68 High | -10 |
| Clinical AI transcription | 70 High | 84 Critical | **+14** |
| Niche logistics (sole source) | 48 Moderate | 30 Moderate | -18 |
| Office catering | 8 Low | 5 Low | -3 |

Dependency-heavy vendors fall in IR because that weight moved to Criticality;
exposure-heavy vendors rise. Nothing is lost — it moves to the correct axis.

---

## 5. Assessment Tier

Tier derives from **Criticality + Inherent Risk + Customer Policy**. Criticality
must NOT influence tier solely through inherent risk. This supersedes
`tierForBand(inherent-only)`, which is retained for reproducing v1 engagements.

### Matrix (M3, as amended)

Rows = Criticality, columns = Inherent Risk.

| | IR Low | IR Moderate | IR High | IR Critical |
|---|---|---|---|---|
| **Crit Critical** | tier_2 | tier_2 | **tier_1** | **tier_1** |
| **Crit High** | tier_3 | tier_3 | tier_2 | **tier_1** |
| **Crit Moderate** | tier_4 | tier_3 | **tier_2** | tier_2 |
| **Crit Low** | tier_4 | tier_4 | tier_3 | tier_2 |

The `(Moderate, High)` cell is **tier_2** by owner amendment: high inherent
exposure requires deeper assurance even where business dependency is only
moderate; moderate criticality must not suppress assurance warranted by high
inherent risk.

**Monotonicity — verified, and to be asserted by test.** Increasing Criticality
never lowers assurance; increasing Inherent Risk never lowers assurance. Both
axes checked across all 16 cells.

### Relocated escalation floors

| Rule | Floor | Condition |
|---|---|---|
| **E1b** | tier_1 | `data_sensitivity = restricted` AND `access_level` in (`admin`, `network_access`) AND `operational_dependency = essential` |
| **E4** | tier_2 | `concentration = single_point_of_failure` AND `operational_dependency = essential` |

Both read RAW FACTS, never derived Criticality — the peer relationship holds and
nothing is double-counted.

### Customer policy (ruling M4)

Policy may **RAISE** the deterministic tier. Policy may **NEVER LOWER**
SecureLogic's calculated minimum tier. Implemented as a floor, not a suggestion.

---

## 6. Representative scenarios (computed, not estimated)

| Vendor | Crit | Band | Crit floors | IR | Band | **Tier** | Tier floor |
|---|---|---|---|---|---|---|---|
| Cloud infrastructure (IaaS) | 100 | Critical | CR1,CR2,CR3 | 68 | High | **tier_1** | E4 |
| Identity provider (SSO) | 93 | Critical | CR2 | 62 | High | **tier_1** | — |
| Payment processor | 90 | Critical | CR2 | 70 | High | **tier_1** | — |
| Managed DB provider | 84 | Critical | — | 72 | High | **tier_1** | E1b |
| Niche logistics (sole source) | 84 | Critical | — | 30 | Moderate | **tier_2** | E4 |
| Payroll processor | 73 | High | CR2 | 57 | High | **tier_2** | — |
| CRM SaaS | 68 | High | — | 61 | High | **tier_2** | — |
| Clinical AI transcription | 38 | Moderate | — | 84 | Critical | **tier_2** | — |
| Legal e-discovery | 42 | Moderate | — | 62 | High | **tier_2** | — |
| Marketing analytics | 30 | Moderate | — | 37 | Moderate | **tier_3** | — |
| Office catering | 10 | Low | — | 5 | Low | **tier_4** | — |

The two rows that justify the peer model: **Clinical AI** (low dependency,
Critical exposure -> tier_2) and **Niche logistics** (Critical dependency,
Moderate exposure -> tier_2). Under inherent-only tiering, logistics scored
48/Moderate -> tier_3 and would have been under-assured.

---

## 7. Transition and provenance (ruling M5)

- **No synthetic backfill.** Never manufacture deterministic Criticality or
  relationship facts from absent historical data.
- Transition is **per organization / per relationship**, gated on sufficient
  factual intake existing — NOT a global threshold switch.
- Vendors without sufficient intake are represented as **`intake_required`**.
  Absence renders as ignorance, never as a zero and never as a rating.
- `vendors.criticality` (manual) is PRESERVED with its provenance, displayed as
  manually classified, and never overwritten by a derived value.
- A derived classification is produced ONLY after sufficient factual intake.
- Existing engagements keep their stamped `methodology_version` and are NEVER
  rescored. `inherent_basis` is self-describing, so a v1 rating stays fully
  explainable after v2 ships. Surfaces must render the version so a v1 and a v2
  rating are never silently compared.

---

## 8. Preserved invariants — do not weaken

Tenant isolation; provenance; human authority; evidence governance and the S4
guarantees; the attributed-approval trigger; `engagementStateMachine` as the
single lifecycle authority; the fact store's origin precedence, widen-only rule
and accepted-only reads; the engagement-level grain of assessed values; the
separation of measurement from treatment (risk acceptance never reduces residual
score).

No second IRA, criticality, domain-activation or questionnaire engine.
