# Release Boundary — `develop` Freeze

**Declared:** 2026-08-21. **Authority:** operator instruction, this session.
**Status of enforcement:** **documentary only — see §4.**

---

## 1. The boundary

| | |
|---|---|
| **Promotion candidate SHA** | **`65cd333064e19443c72626ddd16780705b13bf08`** |
| Subject | `docs(launch): Sept 15 launch reconciliation and governing doc sync (#853)` |
| Minted by | Squash-merge of PR #853 into `develop`, 2026-08-21 |
| Prior tip | `4fe16808` — **superseded**, and never a valid candidate (§2) |
| `origin/main` | `011e1f1d` |
| Delta | 94 commits · 376 files · +40,092 / −1,413 · **16 migrations (232 → 248)** |
| Evidence pack | `docs/release/R1-PROMOTION-READINESS-PACK.md` |
| Rollback | `docs/release/ROLLBACK-20261021-20261036.sql` |

The R-1 pack's §A rule is now satisfiable: CI runs on this SHA directly, as a
push event, not on an ancestor and not on a PR head.

## 2. Why the freeze exists

`4fe16808` carried **zero check-runs**. Three merges landed within twelve
seconds and the concurrency group cancelled the tip's run while letting its
ancestor `3a8ae09e` finish green. R-1 requires green CI on the *exact* candidate,
so that tip could never have been promoted without re-running CI on it.

That is the failure mode the freeze prevents. Every further merge into `develop`:

1. re-mints the candidate and re-opens blocker **K-1**;
2. invalidates the SHA-specific evidence in R-1 — the 16-migration inventory,
   the four rollback rehearsals, the flag reconciliation, and the §F.4
   tree-equality proof are all statements about *this* tree;
3. risks a repeat of the concurrency-group cancellation.

## 3. What the freeze permits and forbids

**Forbidden until the promotion completes or is abandoned:**

- Any merge into `develop`, including documentation and Dependabot.
- Any repoint of a staging service away from `develop` (all seven staging
  services are pinned to it).

**Permitted, and expected:**

- Work on branches. Open PRs freely; they queue.
- **VA-3**, the Vendor Assurance staging operational exercise. It is a
  *staging exercise*, not a code change: it runs against the deployed
  `4fe16808`/`65cd3330` staging tree and writes nothing to the repository.
  Defects it finds are branched and held, not merged. **The freeze therefore
  costs nothing on the critical path.**
- R-1 blocker closure (**OP-1 … OP-8**), none of which touches `develop`.
- #826 / Tier 2 observation at the 2026-08-25T07:00Z window.

## 4. Enforcement is operator-owed

Branch protection could not be applied from this session:

```
GET /repos/securelogic-ai-core/securelogic-engine/branches/develop/protection
  → HTTP 403
```

The credential available here has no administration scope, so it can neither
read nor write branch protection. **The freeze is presently a convention, not a
control.**

**No protection settings have been changed.** §9 records the recommended profile
as a deliberate release-governance action, to be applied **after the current
frozen candidate is dispositioned** — not mid-flight, where a new required check
or review rule could block the promotion it is meant to protect.

## 5. Open PRs targeting `develop` — 21, all held

**Nine substantive:**

| PR | Title | Note |
|---|---|---|
| **#827** | `DO NOT MERGE — fix(evidence,nav): tell the truth when object storage is unavailable [SL-EVID-1 + SL-NAV-1]` | **Already self-held.** Directly relevant to VA-3 — see §6 |
| #754 | vendors landing page truth pass | |
| #705 | PENDING_ENABLEMENT operator checklist | |
| #596 | ADR — Finding affected-vendor resolution | self-marked DO NOT MERGE |
| #575 | Findings experience architecture review | |
| #463 / #462 | persist `cluster_key` on ingest routes / automated paths | |
| #461 | Priority 4 doc-sync | |
| #254 | populate `source_regulation` on template obligations | |

**Twelve Dependabot** (#690, #687, #238, #237, #209, #171, #94, #61, #60, #59,
#57, #56). These matter: #812 restored a meaningful CI audit gate, and
production currently carries **65 advisories (40 high)**. They are nonetheless
**held** — the security remediation reaches production through *this* promotion,
not through a dependency bump merged into a frozen branch. Merge them after.

## 6. One interaction the freeze creates — and it is not new debt

PR #827 fixes a **pre-existing production defect**, verified here by comparing
`render.yaml` at `origin/main` and `origin/develop`:

> The production engine declares `SECURELOGIC_VENDOR_ASSURANCE_ENABLED=true`
> and **no R2 credentials at all** — identically on both branches. On that
> engine, `getBlobStorageClient()` throws `BlobStorageNotConfiguredError`, and
> three call sites converted the storage fault into
> `processing_error_code = 'pdf_unparseable'`. A customer uploading a SOC 2
> report got HTTP 500 and a document row asserting **their file was corrupt**.

Three consequences, stated plainly:

1. **It does not block the promotion.** The condition is identical on `main` and
   `develop`. Promoting neither creates nor worsens it.
2. **It does block advertising Vendor Assurance**, and it is why #827 exists.
3. **#827 is blocked by the same gate as the promotion** — merging it would
   change the staging state #826/Tier 2 is measuring. The correct order is:
   **#826 clears → promote → unfreeze → merge #827 → wire production R2.**

Recorded because it would otherwise be discovered at the worst possible moment:
by a design partner, in production, being told their file is corrupt.

## 7. Unfreeze conditions and the ratified merge sequence

### 7.1 Ratified 2026-08-21 — promote first, merge second

**Operator decision: the candidate `65cd3330` stays intact. Nothing merges into
`develop` until the promotion completes.**

The alternative — merging the held PRs as soon as #826 clears — was considered
and declined. It would re-mint the candidate, re-open R-1 blocker **K-1** (green
CI on the exact candidate SHA), require a fresh CI cycle on the new SHA, and
redeploy staging. The migration set would be unchanged, so the rollback
rehearsal and migration inventory in R-1 §C–§D would survive; but the SHA-specific
evidence would need re-cutting for no gain, because **none of the held PRs is a
promotion blocker**:

| Held PR | Blocks promotion? | Why it can wait |
|---|---|---|
| #854 — R-1 / freeze / VA-3 evidence | No | Documentation |
| #855 — clean-SOC 2 extraction fix | No | The defect is **identical on `main` and `develop`**; promoting neither creates nor worsens it |
| #827 — storage-fault error truthfulness | No | Same: pre-existing and identical on both branches |
| Dependabot ×12 | No | The security remediation reaches production through **this promotion**, not through a bump into a frozen branch |

The cost of this ordering is that Vendor Assurance is not demonstrable on
staging until after the promotion, because staging tracks `develop` and the
extraction fix cannot reach it before then. That is accepted deliberately —
see `docs/validation/VA-3-RERUN-PLAN.md` §0.1, option C.

### 7.2 The sequence

```
  1.  #826 / Tier 2 observation completes at the 2026-08-25T07:00Z window
      └─ 27-box checklist, live log evidence, recorded on the issue
  2.  R-1 blockers K-2 … K-5 closed (operator: OP-1, OP-2, OP-4, OP-5, OP-6)
  3.  R-4 / B-5 ruling recorded — dark or target state
  4.  PROMOTE  develop(65cd3330) -> main   as a true merge commit
      └─ acceptance test: resolved tree == origin/develop^{tree}   (R-1 §F.4)
      └─ verify origin/main..origin/develop == 0 afterwards
  5.  Production deploy observed green on all six services
  ──────────────  FREEZE LIFTS HERE  ──────────────
  ── ADR-0010 decision due 2026-08-28 (product owner) ──
      └─ gates ADVERTISING Vendor Assurance, not the promotion
      └─ Options 1 and 2 need a migration, so the 08-29 schema
         cutoff makes an undecided ADR choose Option 3/4 by default
  6.  Merge #854   (evidence; documentation only)
  7.  Merge #855   (extraction fix)      <- MUST follow #854, see 7.3
  8.  Merge #827   (storage-fault error truthfulness)
  9.  Merge the 12 Dependabot PRs
 10.  Staging redeploys on the new develop
 11.  Execute the VA-3 re-run  (docs/validation/VA-3-RERUN-PLAN.md)
```

Steps 6–9 are a second, small release that a later promotion carries. That is
the pattern R-1 §M recommends: separate "does the release deploy safely" from
"is the feature ready", so a feature slipping does not drag the deploy risk with
it.

### 7.3 #855 must merge after #854, and there is a one-file conflict

`src/api/__tests__/va3CleanSoc2ExtractionRepro.test.ts` exists in **both** PRs,
with deliberately opposite assertions:

| | #854 | #855 |
|---|---|---|
| Role | **characterisation** — records the defect as it stands | **failing-first regression test** |
| Asserts | `[]` is rejected (pre-fix behaviour) | `[]` is accepted (fixed behaviour) |

Merging #854 first and #855 second produces a conflict on that single file.
**Resolution: take #855's version.** Merging in the other order would leave a
test asserting the broken behaviour on a tree where it is fixed, and CI would
fail — loudly, which is the safe direction, but avoid it.

### 7.4 Unfreeze triggers

Unfreeze when **any** of the following holds:

- The promotion completes (`origin/main..origin/develop` = 0) — the expected path; or
- The promotion is abandoned by operator decision; or
- A NO-GO condition in R-1 §M fires and the boundary is deliberately re-cut.

### 7.5 If the freeze is broken early anyway

**K-1 re-opens.** Re-mint the candidate, re-run CI on the new SHA, and update
R-1 §A. R-1 §D does **not** need re-running unless `db/migrations/` changed —
the rehearsal is about the migration set, not the tree. Confirm with:

```
comm -13 <(git ls-tree -r --name-only origin/main db/migrations | LC_ALL=C sort) \
         <(git ls-tree -r --name-only origin/develop db/migrations | LC_ALL=C sort)
```

If that still lists exactly `20261021`–`20261036`, the rehearsal stands. The
harness is reproducible from R-1 §D. **Use `LC_ALL=C`** — locale collation
orders migrations differently from Node's `Array.sort()` and will mislead you.

---

## 9. Recommended branch-protection profile — **documented, NOT applied**

Nothing below has been configured. This is a proposal for deliberate
application once the frozen candidate is promoted or abandoned. Applying it
during the freeze risks blocking the very promotion the freeze exists to
protect: a newly required check that has never run on `65cd3330` would show as
missing, and a new review rule would gate an already-evidenced candidate.

### 9.1 Required status checks

Both branches should require **all eight** lanes. The names below are the
check-run names GitHub sees, taken from `.github/workflows/ci.yml`; a
mismatched string silently requires nothing, which is worse than no rule:

```
typecheck   lint   url-drift   test   audit   build   cross-org-isolation   tenant-coverage
```

- **Require branches to be up to date before merging:** `main` **yes**,
  `develop` **no**. On `main` a stale merge can promote an untested tree. On
  `develop` it would serialise every merge behind a full CI cycle and reproduce
  the concurrency-cancellation problem in §2.
- `audit` and `cross-org-isolation` are non-negotiable on both. The first is the
  dependency gate #812 restored; the second is the tenant-isolation gate, and
  this is a multi-tenant product.

### 9.2 Required reviews

| | `develop` | `main` |
|---|---|---|
| Approvals required | **1** | **2** |
| Dismiss stale approvals on new commits | yes | yes |
| Require review from Code Owners | yes | yes |
| Require conversation resolution | yes | yes |
| Require approval of the most recent push | no | **yes** |

`main` is the deployed branch: every merge into it deploys to production
automatically (§9.7). Two approvals and last-push approval are proportionate to
that blast radius.

### 9.3 Direct pushes

**Prohibited on both.** All changes arrive by pull request. `main` additionally
restricts who may merge to the release owners.

This is not currently true: today `main` and `develop` both accept direct
pushes, and the E-1/E-2 release commits reached `main` that way. That history is
the reason §F of the R-1 pack had to reconcile a divergence at all.

### 9.4 Admin bypass

- **`develop`: admins may bypass**, because they must be able to break a freeze
  in an incident.
- **`main`: "Do not allow bypassing the above settings" — ON.**

The asymmetry is deliberate. A production promotion should never be a thing one
person can do alone at 2am; recovering a stuck integration branch sometimes must
be. Every `main` bypass that does occur should be recorded in the release doc
with a reason.

### 9.5 Force pushes and deletion

**Both forbidden on both branches, with no admin exemption on `main`.**

A force-push to `main` would rewrite the deployed history and invalidate every
`/version` ancestry check the promotion evidence rests on. Deletion protection
is cheap insurance on the two branches every environment is pinned to.

`develop` may allow force-push **only** for an admin resolving a broken merge,
and only announced in advance.

### 9.6 CODEOWNERS

**There is no CODEOWNERS file in this repository today** — verified. "Require
review from Code Owners" therefore does nothing until one exists, and should be
enabled in the same change that adds it.

Recommended starting coverage — narrow, aimed at what is expensive to get wrong,
not at everything:

```
# Governing documents — the source of truth for product intent and build order
/PRODUCT_VISION.md                    @release-owners
/CURRENT_STATE_ARCHITECTURE.md        @release-owners
/CANONICAL_DOMAIN_MODEL.md            @release-owners
/TENANT_ISOLATION_STANDARD.md         @release-owners @security-owners
/BUILD_SEQUENCE.md                    @release-owners
/FINAL_PRODUCT_STANDARD.md            @release-owners

# Schema. Migrations are forward-only in production and the batch just rehearsed
# proves how narrow the reversal window is.
/db/migrations/                       @release-owners @data-owners

# Deployment topology, feature flags, and every production env declaration
/render.yaml                          @release-owners

# Tenant isolation and the security perimeter
/src/api/infra/pgSsl.ts               @security-owners
/src/api/middleware/                  @security-owners
/src/api/lib/dataClassification.ts    @security-owners @data-owners
/test/isolation/                      @security-owners

# Release evidence
/docs/release/                        @release-owners
/docs/validation/                     @release-owners
```

Team handles are placeholders; substitute real ones. Keep the file short — a
CODEOWNERS that matches everything trains people to click through it.

### 9.7 Production-promotion approval

The strongest recommendation here, and the one that is not a GitHub setting.

**Today `render.yaml` declares `autoDeploy: true` on all six production
services.** The moment `main` moves, engine, app and all four workers deploy
concurrently — and only the engine runs `npm run migrate`. There is no approval
step between "PR merged" and "production migrating", and no way to order the
deploy (R-1 §G.4).

A promotion to `main` should require, in order:

1. **Green CI on the exact candidate SHA** — a push-event run, not an ancestor's
   and not a PR head's. This is the rule `4fe16808` failed (§2).
2. **A recorded R-4-class ruling** on whether the promotion is dark or
   target-state, with the flag diff attached.
3. **A rehearsed rollback for the migration batch in the release**, with its
   irreversible behaviour enumerated. `docs/release/ROLLBACK-…sql` is the
   template.
4. **Two approvals**, at least one from a release owner.
5. **A physical backup / PITR marker** taken immediately before the merge.
6. **A deploy-order decision** — either `autoDeploy: false` on the workers and
   app for the duration, or an explicit, recorded acceptance of the concurrent
   window and someone watching worker logs through it.

Items 1–5 map onto a GitHub Environment named `production` with required
reviewers, gating a promotion workflow. Item 6 is a Render change and cannot be
enforced from GitHub — which is exactly why it should be written into the
release checklist rather than assumed.

**Sequencing:** apply §9.1–§9.6 after the candidate is dispositioned. Treat
§9.7 as the higher priority of the two: the deploy-ordering gap is a live
operational risk today, and it is not fixed by any branch-protection setting.
