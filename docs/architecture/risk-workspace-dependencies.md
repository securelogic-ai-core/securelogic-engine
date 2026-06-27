# Risk Workspace — architectural dependencies

**Purpose.** Document platform capabilities being built **outside** the Risk
Workspace that the Risk Workspace should intentionally **reuse**, so cohesion is
preserved across packages and nothing gets rebuilt twice or built in conflict.

**This is NOT a feature backlog.** It contains no implementation tasks, no
roadmap items, and authorizes no future work. It exists only to preserve
architectural cohesion. The Risk Workspace itself (PR #382 / `residual_score`)
is **dormant completed infrastructure**; the active package is **Priority 4
(Signal Ingestion Hardening)**.

Status labels: **VERIFIED** (read in code), **INFERRED** (reasoned),
**PLANNED** (in an authorized plan, not built), **UNSEQUENCED** (no authorized
package yet).

---

## Future Consumer Matrix (summary)

| Capability | Future consumers |
|------------|------------------|
| Residual Score | Risk Workspace · Executive Overview · Executive Reports |
| Source Qualification | Executive Brief · AI Draft Risk · Vendor Intelligence |
| Provenance | Risk Workspace · Executive Reports · Audit Timeline |
| Vendor Links | Vendor Profile · Continuous Monitoring · Executive Dashboard |
| Signal Credibility | AI Draft Risk · Executive Overview · Executive Reports |

---

## 1. residual_score foundation

- **Platform capability:** Deterministic 0–100 risk magnitude (`likelihood_impact_v1`), band via `scoreBand`, persisted with the versioned `score_basis` envelope.
- **Current implementation status:** VERIFIED — SHIPPED to `develop` (PR #382, merge `4d0d984e`). Inert: no consumer reads `residual_score` yet; not promoted to `main`.
- **Owning package:** Risk Workspace PR1 (now dormant completed infrastructure).
- **Future Risk Workspace consumer(s):** Risk Workspace ranking; Executive Overview; Executive Reports.
- **Integration notes:** Read through the existing org-scoped `RISK_SELECT`; column already returned by the risks API but dropped by the frontend `Risk` type. Consumption is the (unauthorized) PR2.
- **Architectural constraints:** `residual_rating` is authoritative (BLOCK-1); `residual_score` sorts **within** a band and breaks ties only — it must never override an analyst-set rating. One risk-magnitude number platform-wide.
- **Reuse opportunities:** Same `band → score desc → updated_at` ordering key across Risk Workspace and all executive risk surfaces.
- **Explicitly NOT to duplicate:** Do not introduce a second risk-magnitude score. Do not blend with `vendors.current_risk_score`, posture `overall_score`, `trends.score`, or `riskScoring.ts` signal scores.

## 2. source qualification

- **Platform capability:** Per-source static authority/tier + rolling reliability, keyed by stable source id.
- **Current implementation status:** INFERRED/PLANNED — registry `SourceDescriptor` for 13 sources landed (A3, #377, `develop`/staging, inert); the `sources` table (Phase 4B / B1) is the next slice, not yet built. `feed_health` (VERIFIED, global, PK `source`) supplies reliability inputs.
- **Owning package:** Priority 4 — Phase 4B (source qualification).
- **Future Risk Workspace consumer(s):** Executive Brief; AI Draft Risk; Vendor Intelligence. (Risk Workspace consumes it transitively via a risk → signal → source path.)
- **Integration notes:** Qualification must be persisted keyed by the same source id used by `feed_health` and the registry (one key, not three), so it is join-able from a risk's evidence chain — not buried in brief-generation-local state.
- **Architectural constraints:** Global (non-org-scoped) object, no RLS, behind `SECURELOGIC_SOURCE_QUALIFICATION_ENABLED`. It is a **source** score, never a **risk** score.
- **Reuse opportunities:** A single qualification read serves brief ranking, vendor intelligence, and any future "how credible is this source" Risk Workspace column.
- **Explicitly NOT to duplicate:** Do not mint a new source-identity key. Do not let qualification flow into a risk's magnitude field.

## 3. provenance

- **Platform capability:** Evidence chain linking a surfaced item back to the signal(s) and source(s) that produced it, with timestamps.
- **Current implementation status:** PLANNED — Phase 4D, deferred, not started.
- **Owning package:** Priority 4 — Phase 4D (provenance).
- **Future Risk Workspace consumer(s):** Risk Workspace ("why this risk"); Executive Reports; Audit Timeline.
- **Integration notes:** Key provenance to the same signal and source ids as qualification (capability 2) and vendor links (capability 4), so a risk's evidence is reconstructable across surfaces.
- **Architectural constraints:** Global signal-layer data referenced by org-scoped risks — never the reverse. Provenance records are append/immutable in spirit (audit use).
- **Reuse opportunities:** One provenance store backs Risk Workspace explainability, executive-report citations, and audit timeline.
- **Explicitly NOT to duplicate:** Do not build a Risk-Workspace-only provenance model; reuse the 4D structure when it lands.

## 4. signal credibility

- **Platform capability:** A derived confidence that a signal is real/relevant (matcher confidence × source qualification), distinct from source authority alone.
- **Current implementation status:** UNSEQUENCED/INFERRED — depends on qualification (4B) and matcher work (4C); no credibility object built today.
- **Owning package:** Priority 4 (downstream of 4B/4C) — not yet a discrete authorized story.
- **Future Risk Workspace consumer(s):** AI Draft Risk; Executive Overview; Executive Reports.
- **Integration notes:** Should compose from qualification + matcher outputs rather than introduce a parallel scorer; keyed to signal id.
- **Architectural constraints:** A **signal** score, namespaced away from risk magnitude (capability 1) and from `riskScoring.ts`.
- **Reuse opportunities:** Feeds AI-draft-risk confidence and executive "credibility" framing from one computation.
- **Explicitly NOT to duplicate:** Do not conflate with source qualification (a source can be authoritative while a specific signal is low-credibility).

## 5. vendor linkage

- **Platform capability:** Links from signals to vendors (`signal_vendor_links`) and vendor risk objects.
- **Current implementation status:** VERIFIED (partial) — `signal_vendor_links` exists (A04-G1 batch, #318); matcher fan-out produces vendor-scoped actions. Not exposed as a Risk Workspace surface.
- **Owning package:** Existing matcher / Vendor Risk (pre-Priority-4), extended by Priority 4 matcher work.
- **Future Risk Workspace consumer(s):** Vendor Profile; Continuous Monitoring; Executive Dashboard.
- **Integration notes:** Risk Workspace must read the canonical `signal_*_links` and vendor objects, not a parallel linkage.
- **Architectural constraints:** Org-scoped link tables under existing RLS; keyed to canonical vendor + signal ids.
- **Reuse opportunities:** One linkage model serves vendor profile, continuous monitoring, and any Risk Workspace vendor-risk view.
- **Explicitly NOT to duplicate:** Do not create a Risk-Workspace-specific signal↔vendor table. Vendor linkage is explicitly out of PR2 scope.

## 6. executive reporting

- **Platform capability:** Leadership-facing risk reporting (executive report PDF, executive overview/dashboard surfaces).
- **Current implementation status:** VERIFIED — `executiveReport.ts` server-side PDF exists; risk aggregation is **band-count, rating-ordered** today (no numeric ordering, no per-risk ranked list).
- **Owning package:** Existing Executive Reporting surface.
- **Future Risk Workspace consumer(s):** Shares the Risk Workspace ordering contract — Executive Overview and Executive Reports should rank risks identically to the workspace.
- **Integration notes:** When residual_score consumption is authorized, apply the same `band → score desc → updated_at` key here so leadership and workspace never disagree.
- **Architectural constraints:** Reads org-scoped risks; presentation may color higher-is-healthier on its own thresholds (documented cross-surface debt — see `scoring-vocabulary.md`); do not unify polarity here.
- **Reuse opportunities:** One ordering key + one score vocabulary across workspace, overview, and reports.
- **Explicitly NOT to duplicate:** Do not invent a separate executive risk score. Do not reconcile posture/vendor polarity as part of reporting.

## 7. AI explainability

- **Platform capability:** Machine-drafted risk rationale / explainability (e.g. AI Draft Risk carrying model + confidence + rationale).
- **Current implementation status:** UNSEQUENCED — not built. The `score_basis` `method/version` envelope (capability 1) is the deliberate forward seam: a future AI producer adds a new method tag + fields with no JSONB reshape.
- **Owning package:** None yet (future, unauthorized).
- **Future Risk Workspace consumer(s):** AI Draft Risk within the Risk Workspace.
- **Integration notes:** Any AI-added field in `score_basis` is tenant-visible and must be sanitized before persistence.
- **Architectural constraints:** Must extend the versioned envelope, not replace `likelihood_impact_v1`; deterministic score and AI rationale coexist as distinct methods.
- **Reuse opportunities:** The envelope already supports adding AI explainability without migration.
- **Explicitly NOT to duplicate:** Do not build AI Draft Risk now. Do not pre-create AI fields in the envelope before that package is authorized.

---

## Maintenance
Append a capability entry only when a real cross-package dependency is observed.
Keep entries to the eight fields above. Do not convert entries into tasks, and
do not use this document to authorize work.
