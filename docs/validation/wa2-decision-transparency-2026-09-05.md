# WA-2 — Defend a determination without leaving the engagement, and correct a contact

**Result: PASS**

| | |
|---|---|
| Package | WA-2 (owner walkthrough remediation, rulings 1, 2, 4; ruling 3's intake half) |
| PR | [#1008](https://github.com/securelogic-ai-core/securelogic-engine/pull/1008) |
| Merge SHA | `2afbf5242130c721e247148df200b8a07b96ba34` |
| `develop` after merge | `2afbf524` |
| Staging deployed SHA | `2afbf524` — engine-staging live 02:38:41Z, app-staging live 02:40:34Z; both re-verified `live` at that commit immediately before each browser run |
| Migrations | **`20261090_applicability_challenge_and_intake_reason.sql`** (rollback: `docs/release/ROLLBACK-20261090.sql`) |
| Production | **untouched.** `main` = `2340bad4` and does not contain this merge. `SECURELOGIC_VENDOR_ASSURANCE_ENABLED=false` on the production engine; `SECURELOGIC_EVIDENCE_LIFECYCLE_V2` undeclared and therefore off. Both read-only verified, nothing changed |
| Date | 2026-09-05 |

---

## 1. What this package closes

From the owner's manual walkthrough of 2026-09-04. WA-1 closed the vendor's side
of the answer; WA-2 closes the analyst's side of the *decision*.

| Walkthrough finding | Closed by |
|---|---|
| A rating could not be defended without leaving the engagement | The basis envelopes now travel on the engagement read and render through one shared `ClassificationBasisPanel` |
| The composition said only what it asked, never what it did not | `coverage` / `excluded_by_rules` / `dropped` are rendered from the stored snapshot |
| No way to disagree with a determination | `vendor_engagement_applicability_challenges` — append-only, human-attributed, a record and never a mechanism |
| A mistyped contact address had no correction path except Delete | A contact edit form |
| An add refused by an invisible inactive contact | Root-fixed by a pre-flight lookup that names the holder and offers reactivation |
| `overrideInherent` refused with a false reason | Refusal copy corrected — under VO2 the scope does not derive from `inherent_rating` |
| A corrected determination carried no reason | `vendor_relationship_intake.change_reason`, required on a re-intake only |

**One owner finding was misfiled and is recorded as such.** Finding 3 ("Add
Contact from Send/Issue produced an error") did not happen: a whole-day read of
the Render engine logs shows *every* `POST …/contacts` returning 201. The only
contact-surface errors were two `DELETE …/contacts/9f5e8e81… → 409`, which is
the correct `contact_in_use` refusal on the typo contact. The real defect found
in its place — and fixed here — is the hidden-inactive collision.

## 2. What was built

Detail lives in the PR. Three points matter for the record:

**The floor is not negotiable, and the code offers no way around it.** A
challenge records disagreement beside SecureLogic's own determination and
rationale, copied off the snapshot at the time. Nothing reads the table to
decide anything, and no route removes a requirement. Liveness is derived from
`snapshot_hash`, so a challenge cannot silently outlive the composition it
objected to.

**The contact collision is fixed at the root, not caught.** The pre-flight
lookup must stay *above* the primary-contact demotion — a return after it would
commit the demotion (the defect class of #866) — and it cannot be a `catch`,
because a `23505` aborts the transaction.

**One deliberate contract reversal.** VO-11 had asserted `criticality_basis` was
`undefined` on the engagement read. It is now present by design, and the
isolation test that pinned the old shape was updated rather than worked around.

## 3. Validation

### CI at the merged head `2a363084` — all eight required checks

`audit` · `build` · `cross-org-isolation` · `lint` · `tenant-coverage` ·
`test` · `typecheck` · `url-drift` — **all success**.

| Lane | Result |
|---|---|
| `cross-org-isolation` (CI) | **215 files / 2196 tests passed** |
| `test` — engine unit (CI) | 612 files / 10081 passed, 3 skipped |
| `test` — app unit (CI) | 169 files / 2175 passed |
| Isolation, local, fresh Postgres with 286 migrations | 215 files / 2196 passed |
| App unit, local | 169 files / 2175 passed |
| `tsc --noEmit` (engine + app) | clean |
| `eslint` (engine) | 0 errors (1 pre-existing warning in an unrelated file) |

**CI was red first, and that matters.** The original head `9adce3b2` failed
`cross-org-isolation` at **1 failed / 2194 passed**: VO-6's second-intake test
expected `201` and got `400 change_reason_required`. The test was pinning the
pre-WA-2 contract. It was missed because the pre-merge local run covered 8
isolation suites rather than all 215 — and `npx vitest run test/isolation/<file>`
reports "No test files found" and exits 1, because the default config's include
globs do not cover `test/isolation`. That empty run reads as a tooling hiccup
rather than a skipped gate. **Only `npm run test:isolation` over the whole
config counts as having run it.**

Fixing it exposed a second, worse defect that no test would have caught: the
engine gate shipped with **no app-side field**. `RelationshipIntakeInput` had no
`change_reason` and the intake form rendered no input, while the vendor page
still offered "Re-record intake" on every classified relationship. Every
re-record from the UI returned 400 with a well-worded message and nowhere to
answer it. Both are fixed in `50f67739` / `2a363084`.

### Deployed-staging browser proof

`scripts/validation/wa2-decision-transparency-staging-journey.mjs`, against
**deployed staging at `2afbf524`**, 30s pacing.

| Run | Result |
|---|---|
| Chromium | **31 / 31 PASS, 0 FAIL** |
| WebKit | **31 / 31 PASS, 0 FAIL** (final run; zero failed requests logged) |

Assertions, in order: the engagement page offers "Why this rating?" · the
weighted factors render · the tier is explained as the joint function it is ·
the basis envelope's own `method` + methodology stamp render · the page says
ratings are corrected through facts and never edited · independent assurance
coverage is shown · with nothing excluded, the composition claims no exclusions ·
**a low-tier fixture genuinely excludes (79), so the arm is not vacuous** ·
excluded requirements are reported with the count · the count matches the
snapshot · the challenge surface exists · the form says up front that it removes
nothing · the Core Assurance floor is stated as a floor · no remove / suppress /
waive control exists · the engine's resolution sentence is shown verbatim · the
resolution describes what actually happens · **the floor holds — the composition
is byte-identical after a challenge** · the objection persists with SecureLogic's
determination beside it · contacts can be edited · the edit form is prefilled ·
correcting an address warns that history is not rewritten · the corrected
address is stored · the refusal names the invisible contact and offers to
reactivate · the refusal says the holder is inactive · reactivating restores the
person, not a duplicate · exactly one row holds that address · a re-intake asks
what changed · the form explains why · no client-side exceptions.

### The WebKit arm that took four fixes, and what it actually was

Worth recording in full, because for most of this validation WebKit sat at
**30 / 31** while Chromium was 31 / 31 on identical code, and the temptation to
call that "explained, therefore fine" was the main risk to this package.

Every WA-2 assertion passed in WebKit from the first completed run. The single
failure was the journey's blanket `no client-side exceptions` arm. Adding a
`requestfailed` listener and per-section markers resolved it to:

```
POST /vendor-engagements/<id>            :: Load request cancelled  [4-reload]
GET  /vendor-engagements/<id>?_rsc=…     :: Load request cancelled  [4-reload]
```

"Record disagreement" is a Next.js **server action**, and a server action
schedules a router revalidation *after* it resolves. `waitForLoadState(
"networkidle")` returns immediately at that point — the page genuinely is idle —
the revalidation starts a beat later, and the journey's own `page.reload()`
cancels it. **WebKit surfaces a cancelled fetch as a `pageerror`; Chromium logs
the identical abort and raises nothing.** Chromium's diagnostic log for its
passing run carries ~50 `net::ERR_ABORTED` RSC prefetches across every section.

Three settles were applied in sequence, each narrowing it — before leaving the
low-tier engagement page, before the reload, and finally allowing the
post-action revalidation to start before reloading (4 cancellations → 2 → **0**).
The last one closed it: **WebKit 31 / 31, zero failed requests**.

Two things this cost, both worth remembering:

- **A misread.** The first fix targeted the wrong navigation, because the
  section marker had not advanced past `3b-back-to-main` and the reload's
  cancellations were being stamped onto the section just "fixed". The markers
  were added precisely so attribution stopped being guesswork.
- **`page.url()` is not attribution.** It is read when the error *surfaces*,
  which for a navigation-cancelled fetch is already the destination page. Only
  the `requestfailed` log names the request that actually died.

**No assertion was weakened at any point.** The `no client-side exceptions` arm
is byte-for-byte what it was; only the harness's navigation timing changed.
Filtering the cancellation class out of it would have produced a green run four
fixes earlier and was deliberately not done.

### Two environmental constraints that cost most of the validation time

Recorded because they will recur and are not obvious:

- **The engine's login limiter is 10 per 900s per IP** (`ratelimit-policy:
  10;w=900` on `/api/auth/login`). Each journey run spends two logins, so at
  most five runs fit in any 15-minute window, and ad-hoc diagnostic scripts
  compete for the same budget. Three WebKit attempts failed at sign-in for this
  reason alone, each presenting as `page.waitForURL: Timeout 60000ms exceeded`
  — which looks nothing like a rate limit.
- **A WebKit launch needs real free memory, not "available" memory.** With
  618 MB free and 3.9 GB available (the rest page cache), the launch was killed
  four times. `sync; echo 3 > /proc/sys/vm/drop_caches` recovers it, but did not
  hold on this host.

### Negative control, and three harness defects it caught

The journey was dry-run against **pre-WA-2 staging** before the merge: **4 PASS
/ 7 FAIL**, the passes being setup, sign-in and no-client-exceptions. Every WA-2
assertion failed, which is what makes a green run afterwards evidence of the
change rather than of the harness.

Three harness defects were found and fixed — two before the merge, one during
this run. All three are recorded because each produced a *misleading* result:

1. **A failed assertion aborted the run**, hiding every assertion after the
   first miss. Guarded, with a single `finish()` exit.
2. **`/criticality v1\.0\.0/` was vacuous** — it passed against a pre-WA-2
   deployment because the VO-11 header has always printed exactly that.
   Tightened to `vendor_inherent_v2 v2.0.0`, which only the new panel renders.
3. **The exclusions arm was fixture-dependent** — it asserted the exclusions
   sentence on a tier_1 engagement whose snapshot reports
   `excluded_by_rules: 0`, so the UI was correct to render nothing. It failed
   for a fixture reason both before *and* after WA-2 and therefore never tested
   the feature. Replaced with two real arms: the tier_1 engagement must *agree*
   with its snapshot and claim no exclusions, and a deliberately low-tier
   engagement (`excluded_by_rules: 79`) must report them with a matching count.

A fourth crash — `page.getByPlaceholderText is not a function` — was a plain
harness error: that is the Testing Library name; Playwright's is
`getByPlaceholder`.

### Tenant and engagement isolation

Asserted against real rows:

- `applicabilityChallenge.test.ts` — org B reading org A's challenges gets
  **404**, and raising one against org A's engagement gets **404**;
  indistinguishable from an engagement that never existed. Org A still has
  exactly its own one.
- `vendorContacts.test.ts` (VA-C1) — cross-tenant `list`, `create`, `patch` and
  `remove` all **404**.
- The new table carries an `organization_id` and a `dataClassification.ts`
  entry, which the `dataClassification.test.ts` CI gate requires of every
  migration-created table.

## 4. Staging capacity change made to complete this validation

Recorded because it altered staging state. **Authorized by the owner, staging
only, and explicitly not a product fix.**

| | |
|---|---|
| Org | `[SEED] Walkthrough Org`, slug `seed-walkthrough`, `295b989a-89d6-49ec-a7ed-deb04489d068` |
| `max_monitored_entities` before → after | **50 → 75** (1 row, guarded `WHERE id=$1 AND slug='seed-walkthrough'`) |
| Mechanism | Render one-off job `job-dadoc7740ujc73cb9u5g` on the staging engine service; the script aborts without writing if the slug does not match |
| Time | 2026-09-05T03:02:14.922Z |
| Observed count at the cap | 49 vendors (24 `active` + 25 `archived`) + 1 AI system = **50** |

Repeated validation journeys each create a vendor, which is what reached the
cap. This is fixture capacity only and resolves nothing.

## 5. Remaining known gaps

Carried forward, not regressions:

- **Monitored-entity cap — [#1009](https://github.com/securelogic-ai-core/securelogic-engine/issues/1009), filed by this validation.**
  `enforceEntityLimit` counts archived entities, and the 409 tells the customer
  to "Delete one" when there is deliberately no hard-delete route. Archiving —
  the product's own customer-reachable action — reclaims nothing. Pre-existing,
  not a WA-2 regression, and not fixed here. Whether archived entities should
  count is a commercial decision, so no fix was designed.
- **`POST /api/vendor-engagements/undefined/scope` answers 500**, not 400/404,
  on a malformed id. Observed while probing; pre-existing input-validation nit,
  outside WA-2.
- **WA-3** — vendor-facing language, rule ids out of the portal, the
  second-person misdirection, and the US-English editorial pass, remain unbuilt.
- **Multi-participant portal identity (VA-P1)** still does not exist.
- The re-intake reason is enforced at the engine and mirrored in the form at ten
  characters. It is a *reason*, not a structured change record; ruling R8's
  provenance envelope for a recompose event is WA-3 work.

## 6. Owner ruling R8, recorded

Received 2026-09-05, closing the open question this package raised. A re-intake
must never silently mutate the determination or composition basis of an
already-issued engagement: **completed** engagements keep an immutable
historical basis and a new intake applies prospectively; **draft / not-issued**
engagements may be explicitly recomposed with provenance preserved;
**issued / in-progress** engagements must surface that a newer determination
exists and require an explicit analyst disposition. Vendor responses and
evidence are never silently discarded. Floors remain in force.

**No material conflict with the current architecture, verified in code.** The
prohibitions already hold — an engagement composes from its own copied fact
columns, `SCOPE_MUTABLE_STATES` (`draft`, `scoping`, `scoped`) gates every
recompose path, and that set is **disjoint** from `PORTAL_WRITABLE_STATES`
(`issued`, `in_progress`), so a recompose cannot occur in any state where vendor
responses can exist. What the ruling adds is affordances, not corrections; they
are recorded against WA-3 in `BUILD_SEQUENCE.md`.
