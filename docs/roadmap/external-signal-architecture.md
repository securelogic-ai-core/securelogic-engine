# External Signal Architecture — Design Document

> **Status:** **Architecture Ratified – Implementation Pending** (operator-ratified 2026-06-25). This is the
> approved architectural baseline for SecureLogic AI external-signal work. It ratifies architecture and
> design decisions **only** — it is **NOT** authorization to implement. Priority 4 (Signal Ingestion
> Hardening) remains **BLOCKED** until the §12 prerequisites are satisfied (#5/#6/#7 still OPEN).
> **Scope:** documentation only. No application code is changed by this package's design phase.
> **Date started:** 2026-06-25. **Ratified:** 2026-06-25.
> **Authoring skill:** `securelogic-intelligence-pipeline-engineer` (+ `securelogic-enterprise-architect` for layering, `securelogic-program-manager` for sequencing).
> **Governing docs:** `PRODUCT_VISION.md`, `CURRENT_STATE_ARCHITECTURE.md`, `TENANT_ISOLATION_STANDARD.md` §6, `BUILD_SEQUENCE.md` (Priority 3), `CANONICAL_DOMAIN_MODEL.md`.

## Evidence labels (used throughout)

- **VERIFIED** — read directly in the repository; the cited file/line is the source of truth.
- **INFERRED** — deduced from verified facts; not directly confirmed.
- **RECOMMENDED** — proposed target design; **not built**.
- **FUTURE STATE** — belongs to a later package (Priority 4/5); named here only to set direction.

The intent of this document is to **preserve the current implementation as the baseline** and
to design forward from it. Working components are not redesigned unless a **documented
limitation** (§6) justifies it.

## File index (where each section's evidence lives)

| Area | Files |
|---|---|
| Source registry / RSS adapters | `src/api/lib/feedAdapter/registry.ts`, `index.ts`, `threatIntelHelpers.ts`, `regulatoryHelpers.ts` |
| Direct-source adapters | `src/api/lib/cisaKevAdapter.ts`, `nvdAdapter.ts`, `secEdgarAdapter.ts`, `federalRegisterAdapter.ts`, `cisaAlertsAdapter.ts`, `mitreAttackAdapter.ts`, `mitreAtlasAdapter.ts` |
| Normalization / dedup | `src/api/lib/cyberSignalNormalizer.ts`, `cyberSignalValidation.ts` |
| Signal schema | `db/migrations/20260430_cyber_signals_ingestion.sql`, `20260420_cyber_signals_allow_null_org.sql`, `20260510_cyber_signals_signal_type_extended.sql`, `20260624_cyber_signals_external_id.sql` |
| Matcher | `src/api/lib/cyberSignalProcessingService.ts`, `llmControlMatcher.*`, `computeRiskScore` (risk scoring weights) |
| Match suggestions schema | `db/migrations/20260505_signal_match_suggestions.sql` (+ `…_score_type_fix.sql`) |
| Fan-out / schedulers | `services/intelligence-worker/src/pipeline/runPipeline.ts`, `kevPoller.ts`, `src/api/lib/briefScheduler.ts` |
| Brief generation | `src/api/lib/intelligenceBriefGenerator.ts`, `briefSynthesizer.ts`, `briefEmailRenderer.ts`, `briefEmailSender.ts` |
| Tenancy rules | `TENANT_ISOLATION_STANDARD.md` §6; `src/api/infra/postgres.ts` |

---

## 1. Current VERIFIED signal lifecycle

The platform runs a **four-stage** lifecycle, public-source in and per-org out.

```
[1] raw source item        →  [2] normalized signal       →  [3] enriched signal           →  [4] brief item
    RSS / KEV / NVD /             cyber_signals row              signal_match_suggestions          intelligence_brief_items
    SEC / FedReg / MITRE          (GLOBAL, org_id NULL)          + findings + risk flags +         (per org)
    feed adapters                 deduped on dedup_hash          posture snapshot (per org)        LLM-enriched
```

**VERIFIED facts:**
- Stage 1→2 happens in the ingestion adapters + `cyberSignalNormalizer.ts`; the row lands in
  `cyber_signals` as a **global** row (`organization_id IS NULL`) deduped by `dedup_hash`
  (`20260430_cyber_signals_ingestion.sql`).
- Stage 2→3 (the **fan-out**) happens at **consumption time**: `runMatcherForSignal(signal, orgId)`
  runs inside `withTenant(orgId)`, producing org-scoped `signal_match_suggestions`, findings,
  risk-exposure flags, and a posture snapshot (`cyberSignalProcessingService.ts`).
- Stage 3→4 is brief assembly + LLM synthesis per org (`intelligenceBriefGenerator.ts` →
  `briefSynthesizer.ts`).
- Three schedulers drive stages 1–3: the hourly worker pipeline (`runPipeline.ts`), the 15-min
  KEV poller (`kevPoller.ts`), and the daily brief scheduler (`briefScheduler.ts`, ~08:00 UTC).

**INFERRED:** the four stages are **implicit** in the code — there is no single typed contract
that names "raw item / normalized / enriched / brief item" as distinct, versioned objects. The
boundaries exist behaviourally, not as a declared model (see §6).

## 2. Current VERIFIED data model

**Primary table: `cyber_signals`** (`20260430_cyber_signals_ingestion.sql`, amended by `20260420`, `20260510`, `20260624`). VERIFIED columns:

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `organization_id` | UUID **NULL** | global rows are NULL (intentional; `TENANT_ISOLATION_STANDARD.md` §1) |
| `source` | TEXT NOT NULL | **no CHECK** — open set (adapters not constrained at the DB) |
| `signal_type` | TEXT NOT NULL | CHECK enum (12 values, below) |
| `severity` | TEXT NOT NULL | CHECK: `Critical`/`High`/`Moderate`/`Low` (canonical PascalCase) |
| `raw_payload` | JSONB | original item preserved |
| `normalized_summary` | TEXT NOT NULL | |
| `affected_vendor` | TEXT NULL | matching + dedup input |
| `affected_cve` | TEXT NULL | uppercase-normalized `CVE-YYYY-NNNNN` |
| `dedup_hash` | TEXT NOT NULL | SHA-256 (see below) |
| `external_id` | TEXT NULL | added `20260624`, additive, no backfill |
| `ingestion_timestamp` | TIMESTAMPTZ | |
| `processed` | BOOLEAN | processing state |
| `linked_finding_id` | UUID NULL | FK → findings, `ON DELETE SET NULL` |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

**Indexes (VERIFIED):** `UNIQUE (organization_id, dedup_hash)` and `UNIQUE (dedup_hash)` (global rows).

**`signal_type` taxonomy (VERIFIED, `20260510`):** `cve`, `threat_actor`, `advisory`, `breach`,
`patch`, `malware`, `geopolitical`, `regulatory_change`, `third_party_breach`, `data_exposure`,
`patch_advisory`, `vulnerability`.

**`dedup_hash` construction (VERIFIED, `cyberSignalNormalizer.ts` `buildDedupHash`):**
`SHA-256( source | signal_type | affected_cve | affected_vendor [ | id:<external_id> ] )`, each
component lowercased + trimmed. The `external_id` discriminator (`20260624`) fixes CVE-less
items that previously collapsed to `source|signal_type||` (one-row-per-source bug). Legacy rows
keep their original hash (no drift).

**`signal_match_suggestions`** (`20260505_signal_match_suggestions.sql` + `…_score_type_fix.sql`). VERIFIED:
- `organization_id` NOT NULL; `signal_id` FK → `cyber_signals`.
- Polymorphic target: `target_type` CHECK ∈ `vendor`/`ai_system`/`control`/`obligation`; `target_id`
  UUID **no FK** (by design, mirrors `findings(source_type, source_id)`).
- `match_score` **INTEGER 0–100** (CHECK; retyped from the original `NUMERIC(4,3)`), NULL when
  unscored. `match_metadata` JSONB.
- Three-state `{pending, accepted, dismissed}` enforced by a DB CHECK; `accepted_link_id` (no FK)
  points into the appropriate `signal_*_links` table on accept.

**Link tables (VERIFIED):** `signal_vendor_links`, `signal_ai_system_links`, `signal_control_links`,
`signal_obligation_links` — org-scoped junctions that permit a global signal id; soft-deleted with
partial-unique indexes. Each now carries an RLS policy (A04-G1, inert pre-flip).

## 3. Current VERIFIED ingestion flow

Two distinct source surfaces feed `cyber_signals`:

**(a) RSS feed registry** (`src/api/lib/feedAdapter/registry.ts`). **VERIFIED: 6 feeds**, each with a
`sourceTier` field:
- **Tier 2 — curated security press (threat-intel RSS):** `bleepingcomputer`, `krebsonsecurity`, `sans_isc`.
- **Tier 1 — US-gov authoritative (regulatory RSS):** `nist_news`, `ftc_news`, `onc_healthit` (healthcare).
- `fetchAllFeeds({ ids? })` (`index.ts`) iterates the registry with **per-feed error isolation** and
  returns `{ signals, results: { [feedId]: { total, mapped, skipped, error? } } }`. Pure mappers:
  `threatIntelHelpers.ts`, `regulatoryHelpers.ts`.

> **Reconcile note — RESOLVED (2026-06-25, prerequisite #7):** the skill suite previously said
> "8 registered feeds"; the VERIFIED count in `registry.ts` is **6 RSS feeds** (3 Tier-2 threat-intel
> + 3 Tier-1 regulatory, each with a `sourceTier` field), plus **7 direct-source adapters** wired in
> `briefScheduler.ts`. The skills have been corrected to **6 RSS feeds + 7 direct-source adapters**
> (see §12 #7). No application code changed.

**(b) Direct-source adapters** invoked by `briefScheduler.ts` (VERIFIED imports): `cisaKevAdapter`
(KEV full catalog), `nvdAdapter` (NVD, 7-day window), `secEdgarAdapter`, `federalRegisterAdapter`,
`cisaAlertsAdapter`, `mitreAttackAdapter`, `mitreAtlasAdapter`. The scheduler tracks per-source
counts in `signals_fetched` and records per-feed health. KEV is **also** polled separately every
15 min (`kevPoller.ts`) with an ETag + Redis 304 short-circuit.

**Ingestion → storage (VERIFIED):** each raw item → mapper → `CyberSignalIngestInput` →
`normalizeSignal` → INSERT into `cyber_signals` as a **global** row with
`ON CONFLICT (… dedup_hash) DO NOTHING`. Public-source signals are **never** written to an
org-scoped table (`TENANT_ISOLATION_STANDARD.md` §6).

**INFERRED:** total source adapters ≈ **13** (6 RSS + 7 direct). The two surfaces don't share a
single source-registry abstraction — RSS feeds are in `registry.ts`; the direct adapters are wired
individually in `briefScheduler.ts` (see §6).

## 4. Current VERIFIED matching flow

**Core: `runMatcherForSignal(signal, orgId)`** (`cyberSignalProcessingService.ts`), run inside
`withTenant(orgId)` during fan-out. VERIFIED behaviour:
- Matches the signal against the org's **vendors / AI systems / controls / obligations**.
- Writes `signal_match_suggestions` (polymorphic; `match_score` 0–100 from `computeRiskScore` over
  the per-org `risk_scoring_weights`; KEV pins severity weight to 1.0).
- Creates **findings** on confident matches and **flags exposed open risks** (phase-5 risk-exposure
  flagging + risk→action was lifted into the matcher in #354 so worker fan-out reaches it — currently
  **develop/staging only**, per the 2026-06-25 doc-sync).
- Triggers a **posture snapshot** (non-fatal if it fails).
- Companion `runLlmControlMatcherForSignal` (`llmControlMatcher`) — LLM **suggest-only**, gated by
  `SECURELOGIC_LLM_CONTROL_MATCHER_ENABLED` (paid; wired into fan-out #345, on main).

**Fan-out (VERIFIED):** `fanOutMatcherToActiveOrgs` (`runPipeline.ts`) enumerates active orgs on
`pgElevated`, then runs the matcher per (global signal, org) inside `withTenant`. The same matcher is
reached from `kevPoller.ts` and `briefScheduler.ts` — **three invocation paths that must stay in sync.**

**Scoring vocabulary (VERIFIED):** `risk_scoring_weights` is per-org and deliberately **two-vocabulary**
(PascalCase severity vs lowercase criticality); `computeRiskScore` does not canonicalize — do not conflate.

**INFERRED:** match confidence rests on case-insensitive name/CVE matching plus the fuzzy-vendor path
(`SECURELOGIC_FUZZY_VENDOR_MATCH_ENABLED`). `match_metadata` records `{ source, matched_branch,
matched_string }` for provenance of the *match*, but there is no end-to-end provenance record from
raw item → finding (see §6).

## 5. Current VERIFIED Intelligence Brief generation

- **Generator (pure, `intelligenceBriefGenerator.ts`):** pulls the org's `cyber_signals` (7-day window,
  including global `organization_id IS NULL` rows), scores by relevance, buckets by `BriefCategory`
  (`vulnerability | threat_actor | vendor_incident | regulatory | general`), and builds `BriefItem`s.
  VERIFIED `BriefItem` fields: `title`, `severity`, `category`, `affected_cve`, `affected_vendor`,
  `analysis`, `why_it_matters`, `recommended_actions`.
- **Synthesis (`briefSynthesizer.ts`):** Anthropic (Claude) enrichment of each item + a brief-level
  thesis / executive summary; **falls back to templated text** when the model fails or returns unusable
  output.
- **Persistence + delivery:** `intelligence_briefs` + `intelligence_brief_items`; rendered by
  `briefEmailRenderer.ts`, sent via Resend (`briefEmailSender.ts`). Single weekly Brief; the Daily
  Digest send is disabled (#347, on main).
- **Premium-brief shape (VERIFIED standard, `FINAL_PRODUCT_STANDARD.md`):** title, severity,
  category/section, audience, whyItMatters, analysis, recommended action, CVE-when-available,
  vendor-when-available, rationale for higher-risk items. Generic AI filler is explicitly banned.

For wording/quality rules see the `securelogic-executive-report-writer` skill.

---

## 6. Current limitations (documented; basis for the target design)

Only limitations grounded in the verified baseline. These justify the target work; nothing else is redesigned.

1. **No declared signal-stage contract.** The four stages (§1) are implicit. There is no versioned,
   typed "external signal object" distinguishing raw → normalized → enriched → brief item. *(INFERRED
   from the absence of such a type across the file index.)*
2. **Two un-unified source surfaces.** RSS feeds live in `registry.ts` (with a `sourceTier`); the 7
   direct adapters are wired individually in `briefScheduler.ts` with no shared registry or uniform
   health/qualification metadata. *(VERIFIED structural split.)*
3. **Source qualification is minimal.** A `sourceTier` (1/2) exists on RSS feeds only; there is **no
   credibility/qualification score**, no per-source reliability tracking beyond `feed_health`
   success/failure, and the direct adapters carry no tier at all. *(VERIFIED partial; the rest RECOMMENDED.)*
4. **Dedup is single-hash.** `dedup_hash` collapses exact `source|signal_type|cve|vendor|external_id`
   matches only. **No cross-source or near-duplicate clustering** — the same CVE from CISA and NVD is
   intentionally two rows. *(VERIFIED by the migration header.)*
5. **Provenance is partial.** `raw_payload` preserves the source item and `match_metadata` records the
   match basis, but there is **no end-to-end lineage** record connecting a brief item / finding back
   through enrichment → normalization → the specific raw item. *(INFERRED.)*
6. **Severity is assigned at map time, not modelled.** Each adapter sets `severity`; there is no shared,
   auditable severity-derivation policy across sources. *(VERIFIED per-adapter mapping.)*
7. **Linkage breadth is partial.** The matcher resolves signals to vendors/AI/controls/obligations and
   flags risks, but signal→**dependency** linkage and signal-driven **reassessment triggers** are not
   first-class. *(INFERRED; `signal_*_links` cover 4 targets, not dependencies.)*
8. **R5 open (tenancy verification).** `TENANT_ISOLATION_STANDARD.md` flags worker→brief per-org
   filtering as "unverified." *(VERIFIED as an open risk in the standard.)*

## 7. RECOMMENDED target architecture

> All of §7 is **RECOMMENDED** (design intent), not built. It preserves every working component in §1–5
> and adds structure around them.

**T1 — A declared four-stage signal contract.** Name and type the stages explicitly:
`RawSourceItem → NormalizedSignal → EnrichedSignal → BriefItem`, each with a stable shape and a
`schema_version`. The existing `cyber_signals` row **is** the NormalizedSignal — formalize it, don't
replace it. EnrichedSignal = the matcher/synthesis output already produced; give it a named contract.

**T2 — A unified source registry.** One registry abstraction covering **both** RSS feeds and the 7
direct adapters, each entry carrying: `id`, `kind` (rss/api), `sourceTier`, a **qualification record**
(see T3), and a health reference. RSS `registry.ts` is the seed; bring the `briefScheduler.ts` direct
adapters under the same shape. *(FUTURE STATE: the actual adapter migration is Priority 4.)*

**T3 — A source qualification model.** Extend the existing `sourceTier` into a structured
`SourceQualification` { authority (gov/vendor/press/community), reliability (rolling success +
correction history from `feed_health`), latency, coverage_domains }. Used to weight relevance and to
explain "why this source" in the Brief. Start from the VERIFIED `sourceTier` field; don't discard it.

**T4 — Multi-signal dedup / clustering.** Keep `dedup_hash` as the exact-match key (don't break it);
add a **clustering layer** that groups near-duplicate signals (same CVE across CISA+NVD, same incident
across press sources) into a single brief-facing event with multiple corroborating sources — improving
both quality and source-credibility signals.

**T5 — End-to-end provenance.** A lineage reference threaded from BriefItem → EnrichedSignal →
NormalizedSignal(`cyber_signals.id`) → RawSourceItem(`raw_payload` + source + fetch time), so any
output is explainable to a customer/auditor ("we acted because …"). Builds on the already-preserved
`raw_payload` and `match_metadata`.

**T6 — Broadened, first-class linkage.** Add signal→**dependency** linkage and signal-driven
**reassessment triggers** (a high-severity signal matching a vendor/AI system can flag its assessments
stale). Extends the existing `signal_*_links` pattern; no new tenancy model.

**Invariants the target MUST preserve (VERIFIED constraints):** global-in/per-org-out; public signals
only in shared tables; LLM single-org scope (no cross-org batching, R6); the three matcher paths in
sync; canonical severity (PascalCase) vs criticality (lowercase) separation; `withTenant`/`pgElevated`
tenancy runtime.

## 8. Migration path (current → target)

Design-level only; each step is a **FUTURE STATE** package, scoped later.

1. **Doc + contract (this package, Priority 3):** ratify the four-stage contract (T1) and the source
   qualification model (T3) on paper; no code.
2. **Source registry unification (Priority 4, signal-ingestion-hardening):** bring direct adapters under
   the unified registry (T2), additively — RSS path unchanged. Backwards-compatible.
3. **Qualification + health (Priority 4):** populate `SourceQualification` from existing `feed_health` +
   `sourceTier`; additive columns, no rewrite of mappers.
4. **Clustering (Priority 4):** add the clustering layer **beside** `dedup_hash` (never replacing the
   unique index); brief generator consumes clusters where present, falls back to single signals.
5. **Provenance (Priority 4/5):** add lineage references; additive, nullable, no backfill (mirror the
   `external_id` migration pattern — `20260624`).
6. **Linkage breadth + reassessment (Priority 5, signal-to-platform-linkage):** add dependency links +
   reassessment triggers on the existing `signal_*_links` pattern.

**Migration principles (VERIFIED house style):** additive nullable columns, no backfill, idempotent
auto-apply-safe migrations, RLS policy on any new customer-data table, feature-flag any behaviour change,
stage before prod. (See `securelogic-release-pr-reviewer` + `database-guidelines.md`.)

## 9. Risks

- **R-1 Breaking dedup.** Any change to `buildDedupHash` re-ingests the world. *Mitigation:* never alter
  the legacy hash; clustering sits beside it. *(VERIFIED hazard — migration header warns of it.)*
- **R-2 Matcher-path drift.** Behaviour added to one of the three invocation paths but not the others.
  *Mitigation:* a single matcher contract; the pipeline-engineer checklist enforces all-three-paths.
- **R-3 Cross-org leakage in enrichment (R6).** Clustering/qualification that batches multiple orgs'
  private inputs into one LLM call. *Mitigation:* qualification/clustering operate on **global**
  public signals only; per-org enrichment stays single-org. *(VERIFIED rule, `TENANT_ISOLATION_STANDARD.md` §6.)*
- **R-4 Presentation ahead of signal depth.** Shipping brief/UI polish before qualification/clustering
  land. *Mitigation:* `FINAL_PRODUCT_STANDARD.md` "signal quality before presentation polish."
- **R-5 Worker→brief filtering unverified (standard R5).** Resolve during Priority-4 work with a
  cross-org isolation test.
- **R-6 Scope creep into ingestion code now.** This package is design-only. *Mitigation:* no code until review.

## 10. Architectural decisions

> **Decision status (operator review 2026-06-25):** D1–D4 **RATIFIED**; D5 **RATIFIED (principle only)**;
> D6–D7 **DEFERRED to the Priority 5 conversation.** Every decision preserves the verified baseline and is
> additive. These are design decisions — no code is authorized by this document.

**D1 (stage boundary) — RATIFIED.** `EnrichedSignal` is a **typed computed projection**, not a new
persisted table — assembled from `cyber_signals` + `signal_match_suggestions` + `match_metadata` + linked
findings. Rationale: the constituents are already persisted; a new table would be a competing source of
truth (`CANONICAL_DOMAIN_MODEL.md` — "outputs consume, not define"). Revisit persistence only if D5
provenance later requires a snapshot. *Confidence: High (no table now) / Medium (final field set).*

**D2 (clustering identity) — RATIFIED.** Cross-source clustering uses a **separate, nullable `cluster_key`
computed beside `dedup_hash` — never modifying the hash.** Primary axis = normalized `affected_cve`;
CVE-less fallback = an entity+type+day-bucket fingerprint (`affected_vendor` + `signal_type` + date window).
Clustering is a soft grouping, not a unique constraint. Rationale: `dedup_hash` is intentionally per-source
and any hash change re-ingests everything (`20260624_…` header); `affected_cve` is already uppercase-normalized.
*Confidence: Med-High (CVE-primary) / Medium (CVE-less fingerprint — validate against real data in P4).*

**D3 (qualification) — RATIFIED.** `SourceQualification` is **hybrid**: a **static** authority/tier in the
unified registry (seeded from the existing `sourceTier`) **× a rolling reliability** component derived from
`feed_health` (success rate + correction history). Storage location (extend `feed_health` vs a new `sources`
table) is an implementation detail settled at P4 build time. *Confidence: High (hybrid) / Medium (location).*

**D4 (registry unification) — RATIFIED.** A **single source registry with a `kind` discriminator
(`rss` | `api`)** carrying uniform metadata (`id`, `kind`, `tier`, qualification, health) for all ~13
sources, while keeping **kind-specific fetch adapters** — KEV ETag/Redis short-circuit and NVD windowing are
preserved, not flattened. Rationale: brings the 7 `briefScheduler.ts` direct adapters under the same
qualification/health surface as the 6 RSS feeds without fighting their real fetch differences. *Confidence: High.*

**D5 (provenance) — RATIFIED (principle only).** Persist **lightweight lineage references (edges +
timestamps)** — brief_item → `cyber_signals.id`(s), finding → `cyber_signals.id` — and **reconstruct detail
from `raw_payload`**; no full per-stage snapshots. Additive, nullable, no backfill (mirror the `external_id`
pattern, `20260624_…`). Implementation timing (P4 vs P5) remains open. *Confidence: High.*

**D6 (dependency linkage) — DEFERRED (Priority 5).** Direction of travel (not ratified): a new
`signal_dependency_links` table mirroring the four existing link tables + adding `dependency` to the
suggestion `target_type` enum. Decided in the signal-to-platform-linkage (Priority 5) conversation; out of
scope for Priority 4.

**D7 (reassessment triggers) — DEFERRED (Priority 5).** Direction of travel (not ratified): event-driven
from the matcher with a periodic sweep backstop. Decided in the Priority 5 conversation; out of scope for
Priority 4.

## 11. Acceptance criteria for this package (`external-signal-architecture`, Priority 3)

This is a **docs/design** package. Done when (per `BUILD_SEQUENCE.md` Active-package "done when"):

- [x] The **four signal stages** (§1) are documented and distinguished, grounded in the verified baseline.
- [x] The **VERIFIED current state** of data model, ingestion, matching, and brief generation is recorded
      with file references (§2–5).
- [x] **Source qualification, deduplication, and linkage** target models are defined clearly enough to
      guide Priority 4/5 (§7), each labelled RECOMMENDED/FUTURE STATE.
- [x] The **migration path** (§8) is additive and preserves working components.
- [x] Risks (§9) and decisions (§10) are captured — D1–D5 ratified, D6–D7 deferred (2026-06-25).
- [x] No application-code change; no premature ingestion edits.
- [x] Reviewed and ratified by the operator (2026-06-25).

### Ratification (operator, 2026-06-25)

This document is the **approved architectural baseline** for SecureLogic AI external-signal work, under
these explicit conditions:

1. This ratifies the **architecture and design decisions only** (§1–§10).
2. This is **NOT** authorization to begin implementation.
3. **Priority 4 (Signal Ingestion Hardening) implementation remains BLOCKED** until the documented
   prerequisites in §12 are satisfied.
4. Prerequisites **#5, #6, and #7 remain OPEN** (see §12).
5. Document status: **Architecture Ratified – Implementation Pending.**

No code, migration, or config change is authorized by this ratification. The
`external-signal-architecture` **design deliverable now meets its acceptance criteria above**; recording the
package's completion in `BUILD_SEQUENCE.md` and naming any successor are a **separate program-manager
doc-sync, pending operator approval** (not done here). Priority 4 is a separate, not-yet-authorized package
gated on §12 #5–#7.

## 12. Prerequisites for the next package (Priority 4 — Signal Ingestion Hardening)

Status after the **2026-06-25 decision review** (§10):

**RESOLVED (design-level) — remaining work is P4 build detail:**
1. **Four-stage contract (T1 / D1) — RESOLVED:** EnrichedSignal is a typed projection. Remaining: finalize
   the contract field set at P4 design time.
2. **Unified source-registry (T2 / D4) — RESOLVED:** one registry, `kind` discriminator. Remaining: the
   mechanical adapter migration is P4 build work.
3. **Qualification model (T3 / D3) — RESOLVED (hybrid):** static tier × rolling reliability. Remaining:
   storage location (extend `feed_health` vs new `sources` table) decided at P4 build time.
4. **Clustering identity key (T4 / D2) — RESOLVED:** CVE-primary `cluster_key` beside `dedup_hash`.
   Remaining: validate the CVE-less fingerprint against real data in P4.

**Gating prerequisites — status:** #5 **OPEN**; #6 and #7 **✅ SATISFIED (2026-06-25)** (kept in sync with `BUILD_SEQUENCE.md`).
5. **A real-Postgres integration lane** for ingestion + a **cross-org isolation test** closing R5
   (worker→brief per-org filtering) — Priority-4 changes per-org fan-out, so this is a gating prerequisite. **OPEN.**
6. **`main→develop` reconciliation — ✅ SATISFIED (2026-06-25).** `main` was back-merged into `develop`
   via a **true merge commit `56992b3b`** (`--no-ff`, not squashed; parents `[7e7eaebc doc commit,
   cbd3504b origin/main]`). **Evidence (VERIFIED — matches `BUILD_SEQUENCE.md`):** `origin/develop..origin/main`
   count = **0** (main fully contained in develop); **#354–#360 remain develop/staging-only** (present in
   `origin/main..origin/develop`, absent from `main`); **`origin/main` unchanged at `cbd3504b`**;
   **pushed only to `origin/develop`** (`5ea12f70..56992b3b`, fast-forward). The merge commit changed
   **zero files** (tree-identical) — no application code changed; `app/src/app/page.tsx` untouched.
7. **Skill correction — ✅ SATISFIED (2026-06-25).** The stale "8 feeds" count was corrected to
   **6 RSS-registry feeds + 7 direct-source adapters** across the skill suite (6 occurrences in 5
   files: `securelogic-intelligence-pipeline-engineer` SKILL.md/reference.md/examples + the
   `securelogic-enterprise-architect` ingestion/architecture/example mirrors). **Evidence (VERIFIED,
   matches `BUILD_SEQUENCE.md`):** `registry.ts` has 6 feed ids; `briefScheduler.ts` imports 7
   direct-source adapters (CISA KEV, NVD, SEC EDGAR, Federal Register, CISA alerts, MITRE ATT&CK,
   MITRE ATLAS). Skill/docs only — no application code changed.

---

> **Next step:** review this draft. Per the package rules, **no code will be proposed until this design is
> ratified.** Open questions in §10 and prerequisites in §12 are the decisions needed before Priority 4.
