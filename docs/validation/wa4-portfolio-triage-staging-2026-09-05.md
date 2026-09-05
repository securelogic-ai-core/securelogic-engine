# WA-4 — Portfolio Triage: deployed-staging validation record

**Result: PASS.** Chromium **63/63**, WebKit **63/63**, both against the same
deployed staging build. WebKit passed first try — the second WA package where it
did.

| | |
|---|---|
| PR | **#1016** `feat/wa4-portfolio-triage` → `develop` |
| Final PR head SHA | **`5edcee4bdf9391f3b30cf6be21da3e3d613ea4dc`** |
| Merge SHA | **`c4519e79577a8564567b2bf5004b4e199a45b8e4`** |
| Resulting `develop` | **`c4519e79`** (parents `7fb69f00`, `5edcee4b`) |
| `securelogic-engine-staging` | live **`c4519e79`** at 2026-09-05T21:11:45Z |
| `securelogic-app-staging` | live **`c4519e79`** at 2026-09-05T21:13:48Z |
| Migration | **`20261093_vendor_engagement_dispositions`** + `docs/release/ROLLBACK-20261093.sql` |
| Validated | 2026-09-05, 21:24Z (Chromium) and 21:26Z (WebKit) |

`develop` had moved between PR creation and merge — **#1015 (IA-1 determination
+ staging fixture cleanup)** landed at 17:52:50Z. GitHub merged onto that head,
`mergeable_state: clean`, no conflict. Both browsers validated the same SHA and
neither staging service redeployed during the runs.

## Pre-merge gate

CI **8/8 green at the exact head `5edcee4b`** — `audit`, `build`,
`cross-org-isolation`, `lint`, `tenant-coverage`, `test`, `typecheck`,
`url-drift`. `mergeable: true`, `mergeable_state: clean`. Re-verified
immediately before the merge, not taken from the PR-creation snapshot.
Migration `20261093` is sequential after `20261092`, ships a rollback, and was
re-read at the gate: RLS enabled with a tenant-isolation policy, an INSERT
trigger re-checking refs, the shared `worm_guard_mutation` on row and statement,
`app_request` granted **SELECT, INSERT only**, `disposed_by_user_id` NOT NULL
with ON DELETE RESTRICT.

## What was proven, by owner gate

**Needs Attention is derived (gate 5).** The mixed engagement derives
`control_not_in_place, partial_response` inside the attention window and appears
in the queue; the analyst reads *why* on the row itself in plain English —
"Control reported not in place", "Control only partially in place" — and again
in a full sentence on the detail panel, which says on the screen that the state
is derived and that nothing there creates a finding.

**The false-positive direction (gate 5), newly proven.** A second engagement was
built on the same template, in the same window, with every answer an explained
`pass`. It derives **zero reasons**, `needs_attention=false`, digest `none`, is
**absent** from the needs-attention list and from the needs-attention screen, and
**is** present in the unfiltered portfolio sorted newest-first. Unflagged on its
merits, not by exclusion.

**Human disposition (gate 6).** Recorded through the real UI; the rationale floor
is enforced client-side before the request leaves; the confirmation survives the
server action's own revalidation; the decision and its reason survive a full
reload. A second decision is **added, not substituted** — the trail reads
newest-first, both intact, each naming its author, each carrying a parseable
server timestamp from this run, each recording the `attention_digest` it was
decided against. After two decisions the derivation is **byte-identical** — same
reasons, same digest — so triage did not rewrite the vendor's responses or
evidence.

**No automatic Finding (gate 7).** A failed control, a partial control and
**four** recorded dispositions — including `finding_proposed` **and**
`finding_confirmed` — produced **zero** findings. Proven three ways: the engine
states `created_finding: false` in its own response body for both; a
source-scoped query returns none; a query across **any** source type pointing at
the engagement returns none. `finding_proposed` and `finding_confirmed` persist
as **two distinct rows**, one each — proposed is not silently confirmed.

**Portfolio navigation (gate 8).** The Needs-attention filter is a query
parameter, so the view is linkable. Choosing a sort **preserves** the filter and
puts the sort in the URL. The same query twice returns the same order. Five
crafted sort keys — including `e.id; DROP TABLE vendor_engagement_dispositions; --`
and a correlated subquery selecting `password_hash` — were **all neutralised**:
four reached the app and fell back to the default order with the server echoing
`sort=risk`, and one never reached the app at all because Cloudflare answered it
with an edge block. A crafted `order` direction fell back too. The
application-level fallback is proven on four payloads, so the edge is not
carrying this proof.

**Tenant isolation (gate 9).** An engagement the org does not own answers
**404**, never 403 — a 403 would confirm it exists. The attention route answers
**401** to an unauthenticated caller. No authorization or rate limit was
weakened to obtain a green run; pacing was left at the harness default.

**Client health.** Zero client-side exceptions in either browser. Zero aborted
POSTs — every mutation and revalidation ran to completion, the specific defect
WA-3 found. Chromium logged 59 navigation-cancelled prefetch GETs, WebKit zero;
a superseded prefetch is not a failed mutation and the harness distinguishes them
by method.

## Fixture ceiling (gate 4)

| | |
|---|---|
| Monitored entities before | **12 / 75** (11 vendors + 1 AI system) |
| Harness vendor | **ADOPTED** — an existing `WA4 journey harness` vendor was reused |
| New entity required | **No** |
| Monitored entities after (3 runs) | **12 / 75** |
| `entity_limit_reached` | **Never occurred** |

The cap was not raised, bypassed or weakened, and nothing was deleted to make the
run fit. Each run takes fresh *relationships* on the one adopted vendor, which
carry no cap, so per-engagement isolation holds without metering cost. The org
had already been cleared 75 → 26 by the #1015 cleanup; it now reads 12 after that
cleanup's own follow-through. **FIXTURE-LIFECYCLE-1 remains open** — adopt-don't-
create makes this journey sustainable, it does not close the class.

## Defects found, and what they were

Every WA package has found browser-only defects. WA-4 found **three, all in the
harness, none in the product** — and the first run proved the journey committed in
#1016 had never been executed.

1. **The intake fixture invented three enum values.** `lt_1_week`,
   `important` and `small` are not in `MTD_LEVELS`,
   `CRITICALITY_DEPENDENCY_LEVELS` or `DATA_VOLUME_BANDS`. The intake refused
   them as `invalid` — correctly — and the journey aborted before a browser
   opened. Fixed against the real level tables. **The product behaved properly;
   the harness had guessed an enum instead of reading it.**

2. **The Ruling E scan measured the wrong thing.** It regex-scanned
   `page.content()` for rule-identifier shapes and failed on `S2` — which turned
   out to be inside `[VA-Q2-P4 ACCEPTANCE] S2 S2.subprocessors`, an engagement
   **title** typed by an August acceptance harness against vendor "Microsoft".
   22 such hits exist across 93 engagements. Ruling E constrains WA-4's own
   vocabulary, not the content of records someone else wrote. Rescoped to the
   attention chips and the derived row, with the regex left strict — and it now
   passes in that stricter, correctly-aimed form.

3. **A reachability assertion asked for a page size the product does not take.**
   `?limit=200` proves nothing: the list renders a fixed `PAGE_SIZE` with real
   Previous/Next links and correctly ignores a caller-supplied limit, so the
   clean low-risk engagement was simply below the first page by risk. Replaced
   with a newest-first sort, which also exercises a second whitelisted sort
   through the UI.

Classification, in the vocabulary the owner gate asks for: (1) journey/harness
defect, (2) fixture contamination, (3) journey/harness defect. **No product
defect, no browser-specific defect, no stale or mixed deployment, no rate
limiting, no OOM.** No assertion was weakened to reach green — each of the three
was replaced with a stricter or better-aimed one, and the run count rose from 61
to 63.

## What this does NOT establish

- **WA-4 PASS does not authorize production activation.** Vendor Assurance
  remains inactive in production; no production configuration, migration or
  Blueprint sync was touched by this work.
- **IA-1 is not fixed** and was deliberately not fixed here. Its read-only
  determination landed separately in #1015 and recommends **P2, not a blocker**.
- **Ruling 4 remains held**: the `S4.assurance` em-dash frozen by the 1.0.0
  golden and the 146 `frameworkTemplates.ts` occurrences inside
  evidence-sufficiency language were not touched.
- **FIXTURE-LIFECYCLE-1 remains open.**

## Reproduction

    APP_URL=https://securelogic-app-staging.onrender.com \
    ENGINE_URL=https://securelogic-engine-staging.onrender.com \
    E2E_EMAIL=walkthrough-analyst@seed.securelogicai.test E2E_PASSWORD=… \
    node scripts/validation/wa4-portfolio-triage-staging-journey.mjs chromium

Playwright **1.63.0** is the version whose pinned browser revisions
(`chromium-1243`, `webkit-2359`) match this machine's cache; installing any other
version downloads browsers unnecessarily. Install it outside the repo — the
project does not depend on Playwright.

Ledgers, screenshots and the failed-request logs for all three runs were captured
per run under `${OUT_DIR}`.
