# September 15 Launch Completion Program — Execution Status

Baseline: `develop` @ `bc53ae82` (master program merged: #786/#789/#788;
September-15 schema live and probe-verified on staging; production untouched).
Operator directive 2026-08-13: execute the six deferred items in priority
order, preserving the ratified architecture and every passed security gate.

Branch discipline: one branch per item (`feat/lc<N>-*`), separately reviewable
from the merged master program. Nothing in this program touches production
without explicit authorization; prod-affecting flags ship dark.

| # | Item | Branch | Status |
|---|---|---|---|
| 1 | B1 legacy VA demotion | `feat/lc1-b1-legacy-va-demotion` | **Built — validation running** |
| 2 | Ask access truth | — | Not started |
| 3 | Ask streaming | — | Not started |
| 4 | Realtime voice | — | Not started |
| 5 | Bounded agentic Ask | — | Not started |
| 6 | Platform convergence | — | Blocked on 1–5 |

---

## 1. B1 legacy Vendor Assurance demotion

**Operator decision B1 is resolved by the Launch Completion directive**: make
`vendor_engagements` the single canonical workflow writer; freeze/demote the
legacy writers; preserve compatibility/read paths; prove no competing writer.

### Scope ruling

The demoted set is `vendor_assessments` + `vendor_reviews` — exactly the set
the spine migration's own contract names (`20260919_vendor_engagements.sql:
25-28`). `assessments` / `POST /api/assess` is the generic assessment runner,
a public API **compatibility path preserved per the directive** — the Gate 0
record classifies its retirement as a separate decision with a notice period
(`sept15-va-phase0-gate0-evidence.md` §4). It does not compete with the vendor
workflow.

### Writer disposition (complete inventory, verified at bc53ae82)

| Writer | Table | Disposition |
|---|---|---|
| `POST /api/vendor-assessments` (`vendorAssessments.ts`) | vendor_assessments INSERT | **Demoted** — flag-gated 410 |
| `POST /api/vendor-reviews` (`vendorReviews.ts`) | vendor_reviews INSERT | **Demoted** — flag-gated 410 |
| `PATCH /api/vendor-reviews/:id` (`vendorReviews.ts`) | vendor_reviews UPDATE | **Demoted** — flag-gated 410 (before the assignment probe, so the demoted state cannot enumerate review ids) |
| App UI callers (`vendors/[id]/assess`, `/review`, page CTAs ×6, CompleteReviewSection) | via the above | **Demoted** — CTAs swap to the engagement intake (`/vendor-engagements/new?vendorId=…`), forms replaced by retirement notices, server actions refuse first |
| Account-deletion reaper (`accountDeletionReaper.ts`) | vendor_reviews UPDATE (reviewer_id scrub) | **Preserved** — GDPR erasure obligation, not a workflow writer (ADR-0005 precedent); allowlisted in the structural guard |
| Seed scripts (`seed-demo.ts`, `seed-walkthrough-org.ts`) + isolation-test fixtures | direct SQL | **Preserved** — operator/test data fixtures outside the product workflow and outside src/ |
| `POST /api/assess` (`assess.ts`) | assessments INSERT | **Out of scope** — compatibility path (see scope ruling) |

### Mechanism

- `SECURELOGIC_LEGACY_VENDOR_WRITES_ENABLED` — same name on engine and app
  (two-switch model). **Default ON; only the literal `"false"` disables**
  (these are live prod surfaces with first-party UI callers — the demotion
  ships dark per GATE B; the prod flip is an operator cutover step).
- Engine: 410 Gone with one canonical body (`legacyVendorWriteFlag.ts`) before
  any validation or DB work; every rejection writes a
  `*.legacy_write_rejected` audit event so the cutover runbook can watch for
  stragglers. Reads untouched.
- App: every legacy write CTA swaps to the engagement intake (with vendor
  preselect, validated against the picker list); `/assess` and `/review` pages
  render retirement notices; in-progress reviews show a read-only note.
- **Metric truth**: the ratified ASSESSED VENDOR definition is extended —
  `vendor_assessments` OR `vendor_engagements` existence (monotone; same
  existence-based no-status-qualifier stance as the 2026-08-09 ruling).
  Without this, every engagement-assessed vendor would report "never assessed"
  forever once legacy writes freeze. `assessment_count` /
  `latest_assessment_at` deliberately still count legacy records only
  (renaming/merging is item 6 convergence work).

### Proof of no competing writer

1. `legacyVendorWriterGuard.test.ts` — structural scan of `src/`: any
   INSERT/UPDATE/DELETE on the two tables outside the allowlist (three gated
   route sites + the reaper policy) fails the suite with file:line. The
   allowlist itself is asserted accurate, and the gated files are asserted to
   reference the flag.
2. `legacyVendorWriteDemotion.test.ts` — 410 + audit + no-DB-work on all three
   routes when demoted; pure passthrough when not; reads exempt.
3. The full writer inventory above (agent sweep of routes, workers, seeds,
   dead zones — evidence in this doc's table).

### Deferred within this item (deliberate)

- **DB-level freeze** (blocking trigger per the `20260725` WORM pattern +
  grant narrowing in `20260618`): correct only AFTER the prod flip — a
  trigger now would break live legacy writes while the flag still allows
  them, and it needs an erasure escape hatch for the reaper. Belongs to the
  cutover runbook as post-flip hardening.
- In-progress legacy reviews at flip time become permanently in_progress
  (read-only). Cutover guidance: flip when no reviews are in_progress, or
  accept the frozen state — rows stay visible either way.

### Validation (2026-08-13, at commit)

```
engine     480 files · 7791 passed · 3 skipped · 0 failed
app        126 files · 1671 passed ·             0 failed
isolation  147 files · 1135 passed ·             0 failed   (real Postgres; includes the tenant-wrap
                                                             suite POSTing through the new gate with the
                                                             flag defaulted — passthrough proven live)
typecheck  clean (engine + app)
```

New tests: 15 (route gating + audit + enumeration-resistance + structural
writer guard, engine) + 12 (flag semantics + CTA targets, app). Updated: the 8
`vendorsAssessmentCounts` SQL-shape assertions now hold the TWO-leg
never-assessed predicate (both legs org-scoped inside the correlation), and
the list/aggregate equivalence extractor walks the new `NOT (…)` span.
