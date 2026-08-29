# Capability Audit Phase 2 — 95/95 Gap Decomposition and Execution Roadmap

**Produced:** 2026-08-22. **Planning only.** Nothing built, no migration, no
merge, no promotion, production untouched. Frozen candidate `65cd3330`
unchanged, #826 undisturbed.

**Governing baseline:** `docs/architecture/ENTERPRISE-CAPABILITY-BASELINE.md`
(PR #857). **Instructed to challenge its sequencing, not adopt it.**

---

## 1. The challenge: #857 optimises the wrong target

#857 scored and sequenced **platform-wide** across 17 domains. Then a governing
ruling landed *after* it: `SEPT15-ADVERTISED-SCOPE-RULING.md` (PR #858) narrowed
Sept 15 to **four advertised workflows**.

**#857's wave plan was therefore built against a scope that no longer exists.**
It is not wrong — it is answering "how does the whole platform reach 95/95",
when the operative question is now "how does the *advertised product* reach
95/95, and how does the rest follow."

Those have very different answers.

### 1.1 Two targets, not one

| Target | Scope | P1s in play |
|---|---|---|
| **T1 — Advertised 95/95** | Findings & Remediation · Risk Register + Exceptions · Intelligence Brief · Vendor Assurance (conditional) | **7 of 18** |
| **T2 — Platform 95/95** | All 17 domains | 18 of 18 |

**Deriving T1 by elimination, from the scope ruling's own claims:**

| P1 | In T1? | Why |
|---|---|---|
| P1-1 extraction fix | **Yes** | Vendor Assurance is advertised |
| P1-2 Finding provenance | **Yes** | Same |
| P1-3 ADR-0010 ruling | **Yes** | Same |
| P1-13 admin audit | **Yes** | ER is cross-cutting; auditability applies to all four |
| P1-14 secret scanning | **Yes** | Cross-cutting ER |
| P1-15 DR restore | **Yes** | Cross-cutting ER — "recoverable" is in the definition of done |
| P1-16 branch protection | **Yes** | Cross-cutting release integrity |
| P1-17 deploy ordering | **Yes** | Cross-cutting release integrity |
| P1-12 MTTR / SLA attainment | **No** | **The scope ruling explicitly forbids claiming it.** Descoping the claim removes the gap |
| P1-9 evidence lifecycle | **No** | Verified: Vendor Assurance uses `vendor_assurance_documents`, not `evidence`. Findings' closure gate uses evidence **attachment** (`require_evidence_gate`), which works today; *expiry and reuse* are sufficiency gaps for capabilities not being advertised |
| P1-10 policy versions/attestation | **No** | Policies not advertised |
| P1-4 asset estate · P1-5 scanner | **No** | Vulnerability Management not advertised |
| P1-6/7/8 AI Governance | **No** | Not advertised (inventory only) |
| P1-11 pen-test model | **No** | Not advertised |
| P1-18 OPS-1 | **Partly** | Needed for T2. For T1, the four workflows have SR runbooks; OPS-1 raises ER above ~85, it does not gate the workflows |

> **T1 is 8 packages, and five of them are XS cross-cutting items.** That is a
> materially faster path than #857's eight-wave plan implies, and it is the
> single most useful finding in this decomposition.

### 1.2 The schema cutoff is not binding — once scope is narrowed

The Sept 15 schema cutoff is **2026-08-29**; the promotion is targeted
**Aug 26–27**. That looked like a ~2-day merge window for schema work, and
#857 treated it as a forcing function.

**Checked: none of the eight T1 packages requires a migration.**

| T1 package | Schema? |
|---|---|
| P1-1 extraction fix | No — one-line validator change (PR #855 exists) |
| P1-2 Finding provenance | No — read model + UI over existing columns |
| P1-3 ADR-0010 ruling | No — a decision |
| P1-13 admin audit | No — `lib/auditLog.ts` and `security_audit_log` already exist |
| P1-14/16/17 | No — CI config, GitHub settings, `render.yaml` |
| P1-15 DR restore | No — an exercise |

**The 08-29 cutoff therefore does not constrain the advertised launch at all.**
It constrains T2 work (evidence lifecycle, AI Governance), which is not in the
Sept 15 scope. #857's urgency around it was inherited from the wider scope.

### 1.3 The promotion is on the critical path *incidentally*

#857 places Wave 0 first because it "moves every ER score". True for
*measurement*. But it is on the **critical path** for a narrower, more specific
reason:

> **Staging tracks `develop`. The extraction fix cannot reach staging without a
> merge into the frozen branch. VA-3 cannot run without it. Vendor Assurance
> cannot be advertised without VA-3.**

The promotion is not intrinsically upstream of Vendor Assurance — it is upstream
because of a *deployment topology choice*. That distinction matters, because it
identifies the one place where a topology change could shorten the path (and why
we are not making it: repointing staging disturbs what #826 measures).

### 1.4 The distinction #857 missed: measurement gate ≠ work gate

#857 reads as though nothing can proceed until Wave 0 completes. **That is not
true.** The freeze blocks **integration**, not **construction**. Every T1
package except P1-1 can be *built and CI-verified on a branch today*.

The real constraint on parallelism is not the freeze — it is **merge-queue
conflict risk**, which is bounded and analysable (§4).

---

## 2. Package decomposition — T1 (advertised 95/95)

Each package: objective · current · required · size · schema · dependencies ·
conflicts · completion criteria · evidence required.

### T1-A — Clean-SOC 2 extraction fix
- **Current:** `socExtractionValidator` waives the span requirement for `null` but not `[]`; a clean SOC 2 fails extraction. **PR #855 exists, 8/8 green, unmerged.**
- **Required:** deployed to staging so VA-3 can run.
- **Size:** XS (done). **Schema:** No.
- **Depends on:** promotion (topology, §1.3). **Conflicts:** the test file also exists on #854 with opposite assertions — merge #854 first, take #855's version.
- **Done when:** merged, staging redeployed, a clean SOC 2 extracts with CUECs > 0.
- **Evidence:** staging document reaching `extracted` with a CUEC count matching the report.

### T1-B — Finding provenance (ADR-0010 Option 4)
- **Current:** `findings/[id]/page.tsx` renders only a `source_type` label. Provenance is one-directional: CUEC → Finding exists; Finding → CUEC does not.
- **Required:** a provenance block for `source_type='vendor_review'` showing vendor, source document, CUEC text, reviewer and determination — reachable by navigation, not by pasting a UUID.
- **Size:** S. **Schema:** No — `vendor_assurance_cuecs.promoted_finding_id` reverse lookup plus `findings.source_id`.
- **Depends on:** ADR-0010 ruling (T1-C) only for *whether Option 4 is the chosen shape*. **Buildable now** — the UI is identical under Options 1, 3 and 4.
- **Conflicts:** none.
- **Done when:** VA-3 gate 12's four UI legs pass without a database query.
- **Evidence:** staging screenshots + the provenance join returning one row per CUEC.

### T1-C — ADR-0010 ruling
- **Current:** OPEN, due **2026-08-28**. **Size:** XS (a decision). **Schema:** No.
- **Done when:** ADR status moves to ACCEPTED naming an option, and VA-3 gate 12's engagement leg is reclassified accordingly.

### T1-D — ADMIN-AUDIT-1: durable administrative audit
- **Current:** `adminAudit` writes `logger.info` to stdout. **1 of 32** admin route modules writes a durable row.
- **Required:** consequential admin actions write `security_audit_log` via the existing `lib/auditLog.ts`.
- **Size:** S–M. **Schema:** No.
- **Depends on:** nothing. **Conflicts:** touches `src/api/routes/admin*.ts` — collides with any future OPS-1 admin surface. **Do this before OPS-1, not after.**
- **Done when:** every mutating admin route writes a durable row; a test asserts coverage the way `vendorEntitlementGate.test.ts` asserts entitlement coverage.
- **Note:** an actor field is only meaningful after ADMIN-ACCESS-2 (P3). Record *what* happened now; *who* follows later.

### T1-E — Secret scanning in CI
- **Current:** CI has a real dependency-audit gate and **no secret scanning**.
- **Size:** XS. **Schema:** No. **Conflicts:** `.github/workflows/ci.yml` — serialise with T1-G.
- **Done when:** a new lane fails on a planted test secret and passes on `develop`.

### T1-F — DR restore rehearsal
- **Current:** `DR_PLAN.md` marks RTO/RPO "proposed — ratify before quoting to customers"; the §6 restore test has never been executed.
- **Size:** S. **Schema:** No. **Conflicts:** none. **Operator-owned** — requires production backup access.
- **Done when:** a restore is executed to a throwaway target, measured against the stated RTO/RPO, and the numbers are either ratified or corrected.

### T1-G — Branch protection + deploy ordering
- **Current:** no branch protection; `autoDeploy: true` on all six production services defeats engine → workers → app ordering.
- **Size:** XS each. **Schema:** No. **Conflicts:** T1-E on `ci.yml`; `render.yaml` with any flag change.
- **Operator-owned** (admin scope; the session credential is refused 403 on the protection API).
- **Done when:** the profile in `RELEASE-BOUNDARY-FREEZE.md` §9 is applied and a deploy-order treatment is recorded.

### T1-H — VA-3 execution
- **Size:** S if clean; the defects it finds become the package. **Schema:** No.
- **Depends on:** T1-A deployed. **Done when:** the plan reaches a PASS/DEGRADED/FAIL verdict on staging evidence.

---

## 3. Package decomposition — T2 (platform 95/95)

Summarised; these are **not** Sept 15 work.

| ID | Package | Size | Schema | Depends on | Note |
|---|---|---|---|---|---|
| **T2-A** | Evidence lifecycle — validity, expiry, renewal, reuse across controls | M | **Yes** | Decision on the reuse model | **Unblocks four verticals.** Highest T2 leverage |
| **T2-B** | AI Governance relationships — system → framework/control/policy | M | **Yes** | AI Governance scope decision | Largest single CS gap; **independent of everything** |
| **T2-C** | AI inventory enrichment — business + technical owner, provider, sensitive-data, risk vocabulary | S | **Yes** | T2-B | Same migration family |
| **T2-D** | AI material change + reassessment | M | **Yes** | T2-B, T2-C | |
| **T2-E** | Asset estate population (PLAT-ASSET-1) | XS decide / L build | Maybe | Ownership ruling | Gates Vulnerability entirely |
| **T2-F** | Scanner ingestion connector | M | Maybe | T2-E | Orphans without T2-E |
| **T2-G** | Policy versions, approvals, attestations | M | **Yes** | — | |
| **T2-H** | MTTR / SLA attainment / aging metrics | S | No | — | Descoped from Sept 15, still needed for T2 |
| **T2-I** | Pen-test scope/methodology/retest + UI | M | **Yes** | — | |
| **T2-J** | OPS-1 | L | **Yes** | **T1-D** | Must not precede durable admin audit |

---

## 4. Parallelisation — and the two hazards that bound it

### 4.1 Safe to run in parallel *today*, while frozen

| Track | Packages | Why safe |
|---|---|---|
| **α — Product** | T1-B (Finding provenance) | Touches `app/src/app/findings/[id]/` and a read model. No overlap with anything else planned |
| **β — Platform hygiene** | T1-D (admin audit) | Touches `src/api/routes/admin*.ts` + `lib/auditLog.ts`. No overlap with α |
| **γ — Operator/config** | T1-C, T1-F, T1-G | Decisions and environment actions; no source conflict |
| **δ — CI** | T1-E | `ci.yml` only — **serialise against T1-G** if that also edits CI |

**Three code tracks maximum.** Not because of architecture, but because every
branch built during the freeze joins a merge queue that must land after the
promotion, and each addition raises conflict and re-validation cost.

### 4.2 Hazard 1 — concurrent schema packages collide on migration numbering

Migrations are ordered by **filename**, resolved in **C collation**, and the next
number is a single shared slot (`20261036` is current). Two parallel schema
packages both claiming `20261037` produce either a collision or a silent
ordering surprise.

> **Rule: at most ONE schema-bearing package in flight at a time**, or
> pre-allocate numbers explicitly and record the allocation.

This binds T2-A, T2-B/C/D, T2-G, T2-I and T2-J against each other. **It does not
bind T1 at all**, because no T1 package carries a migration (§1.2).

### 4.3 Hazard 2 — what invalidates release evidence

| Action | Invalidates |
|---|---|
| Any merge into `develop` | **The promotion candidate.** Re-mints the SHA, re-opens R-1 blocker K-1 |
| Changing `db/migrations/` | **R-1 §D rollback rehearsal** — only if the pending set changes. The check is in `RELEASE-BOUNDARY-FREEZE.md` §7.5 |
| Changing `render.yaml` prod blocks | The flag reconciliation in R-1 §G |
| Branch work with no merge | **Nothing.** This is why tracks α–δ are safe |

---

## 5. Critical path — and the fastest technically responsible path

### 5.1 The critical path is VA-3, not the promotion

```
#826 (2026-08-25T07:00Z, immovable)
  └→ promotion (Aug 26-27)
       └→ merge #854 → #855          [ordering fixed by the test-file conflict]
            └→ staging redeploys on the new develop
                 └→ VA-3 execution
                      └→ defects found become work
                           └→ Vendor Assurance advertisable?   ← Sept 5 decision
```

Every other T1 package is **shorter than this chain and off it.** The path
length is therefore fixed by #826 plus VA-3, and cannot be compressed by adding
effort.

### 5.2 Fastest technically responsible path

**The compression available is not on the critical path — it is in having the
downstream work already finished when the path clears.**

| Now → Aug 25 (frozen) | Aug 26–27 | Aug 28 → Sept 5 |
|---|---|---|
| **Build T1-B on a branch, CI-green, held** | #826 → promotion | Merge the held branches |
| **Build T1-D on a branch, CI-green, held** | Merge #854→#855→#856→#857→#858→#827 | **Run VA-3 immediately** |
| **T1-E CI lane on a branch** | Staging redeploys | Fix what VA-3 finds |
| **T1-C ADR ruling (due Aug 28)** | | **T1-B already merged**, so gate 12 passes on the first VA-3 run |
| **T1-F, T1-G operator actions** | | Sept 5: Vendor Assurance in/out decision |

> **The single highest-leverage move available right now: build T1-B (Finding
> provenance) during the freeze.** VA-3 gate 12 is a predicted FAIL. If T1-B is
> merged before VA-3 runs, gate 12 passes on the first attempt and Vendor
> Assurance can reach PASS in one exercise instead of two. Building it later
> costs an entire second VA-3 cycle — which is the longest single item on the
> critical path.

This is the concrete disagreement with #857: it schedules provenance **after**
VA-3 (Wave 2, following the VA-3 run). **That guarantees two VA-3 cycles.**
Building it during the freeze costs nothing, because the freeze blocks merging,
not building.

### 5.3 T2 sequencing — reordered from #857

#857 ordered: Vendor Assurance → Asset/Vulnerability → AI Governance → Ops →
Pen-test. **Two changes:**

1. **AI Governance (T2-B/C/D) should start as soon as a schema slot is free**,
   not at Wave 4. It is the largest single CS gap, it depends on nothing, and it
   blocks nothing. Under a one-schema-package-at-a-time rule, the scheduling
   question is only *which schema package holds the slot* — and AI Governance
   has the worst CS deficit (40).
2. **Evidence lifecycle (T2-A) has the highest leverage but is not the most
   urgent.** #857 promoted it to Wave 1 on leverage alone. Leverage is real —
   four verticals — but none of those four is advertised on Sept 15, so it can
   follow AI Governance without cost.

**Proposed T2 order:** T2-B/C/D (AI Governance) → T2-A (evidence) → T2-E/F
(asset + scanner) → T2-G (policy) → T2-J (OPS-1, after T1-D) → T2-I (pen-test)
→ T2-H (metrics) → P2/P3 hardening.

---

## 6. Completion criteria

**Per package**, applying `FINAL_PRODUCT_STANDARD` and the baseline's definition
of done. A package is complete only when **all** hold:

1. The customer workflow completes **in the product UI**, with no manual API
   call, internal id, SQL write, or engineering intervention.
2. Tenant-isolated, with a cross-org negative proof.
3. Observable — a failure produces a diagnosable signal.
4. Supportable — an SR runbook exists for each new customer-facing failure mode.
5. Auditable — consequential actions produce a durable record.
6. Recoverable — rollback stated and, for schema, rehearsed.
7. Reportable — the result is visible somewhere a customer or executive looks.
8. **Proven on staging.** Harness evidence never substitutes.

**Target gate:** a capability is 95/95 only when its CS *and* ER both clear 95.
A high CS never compensates for a low ER, which is the failure mode the whole
95/95 framing exists to prevent.

---

## 7. Architecture decisions required before implementation

| # | Decision | Blocks | Due |
|---|---|---|---|
| 1 | **ADR-0010** — spine convergence | T1-B's final shape (not its build) | **2026-08-28** |
| 2 | **Evidence lifecycle model** — validity + reuse semantics | T2-A | Before T2-A |
| 3 | **AI Governance scope** — product or inventory feature | T2-B/C/D size | Before T2-B |
| 4 | **PLAT-ASSET-1** — how estates get populated | T2-E/F | Before T2-E |
| 5 | **Schema slot policy** — serialise or pre-allocate | All T2 schema work | Before two schema packages overlap |
| 6 | **OPS-1 tenant health model** — thresholds and `UNKNOWN` semantics | T2-J | Before T2-J |

Decisions 1–4 were already recorded in #857/ADR-0010. **Decision 5 is new to
this decomposition** and follows directly from the migration-numbering hazard.

---

## 8. Estimated scores

| After | CS | ER | Basis |
|---|---|---|---|
| Today | 62 | 37 | #857 |
| Promotion only | 62 | ~55 | No capability added; everything built becomes reachable |
| **T1 complete (advertised four)** | **~68 platform / ~95 for the four** | **~72 platform / ~95 for the four** | This is the Sept 15 target and it is achievable |
| T2-B/C/D (AI Gov) | ~76 | ~74 | Largest CS jump |
| T2-A (evidence) | ~82 | ~78 | Four verticals lifted |
| T2-E/F (asset + scanner) | ~87 | ~84 | |
| T2-G/J/I/H | ~93 | ~91 | |

> **The important row is T1.** Platform-wide 95/95 remains a 2027 trajectory,
> but **95/95 for the advertised four is reachable before Sept 15** — and that
> is what the scope ruling made possible. Measuring the launch against the
> platform-wide number understates readiness; measuring the platform against the
> launch number overstates it. **Report both, never one.**

---

## 9. Recommended next action

**No implementation starts here.** In order:

1. **Operator:** #826 at 2026-08-25T07:00Z → R-3 → R-4 → promotion.
2. **Operator, by Aug 28:** ADR-0010 ruling.
3. **Authorise T1-B (Finding provenance) to be built during the freeze.** It is
   the only move that shortens the critical path, and it is currently
   unauthorised.
4. After the promotion: merge the held PRs, run VA-3.

**Stop for authorisation before any of the above becomes code.**
