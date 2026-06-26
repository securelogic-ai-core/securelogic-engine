# Priority 4 — Signal Ingestion Hardening: Implementation Plan

> **Status: Planning complete; implementation not authorized.**
>
> This is a **planning deliverable only** — no production code, migrations, or configuration
> are produced or authorized by this document. It is the reviewable implementation package for
> Priority 4, grounded in the ratified D1–D5 design (`docs/roadmap/external-signal-architecture.md`,
> status *Architecture Ratified – Implementation Pending*) and verified repository facts.
> Implementation begins only after the operator explicitly authorizes the Priority-4 build scope
> (exit criterion #4 in `BUILD_SEQUENCE.md`) and approves the first PR. *Active ≠ Implementation Authorized.*
>
> **Authored:** 2026-06-26. **Baseline:** `develop` (contains the matcher-R5 + #356–#360 releases).
> **Authoring skills:** `securelogic-intelligence-pipeline-engineer` (lead) + `securelogic-enterprise-architect` (layering) + `securelogic-security-reviewer` + `securelogic-program-manager`.

---

## 1. Executive Summary

**One-page overview.** Priority 4 hardens the *quality and reliability* of the external cyber-intelligence
the platform ingests, **before** building more output surfaces on top of it. Today signals flow
`raw → cyber_signals (global) → matcher fan-out (per org) → brief`, fed by **6 RSS-registry feeds**
(`src/api/lib/feedAdapter/registry.ts`) plus **7 directly-wired adapters** (`briefScheduler.ts`: CISA KEV,
NVD, SEC EDGAR, Federal Register, CISA alerts, MITRE ATT&CK/ATLAS). The work is **purely additive** and
preserves every working component, delivering four capabilities: a **unified source registry** (D4), a
**source-qualification model** (D3), **near-duplicate clustering** (D2), and **end-to-end provenance** (D5) —
all under a declared **four-stage signal contract** (D1).

**Goals.**
- Unify the two source surfaces under one registry with a `kind` (`rss`|`api`) discriminator, preserving
  each adapter's real fetch behavior (KEV ETag/Redis, NVD windowing).
- Add a structured source-credibility/qualification model (static authority × rolling reliability from `feed_health`).
- Group near-duplicate signals (same CVE across CISA+NVD, same incident across press) into corroborated
  events, **beside** `dedup_hash` (never modifying it).
- Persist lightweight provenance lineage so any brief item/finding is traceable to its source.

**Non-goals (out of scope — per design §10 scope guard).**
- D6 (signal→dependency linkage) and D7 (reassessment triggers) → **Priority 5**.
- A04-G1 RLS `app_request` flip (in-flight infra), Pillar-1 Part-2, price-label work.
- Brief/UI presentation polish ("signal quality before presentation polish").
- Any change to `buildDedupHash`/`dedup_hash`.

**Success criteria (package "done when," `BUILD_SEQUENCE.md`):** inputs to the intelligence pipeline are
materially richer and more reliable — concretely: all ~13 sources carry uniform qualification + health
metadata; near-duplicates are clustered with corroboration counts; every brief item is traceable to its
source signals; and **no regression** (the `cross-org-isolation` lane stays green; the brief still
generates with deterministic fallback when LLM/clustering are absent).

## 2. Architecture Validation (D1–D5 vs current codebase)

| Decision | Ratified intent | Codebase check | Verdict | Ambiguity / debt to resolve first |
|---|---|---|---|---|
| **D1** EnrichedSignal = typed *projection* | No new table; assemble from existing rows | `cyber_signals`, `signal_match_suggestions`, `match_metadata`, `findings` all persisted (VERIFIED) | sound | The **field set** of the four stage types is undefined; agree at 4A design. |
| **D2** `cluster_key` beside `dedup_hash`, CVE-primary | Soft grouping, never touch the hash | `dedup_hash` = `source\|signal_type\|cve\|vendor\|external_id`; `affected_cve` uppercase-normalized; two UNIQUE indexes (`20260430`, `20260624`) | sound | **CVE-less fingerprint** (entity+type+day) unvalidated against real data; clustering query cost unknown. |
| **D3** Hybrid qualification (static tier × rolling reliability) | Seed from `sourceTier`, derive reliability from `feed_health` | `sourceTier` (1/2) on RSS entries only; `feed_health` records per-feed success/failure (VERIFIED) | sound | **Storage location** (extend `feed_health` vs new `sources` table) **unresolved**; 7 direct adapters carry **no tier**. |
| **D4** Unified registry, `kind` discriminator | One registry, kind-specific fetch | `registry.ts` = `{id,url,sourceTier,map}`; 7 direct adapters wired individually in `briefScheduler.ts` (KEV ETag/Redis, NVD 7-day window) | sound | Must **preserve** per-adapter fetch nuance; `briefScheduler.ts` ingestion is tangled. |
| **D5** Provenance *references*, not snapshots | Lineage edges; reconstruct from `raw_payload` | `raw_payload` (JSONB) preserves source item; `match_metadata` records match basis (VERIFIED) | sound (principle) | **P4 vs P5 timing open**; exact edge columns/tables undefined. |

**Pre-implementation technical debt to resolve (blocking clean work):**
1. **Three matcher fan-out paths** (`runPipeline.ts`, `kevPoller.ts`, `briefScheduler.ts`) duplicate
   enumerate-and-dispatch — high drift risk (design R-2). Consider a shared fan-out helper in 4A.
2. **`actions` and `insights_trends` have no RLS policy** (surfaced during R5 work) — defense-in-depth gap
   on the `pgElevated` write path; relevant because 4C/4D add writes. Track on A04-G1; note for security review.
3. **Doc drift:** `external-signal-architecture.md` §12/header still say **#5 OPEN** while
   `BUILD_SEQUENCE.md`/`TENANT_ISOLATION_STANDARD.md` show **#5 SATISFIED (R5 RESOLVED)**. A one-line
   docs-sync should precede 4A so the baseline is internally consistent.

## 3. Phase Breakdown

### Phase 4A — Four-stage contract + Unified source registry (T1/D1 + T2/D4)
- **Objective:** introduce the typed `RawSourceItem → NormalizedSignal → EnrichedSignal → BriefItem`
  contract and a single `kind`-discriminated registry covering all ~13 sources, additively.
- **Deliverables:** `SourceDescriptor`/`SourceKind` type; 6 RSS entries annotated `kind:'rss'`; 7 direct
  adapters registered as `kind:'api'` (keeping bespoke fetch funcs); typed `EnrichedSignal` *projection*
  helper (pure, no table).
- **Files expected to change:** `src/api/lib/feedAdapter/registry.ts`, `index.ts`; new
  `src/api/lib/signals/contracts.ts` + `enrichedSignalProjection.ts`; `briefScheduler.ts` (read direct
  adapters from the registry — behavior-preserving). **No engine, no DB.**
- **New components:** typed signal-stage contracts; unified registry descriptor; projection helper.
- **DB changes:** none. **APIs affected:** none (internal lib). **Services affected:** `intelligence-worker`
  (reads registry) — behavior unchanged.
- **Risks:** R-2 (fan-out drift); mitigated by keeping fetch funcs identical.
- **Rollback:** pure additive types + behavior-preserving wiring; `git revert`. No flag (no behavior change).
- **DoD:** all 13 sources resolve through one registry; `npm test` + `cross-org-isolation` green; brief
  output byte-identical to pre-change for a fixture run.

### Phase 4B — Source qualification model (T3/D3)
- **Objective:** attach a `SourceQualification` (static authority/tier × rolling reliability) to every
  source; expose it for relevance weighting and "why this source" explainability.
- **Deliverables:** `SourceQualification` type; a reliability computation from `feed_health` (rolling
  success + correction history); registry entries carry static `authority`/`tier`.
- **Files:** new `src/api/lib/signals/sourceQualification.ts`; `feedAdapter/registry.ts` (authority fields);
  `feedHealth.ts` (rolling reads); **one additive migration** (extend `feed_health` *or* a new `sources`
  table — **decision required, §10**).
- **New components:** qualification scorer; (possibly) a `sources` table.
- **DB changes:** additive, nullable columns / new table; idempotent; RLS policy if any new customer-data
  table (this is global/platform data → likely not org-scoped, but verify).
- **APIs affected:** optionally a read endpoint (out of scope unless needed). **Services:** brief generation
  (consumes qualification for ranking) — behind a flag.
- **Risks:** cold-start mis-ranking new authoritative sources; mitigated by static-authority base.
- **Rollback:** flag `SECURELOGIC_SOURCE_QUALIFICATION_ENABLED` off → prior ranking; additive columns harmless.
- **DoD:** every source has a qualification record; ranking with qualification is flag-gated and staged;
  reliability updates from `feed_health` proven by integration test.

### Phase 4C — Multi-signal clustering (T4/D2)
- **Objective:** group near-duplicate signals into corroborated events beside `dedup_hash`.
- **Deliverables:** `cluster_key` computation (CVE-primary; entity+type+day fingerprint fallback); a
  clustering read layer; brief generator consumes clusters with single-signal fallback.
- **Files:** new `src/api/lib/signals/clustering.ts`; **one additive migration** adding nullable
  `cluster_key` to `cyber_signals` (+ non-unique index); `intelligenceBriefGenerator.ts` (cluster-aware
  bucketing, fallback).
- **New components:** cluster-key function; cluster projection.
- **DB changes:** additive nullable `cluster_key` + supporting index (mirror `external_id` pattern,
  `20260624`); **never touch `dedup_hash`/its unique indexes**.
- **APIs/Services:** brief generation (cluster-aware) behind a flag.
- **Risks:** R-1 (mustn't touch dedup), over-merging distinct events; CVE-less fingerprint accuracy; query cost.
- **Rollback:** flag `SECURELOGIC_SIGNAL_CLUSTERING_ENABLED` off → brief uses single signals; `cluster_key` inert.
- **DoD:** CISA+NVD same-CVE signals cluster; distinct events don't; brief shows corroboration without
  regression; flag-off path identical to today.

### Phase 4D — Provenance references (T5/D5)
- **Objective:** persist lightweight lineage so brief items/findings trace to source signals.
- **Deliverables:** lineage reference columns/edges (brief_item → `cyber_signals.id`, finding →
  `cyber_signals.id`); reconstruct detail from `raw_payload`.
- **Files:** **additive migration(s)** for nullable reference columns or a small `signal_provenance` edge
  table; `intelligenceBriefGenerator.ts`/matcher write the references.
- **DB changes:** additive nullable, no backfill; RLS on any new customer-data (org-scoped) table.
- **APIs/Services:** none new required; references populated during fan-out/brief.
- **Risks:** storage growth; cross-org leakage if references mix orgs (must be org-scoped where customer-facing).
- **Rollback:** additive nullable; revert; no behavior dependency.
- **DoD:** a brief item resolves to its source signal(s) and raw payload; provenance is org-scoped;
  cross-org isolation test extended and green.

## 4. Dependency Graph

```
4A (contract + unified registry)  →  4B (qualification)  →  4C (clustering)  →  4D (provenance)
        |  (foundation: types + registry)        |                     |
        |                                         +-- 4B reliability uses feed_health (existing) — parallelizable internals
        +-- enables all downstream

Critical path:  4A → 4B → 4C   (4C corroboration leans on 4B qualification)
4D may run after 4A in parallel with 4B/4C (provenance references don't depend on qualification/clustering),
   but is sequenced last to minimize concurrent migrations.
```
- **Build order:** 4A → 4B → 4C → 4D.
- **Blocking dependencies:** 4B/4C/4D all depend on 4A's unified registry + contract. 4C's corroboration is
  stronger with 4B (soft dependency).
- **Parallelizable:** within 4B, the `feed_health` rolling reader and static-authority annotations are
  independent. 4D's migration can be authored in parallel with 4B once 4A lands.
- **Critical path:** 4A → 4B → 4C.

## 5. Testing Strategy (per phase)

| Phase | Unit | Integration (real PG) | Isolation (cross-org) | Performance | Failure scenarios | Rollback validation |
|---|---|---|---|---|---|---|
| **4A** | contract type guards; registry conformance; projection helper | registry resolves all 13 sources; brief fixture unchanged | extend `r5PipelineIsolation` — refactor doesn't change fan-out scoping | registry fetch latency unchanged | a source missing `kind`; malformed descriptor | revert → byte-identical brief |
| **4B** | qualification scorer; reliability math; cold-start | reliability derives from seeded `feed_health` history | qualification on **global** signals only — no per-org data in scoring | qualification compute per cycle | flapping source; zero-history source | flag-off → prior ranking |
| **4C** | `cluster_key` (CVE + fingerprint) cases; over-merge guards | CISA+NVD same-CVE cluster; distinct events don't | clustering on **global** signals; per-org brief still org-scoped (extend R5 test) | clustering query cost at N signals | malformed CVE; clock-skew day-bucket | flag-off → single-signal brief identical |
| **4D** | provenance edge construction | brief_item → signal → raw_payload reconstructs | provenance refs **org-scoped**; no cross-org lineage | lineage write overhead | missing source row; orphan ref | additive nullable inert on revert |

**Cross-cutting:** every phase keeps the existing `cross-org-isolation` lane green (37 files / 315 tests),
uses deterministic stubs (LLM/Resend keys unset), and adds **negative-path** tests where customer data is written.

## 6. Security Review

- **Multi-tenant risks:** qualification (4B) and clustering (4C) must run on **global** public signals
  (`organization_id IS NULL`) only; per-org enrichment stays single-org (R6). Provenance (4D) references
  must be org-scoped where customer-facing.
- **Data-provenance risks:** `raw_payload` may contain **attacker-planted text** (prompt injection);
  provenance display/reconstruction treats it as untrusted and never lets it drive privileged actions.
- **Cross-org isolation:** extend `test/isolation/r5PipelineIsolation.test.ts` for each phase that writes
  per-org data; never let clustering/qualification merge another org's signal into an org's brief.
- **Supply-chain risks:** unified/new source adapters fetch arbitrary external URLs — **SSRF**: outbound
  fetch must use the pinned `undici` agent (`buildPinnedAgent`); re-verify on `undici` bumps. New sources
  require live-URL verification.
- **Abuse scenarios:** a compromised/spammy source flooding signals (rate/volume caps + qualification
  down-weighting); source-credibility gaming (static authority anchors reliability).
- **Logging/audit:** per-source fetch health → `feed_health`; qualification changes logged with source id
  (no secrets/PII); LLM call sites log `organizationId` + model + prompt-hash (not raw prompt); no raw
  `raw_payload` in logs.

## 7. Migration Strategy

- **Zero-downtime:** all schema changes **additive, nullable, no backfill, idempotent, auto-apply-safe on
  boot** (mirror `20260624_cyber_signals_external_id.sql`). Never alter `dedup_hash` or its unique indexes.
- **Backward compatibility:** RSS path unchanged; clustering/qualification are read-side, flag-gated, with
  single-signal/prior-ranking fallbacks; new columns inert until enabled.
- **Feature-rollout sequence:** per-phase flag → **staging first** → soak → prod enable as a separate
  operator step.
- **Monitoring:** `feed_health` per-source, queue depth, cluster counts/corroboration, brief-generation
  success rate, fan-out per-org error-isolation logs.
- **Rollback plan:** flag-off restores prior behavior instantly; revert additive columns if needed
  (documented manual `DROP` in each migration header). `main` only after staging soak + authorization.

## 8. Implementation Backlog (prioritized)

**EPIC P4-A — Unified registry + contract** *(critical path, first)*
- A1: define four-stage signal contract types. **AC:** types compile; unit test maps a real `cyber_signals`
  row → `NormalizedSignal`; no runtime change.
- A2: `kind`-discriminated `SourceDescriptor`; annotate 6 RSS entries `kind:'rss'`. **AC:** registry
  conformance test passes; aggregator behavior unchanged.
- A3: register the 7 direct adapters as `kind:'api'` (keep fetch funcs). **AC:** `briefScheduler` resolves
  them via registry; brief fixture byte-identical.
- A4 (optional debt): shared fan-out helper to reduce 3-path drift. **AC:** all three paths call one helper;
  isolation lane green.

**EPIC P4-B — Source qualification** *(after 4A)*
- B1: storage decision + additive migration. B2: static authority annotations. B3: rolling-reliability
  scorer from `feed_health`. B4: flag-gated ranking integration. **AC:** every source has a qualification
  record; reliability proven by integration test; flag-off = prior ranking.

**EPIC P4-C — Clustering** *(after 4B)*
- C1: `cluster_key` function (CVE + fingerprint). C2: additive `cluster_key` column + index. C3:
  cluster-aware brief bucketing + fallback. **AC:** same-CVE clusters; distinct events don't; flag-off
  identical to today.

**EPIC P4-D — Provenance** *(after 4A; sequenced last)*
- D1: additive lineage refs/edge table. D2: populate during fan-out/brief. **AC:** brief item → source
  signal → raw payload reconstructs; org-scoped; isolation test extended.

**Estimated order:** A1→A2→A3→(A4)→B1→B2→B3→B4→C1→C2→C3→D1→D2.

## 9. Repository Impact (directories + why)

- `src/api/lib/feedAdapter/` — unify the registry; the heart of D4.
- `src/api/lib/` (the 7 direct adapters + a new `signals/` subdir for contracts, qualification, clustering,
  provenance) — new pure-logic components.
- `src/api/lib/cyberSignalProcessingService.ts` + `services/intelligence-worker/src/pipeline/runPipeline.ts`
  + `kevPoller.ts` + `src/api/lib/briefScheduler.ts` — fan-out reads the unified registry; keep behavior in sync.
- `src/api/lib/intelligenceBriefGenerator.ts` — consume qualification (4B), clusters (4C), write provenance (4D).
- `db/migrations/` — additive migrations for qualification storage (4B), `cluster_key` (4C), provenance refs (4D).
- `test/isolation/` + `src/api/lib/**/__tests__/` — extend the R5 lane + unit tests per phase.
- `render.yaml` / `.env.example` — only new feature-flag keys (config, at enable time — separate operator step).
- `docs/roadmap/` + `BUILD_SEQUENCE.md` + `TENANT_ISOLATION_STANDARD.md` — doc-sync per phase.

## 10. Unknowns — **REQUIRE OPERATOR APPROVAL BEFORE IMPLEMENTATION**

These design decisions are **open** and must be settled by the operator before (or at the start of) the
relevant phase. None may be silently decided during implementation.

1. **D3 storage location:** extend `feed_health` vs a new `sources` table. *(Recommendation: a small
   `sources` table keyed by source id; decide before 4B.)* — **operator approval required.**
2. **D2 CVE-less fingerprint:** exact entity+type+day-bucket definition + over-merge threshold — needs
   validation against real signal data. — **operator approval required.**
3. **T1 contract field set:** the concrete fields of each of the four stage types. — **operator approval required.**
4. **D5 timing & shape:** provenance in P4 vs P5; refs-columns vs a `signal_provenance` edge table. — **operator approval required.**
5. **Feature-flag names** and whether each phase ships dark-by-default (recommendation: yes). — **operator approval required.**
6. **A4 fan-out unification** — do it now (reduces drift) or defer (smaller blast radius)? — **operator approval required.**
7. **Pre-work docs-sync:** fix the stale design-doc §12 #5 status before 4A. — **operator approval required.**

## Execution strategy

### Recommended branch strategy
- One branch per phase off `origin/develop`: `feat/p4a-unified-registry`, `feat/p4b-source-qualification`,
  `feat/p4c-signal-clustering`, `feat/p4d-provenance`. Each fresh off latest `develop` (preflight
  `git diff --stat origin/develop...HEAD`).
- Sub-stories may use short-lived child branches merged into the phase branch, or land as small PRs into `develop`.
- Promotion `develop → main` per the standing rule: **`gh pr merge --merge` (never squash)**; `main` only
  after staging soak + explicit authorization. Reconcile `main→develop` after each promotion.

### Recommended PR strategy
- **Small, additive, single-concern PRs**, each green on the full CI gate incl. `cross-org-isolation`, each
  with: the seven-section pre-implementation brief, tenant/security review, negative-path tests, a feature
  flag for any behavior change, and the matching docs-sync.
- Migrations land **before** the code that reads them; behavior changes ship **dark** behind a flag and are
  enabled in staging first.

### The first implementation PR only (smallest safe vertical slice)
**PR `feat/p4a-registry-kind` — "4A.1: typed source-descriptor contract + `kind` discriminator on the RSS
registry (additive, no behavior change)."**
- **What:** add `src/api/lib/signals/contracts.ts` (the `SourceKind`/`SourceDescriptor` types + the four
  stage type stubs) and annotate the existing 6 `registry.ts` entries with `kind:'rss'` (their `sourceTier`
  already present). The aggregator reads the new field but behaves identically.
- **Does NOT:** no direct-adapter migration, no DB, no flag, no fan-out change, no brief change.
- **Tests:** unit — every registry entry conforms to `SourceDescriptor`; a `cyber_signals` fixture row maps
  to `NormalizedSignal`.
- **Validation:** full CI gate; brief fixture byte-identical; `cross-org-isolation` green.
- **Rollback:** pure additive types + one field; `git revert`. Zero runtime risk.
- **Why first:** it establishes the contract + registry foundation every later phase depends on, with the
  smallest possible, fully-revertable footprint and no production behavior change.

### Confidence rating
- **Overall plan & sequencing: HIGH** — design ratified, prerequisites met, additive approach mirroring proven repo patterns.
- **Per phase:** 4A **HIGH** · 4B **High/Medium** (storage decision open) · 4C **MEDIUM** (CVE-less
  fingerprint + query cost need real-data validation) · 4D **MEDIUM** (timing/shape partly open, D5 principle-only).

---

> **This document is a planning deliverable. No code, migration, or configuration has been produced, and
> Priority 4 implementation has NOT begun. It awaits operator review and explicit authorization of the
> build scope and the first PR before any code is written.**
