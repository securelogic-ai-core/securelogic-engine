# Enterprise Grade v2 — Product Experience Report (Tier 1: Trust & Wiring)

Branch: `feat/eg2-trust-wiring` (off `develop` @ `62f21e10` — the frozen Release Candidate is untouched).
Program record: six-persona experience audit, 2026-07-30. Every slice below answers the four
gate questions (frustration removed / capability improved / competitive win / measurable) before
it was built. No commits without operator authorization.

---

## Slice 1 — Real-time alerting for the automated signal→finding path

**Status:** implemented, tests green (engine 77/77 targeted, worker 151/151).

**Customer problem solved.** The platform's core differentiator event — "an external signal
matched YOUR vendor/AI system and created a Critical/High finding" — happened **silently** on
the API-ingest and briefScheduler paths. The matcher inserted the finding row and nobody was
told; customers discovered critical exposure whenever they next visited /findings, or in next
week's brief. The worker fan-out paths (hourly pipeline, 15-minute KEV poll) already had a
flag-gated coalescing alert batcher (`SECURELOGIC_MATCHER_ALERTS_ENABLED`, dark); the
processSignal path had nothing.

**What was built.** `processSignal` now runs the SAME coalescing batcher seam
(`createAlertBatcher("critical_finding", "signal_processing")`) after its transaction commits —
a batch-of-one, exactly mirroring the webhook emitter at that seam. Reuses the existing
recipient selection, per-user alert preferences, suppression list, per-(user, finding) ledger
idempotency, and the deep-linking alert email. A new `MatcherResult.finding_was_created` field
distinguishes a genuinely new finding from the D-14 re-fire reuse, so a reprocessed signal can
never re-notify. No new flag, no schema change, no behavior change while
`SECURELOGIC_MATCHER_ALERTS_ENABLED` is off (the current state everywhere).

**Deliberately NOT built:** a second alert path. The first implementation attempt fired the
per-finding immediate trigger unconditionally; review against the existing architecture showed
it would storm (per-finding emails on high-volume fan-out) and double-alert when the dark
batcher flag flips on. It was replaced with the shared-seam design above.

**Enterprise capability improved.** Proactive alerting: Basic → the machinery for Competitive
(one coherent, volume-policied alert pipeline across all three matcher invocation paths;
activation is a single existing flag + staging volume check).

**Competitive improvement.** Directly answers the SecurityScorecard/RecordedFuture-style
"event-driven vendor alert" gap; ServiceNow/Archer notification chains have no counterpart for
external-signal-driven findings.

**Screens/workflows affected.** No UI change. Workflow: signal ingest (API), daily
briefScheduler pipeline. Email: the existing Critical/High finding alert (deep-links to the
finding).

**Measurable.** `alert_sent` / `critical_finding_batch` ledger rows and the
`signal_processing_alert_flush_failed` warn counter; before = zero alerts from these paths,
after (flag on) = one coalesced email per org per ingest cycle.

**Files.** `src/api/lib/cyberSignalProcessingService.ts` (+`finding_was_created` on
`MatcherResult`, post-commit `alertOnCreatedSignalFinding`),
`src/api/__tests__/cyberSignalProcessingService.test.ts` (5 new wiring tests),
`src/api/tests/webhookWave1.test.ts` (factory field).

**Operator follow-up (ledgered, not executed):** declare `SECURELOGIC_MATCHER_ALERTS_ENABLED`
in `render.yaml` (staging first), run the staging volume check the flag's design comment
requires, then decide production enablement.

---

## Slice 2 — Fresh-org truthfulness: "nothing measured yet" is not "all clear"

**Status:** implemented, tests green (app 68/68 across both render suites, incl. 4 new).

**Customer problem solved.** A brand-new org with zero assessments was greeted with green
reassurance: "You're clear — nothing assigned to you", "No Critical or High active findings"
(The Briefing), and "All clear — no decision work is due" (Operations Workspace). A risk
analyst who later realizes "clear" meant "empty" stops trusting every number on the platform —
the highest trust-damage-per-line defect in the audit.

**What was built.** The D-2 `hasPlatformData` signal (already computed on /dashboard, used
only by the onboarding banner) now also gates the Briefing's zero-count module copy; the
Operations Workspace gained a `hasAnyFindings` signal derived from the findings summary
(`active_total`/`closed_count` — zero of both = no finding has ever existed). Fresh orgs see
neutral "Nothing assessed yet / Nothing assigned to you yet" states with a **Start setup →**
link into /getting-started; orgs with real history keep the earned green all-clear. Unknown
summary (older engine) preserves legacy rendering — never guesses.

**Screens affected.** The Briefing (/dashboard, flag-on): My Work + Needs Attention modules.
Operations Workspace (/findings, flag-on): the all-clear panel.

**Competitive improvement.** Archer/ServiceNow don't confuse empty with attested either; this
removes the one place SecureLogic did. Honesty engineering is the platform's differentiator —
this closes its most visible violation.

**Measurable.** Render-tested: green all-clear strings are unreachable when
`hasPlatformData === false` / `hasAnyFindings === false`; the earned all-clear is pinned for
orgs with history.

**Files.** `app/src/app/dashboard/briefing/TheBriefing.tsx`, `app/src/app/dashboard/page.tsx`,
`app/src/app/findings/WorkFirstFindings.tsx`, `app/src/app/findings/page.tsx`, + 4 tests in
`briefing.render.test.tsx` / `opsCenter.render.test.tsx`.

---

## Slice 3 — Vendor risk score that reacts to remediation + no auto-finding on clean reviews

**Status:** implemented, tests green (unit 7/7 new module tests; route suites 129/129;
real-Postgres isolation lane 9/9 incl. 1 new).

**Customer problems solved (two trust traps from the TPRM walkthrough).**
1. *Stale scores:* closing findings from /findings never recomputed
   `vendors.current_risk_score` — remediate everything and the vendor still looked risky until
   someone clicked "Recalculate". A risk number that ignores remediation is a number a TPRM
   director stops believing.
2. *The clean-review penalty:* EVERY vendor assessment minted an OPEN finding — a satisfactory
   annual review recorded as "Low" created a permanent work item and a score penalty. A clean
   review made the vendor look riskier.

**What was built.**
- New shared module `src/api/lib/vendorRiskScoreRecompute.ts` — the ONE recompute:
  the canonical ACTIVE-finding union over BOTH vendor workflows (assessments + review
  cycles), tenant-scoped, with fire-and-forget schedulers that respect the A04-G1 γ.3
  post-commit discipline. The manual Recalculate endpoint, the assessment-create path
  (which previously counted only one of the two workflows — silently), and the new hooks
  all converge on it: "Recalculate" can never disagree with the automatic refresh again.
- Hooks: PATCH /api/findings/:id (any lifecycle change) and all three action-cascade sites
  (create / status change / unblock — whenever the parent finding's derived status changed)
  now schedule a vendor score refresh. No-op for non-vendor findings.
- Threshold: a **Low**-severity assessment no longer creates the summary finding (the
  assessment row remains the complete record; reviewer-imported AI findings are still always
  created). Moderate+ behavior unchanged. ⚠ *Reviewable behavior change* — flagged for
  operator attention at review; trivially revertible (one conditional).

**Competitive improvement.** ProcessUnity/Prevalent scores react to state changes; ours now
does too, without a manual button. Removes the two behaviors most likely to make a TPRM
director distrust the numbers in a POC.

**Measurable.** `vendor_score_recompute_failed` warn counter; before/after: close all findings
for a vendor → score returns to criticality baseline on the next page load (95 for a low-
criticality vendor, unit-pinned).

**Files.** `src/api/lib/vendorRiskScoreRecompute.ts` (new), `src/api/routes/findings.ts`,
`src/api/routes/actions.ts` (3 cascade hooks), `src/api/routes/vendorAssessments.ts`,
`src/api/routes/vendors.ts`, tests: `vendorRiskScoreRecompute.test.ts` (new),
`test/isolation/vendorAssessmentsTenantWrap.test.ts` (+1).

---

## Slice 4 — Un-strand finished features: saved views, the brief archive, accept outcomes

**Status:** implemented, tests green (app queue/briefs/saved-view suites; engine validation suite).

**Customer problems solved (three verified dead ends).**
1. *Saved views shipped to no one.* `SavedViewsBar` rendered only in the legacy filter branch of
   /findings — unreachable when the queue-controls flag is on (the staging RC state) and dark in
   prod. An analyst's daily filter sets could not be saved anywhere.
2. *The brief archive listed the wrong artifact.* /briefs fetched the legacy newsletter table,
   whose generation pipeline is off by default — paying readers could not browse the canonical
   Intelligence Brief history at all (the dashboard card only ever showed the latest one).
3. *Accept felt inert.* Accepting a matcher suggestion showed "Suggestion accepted" and the row
   vanished — no path to the entity the link landed on.

**Before → after.**
- Saved views: filter in the browse queue → no way to keep it | → "＋ Save this view" in the
  queue branch; the whitelist (engine + app, kept in lockstep) now covers the queue's own URL
  params (q/governance/operational/due/mine/has_action/has_evidence/created_from/created_to/
  sort); applying a view pins `queue=all` so it deterministically reopens the browse view.
- Archive: /briefs shows "No briefs published yet" to orgs with months of briefs | → canonical
  published briefs render as featured card + period grid, linking to the existing detail reader;
  legacy issues demote to a labeled "Legacy Issues" section so old links keep working.
- Accept: dead-end toast | → "Linked to Microsoft — View vendor →" beside Undo (navigation
  during the undo window commits, by the list's existing unmount semantics).

**Screens affected.** /findings (browse queue), /briefs, /queue toast.

**Estimated reduction in clicks/confusion.** Re-applying a daily triage filter: ~5 clicks → 1.
Reaching last month's brief: impossible → 2 clicks. Verifying an accept landed: ~3 clicks
(navigate to entity manually) → 1.

**Competitive improvement.** Saved views and a browsable report archive are table stakes in
Archer/ServiceNow/AuditBoard; these close two "feels unfinished" gaps an evaluator hits in the
first hour, and the accept-outcome link makes triage feel connected rather than write-only.

**Remaining opportunities discovered.** Legacy saved views carrying `status`/`source_type`/
`priority` applied while the queue flag is on still silently drop those three filters (the
queue's server params don't support them — pre-existing; needs a queue-param extension).
The accept outcome link could additionally point at the auto-created finding when one exists
(needs the accept response to return it).

**Files.** Engine: `findingSavedViewValidation.ts` (+ its test). App: `savedViews.ts`,
`findings/page.tsx`, `lib/api.ts` (`getIntelligenceBriefs`), `briefs/page.tsx`,
`hooks/useTimedNotice.ts`, `components/queue/Notice.tsx`, `components/queue/SuggestionList.tsx`,
tests: `savedViews.test.ts` (+3), `brief.render.test.tsx` (+2), `notice.render.test.tsx` (new).

---

## Slice 5 — Dead-end elimination: vendor findings, graph reach, dependency writes, onboarding re-entry

**Status:** implemented, tests green (app ai-systems 39/39, vendors + getting-started suites green).

**Customer problems solved (four verified dead ends).**
1. Vendor-page finding cards were static divs — the only findings in the app you could see but
   not open (the AI-system page's cards always linked).
2. The enterprise graph could answer "what depends on this vendor" but was reachable only from
   the Assets row — never from the vendor page a TPRM analyst lives on.
3. **AI-system vendor dependencies had no write UI anywhere.** The vendor page said
   "Dependencies are declared on an AI system's detail page" while that page only rendered
   them; the engine POST/DELETE existed unused. The entire concentration-risk chain (reverse
   dependency card, graph edge, future matcher cascade) depended on data customers could not
   create.
4. "Skip setup" permanently redirected users away from /getting-started, and the user-menu
   entry `SECONDARY_NAV_ITEMS` declared was never rendered — onboarding was one-shot and
   irrecoverable.

**Before → after.**
- Vendor findings: read-only cards | → cards link to `/findings/{id}` (the finding's workflow).
- Graph: unreachable from /vendors/[id] | → sidebar "View relationships in the enterprise
  graph →" (same ECL flag gate as the asset page's link).
- Dependencies: API-only | → add (vendor picker + canonical 9-role vocabulary) and remove on
  the AI-system card, viewer-role-aware, engine-validated, revalidating both sides of the edge.
- Onboarding: dismissed = gone forever | → "Getting Started" in the user menu; the checklist
  renders live completion for finished orgs (a record, not a nag).

**Screens affected.** /vendors/[id], /ai-systems/[id], user menu (all pages), /getting-started.

**Estimated reduction in clicks/confusion.** Vendor finding → its workflow: impossible from
that card → 1 click. Declaring a dependency: impossible → 3 interactions. Onboarding re-entry:
impossible → 2 clicks.

**Competitive improvement.** Kills the "click it and nothing happens" moments an evaluator
remembers; the dependency write path makes the AI-supply-chain story demonstrable live rather
than by API scripting — a claim none of Archer/ServiceNow/OneTrust can demo natively.

**Remaining opportunities discovered.** The dependency form lists the first 100 active vendors
(no typeahead — fine at demo scale, needs search past ~100). Vendor-page "Live Intelligence"
rows are still unlinked LLM output (slice-6+ territory).

**Files.** `vendors/[id]/page.tsx`, `ai-systems/[id]/page.tsx`,
`ai-systems/[id]/dependencyActions.ts` (new), `ai-systems/[id]/VendorDependencyManager.tsx`
(new), `components/UserMenu.tsx`, `getting-started/page.tsx`, tests:
`vendorDependencyManager.test.tsx` (new, 5), `getting-started/page.render.test.tsx` (contract
updated).

---

## Slice 6 — Render the personalization the engine already computes; route the email into the product

**Status:** implemented, tests green (engine renderer 68/68 incl. 3 new; app briefs + component suites 34/34 incl. 8 new).

**Customer problem solved.** The engine has matched every brief item against the org's own
vendors, AI systems, open risks, and obligations at generation time since migration 20260511 —
and never showed anyone. The customer-facing GET omitted `is_personalized`/`platform_context`,
the web reader rendered `affected_vendor` as plain text, and the flagship brief email
contained exactly three links: the logo, the upgrade CTA, and unsubscribe. The product's core
claim — "intelligence connected to YOUR context" — was computed, stored, and invisible.

**Before → after.**
- Engine GET: personalization fields absent | → `is_personalized` + `platform_context`
  returned per item (additive; older items return false/null).
- Brief item cards: generic | → "Affects your vendor: Acme Cloud → (+2 more in your
  inventory)" strip linking to the tenant's record.
- Item detail: generic | → "Why this reached you — matches in your environment" callout
  listing every matched vendor/AI system/risk/obligation as a link; the Source panel's vendor
  name links to the matched vendor record.
- Email: zero product links | → "Open this brief in SecureLogic →" button (HTML + plain-text),
  environment-correct base URL, rendered only when the sender passes `brief_id` (older callers
  byte-identical). Per-item email links deliberately deferred: the email's category grouping
  reorders items, so index-based item URLs could mislink — noted as a follow-up requiring
  stable item ids in email data.

**Screens/workflows affected.** GET /api/intelligence-briefs/:id, brief reader cards, brief
item detail, the weekly brief email (HTML + text).

**Estimated impact.** The "does this affect us?" question — previously answered by manually
cross-referencing vendor names against the inventory — becomes zero clicks (stated on the
item) with a 1-click path to the affected record. Email→product re-engagement gets its first
functioning route.

**Competitive improvement.** This is the demonstrable version of the vision claim no
incumbent makes: Archer/ServiceNow/OneTrust have no external-intelligence-to-your-inventory
matching at all; RecordedFuture-class tools match but don't run your GRC workflow. One screen
now shows both.

**Remaining opportunities discovered.** Personalization matches only render for items
generated after the columns ship in responses (historical items carry the data — nothing to
backfill). The vendor "Live Intelligence" LLM section still isn't deterministic (assessment
audit item, M). Per-item email deep links need stable item identity in `EmailBriefItem`.

**Files.** Engine: `routes/intelligenceBriefs.ts` (SELECT + response),
`lib/briefEmailRenderer.ts` (`brief_id`, Open-in-SecureLogic HTML/text),
`lib/briefEmailSender.ts` (passes brief_id), `__tests__/briefEmailRenderer.test.ts` (+3).
App: `lib/api.ts` (item type), `components/BriefItemPlatformContext.tsx` (new),
`components/IntelligenceBriefSignalCard.tsx`, `briefs/[id]/signal/item/[index]/page.tsx`,
`components/__tests__/briefItemPlatformContext.test.tsx` (new, 8).

---

# Tier 1 Closeout — Scores, Matrix, Competitive Delta (2026-07-30)

Six slices, six commits (`70cb47d6..35021a88`), 40 new/extended tests. Full suites green:
engine 410 files / 6,769 tests; app 96 files / 1,222 tests; isolation lane green; typecheck +
lint clean. Branch `feat/eg2-trust-wiring` — NOT merged; independent review required before any
merge, per operator ruling. One deliberate behavior change flagged for that review: Low-severity
vendor assessments no longer mint a summary finding (slice 3).

## Product Experience Score (baseline 2026-07-30 audit → after Tier 1, flag-on experience)

| Dimension | Before | After | Why |
|---|---|---|---|
| User Experience | 48 (prod) / 65 (staging) | 52 / 71 | Dead ends eliminated on 6 daily-driver surfaces; honest zero states; saved views reachable |
| Enterprise Delight | 40 | 50 | Personalization visible ("affects YOUR vendor"), accept outcomes, live-demonstrable AI supply chain |
| Executive Experience | 55 | 57 | Brief archive browsable; email routes into the product (exec PDF/trends unchanged — Tier 2) |
| Enterprise Capability | 45 / 62 | 47 / 65 | Alerting seam completed, dependency write path, score reactivity |
| Trust (qualitative) | weakest area found | materially improved | Fresh-org truthfulness, scores that react to remediation, no clean-review penalty |

Scores stay honest: nothing here crosses 75 — the flag gap, notifications, and collaboration
still dominate the distance to "stands beside the best."

## Capability movements (matrix rows that changed)

| Capability | Before | After |
|---|---|---|
| Proactive alerting | Basic (paths silent) | Basic+ → machinery Competitive (one flag from live on all 3 matcher paths) |
| Continuous vendor monitoring | Basic (stale scores, manual recalc) | Basic+ (scores react to every lifecycle path) |
| Nth-party / concentration risk | Basic, UI nearly Missing | Basic+ (write path exists; graph reachable from vendor) |
| Findings ops (saved views) | shipped-to-no-one | Competitive-supporting (queue-native saved views) |
| Signal-to-context linkage UX | Basic (computed, invisible) | Competitive (rendered, linked, in email) |
| Brief archive continuity | Missing (wrong artifact) | Competitive |
| Onboarding | Basic (one-shot, irrecoverable) | Basic+ (re-enterable, truthful states) |

Unchanged (Tier 2+ targets): Approvals (still flag-dark in prod), Notifications (assignment/SLA
still unwired), Collaboration (Missing), Bulk ops, Evidence UX, Crosswalks, Exec trends/PDF.

## Competitive delta

- **vs Archer / ServiceNow GRC:** closed the first-hour credibility gaps (dead ends, untruthful
  zeros, unsaveable views). Still behind on notifications/escalation, collaboration, ITSM sync,
  configurable workflow. Ahead on: metric honesty, external-intel→inventory matching (they have
  none), two-axis lifecycle design (staging).
- **vs OneTrust / AuditBoard:** unchanged on crosswalks/content depth (their moat). Ahead on
  intelligence connectivity, now visibly so.
- **vs ProcessUnity / Prevalent:** removed the two POC-killing score behaviors; dependency
  graph + SOC extraction remain differentiators; questionnaire campaigns/portal remain the
  replacement blocker.

## Highest-value remaining UX improvements before private beta

1. **Operator: promote the flag train** (workspace/decision/acceptance/queue-controls/Briefing
   + declare the orphan flags, incl. `SECURELOGIC_MATCHER_ALERTS_ENABLED` staging volume check).
   Everything above is invisible-in-prod until this. Zero build.
2. **Workflow notifications (M):** assignment + SLA-breach + approval-pending emails on the
   existing sender/preference plumbing. "My Work is a queue nobody knows to check."
3. **Evidence UX completion (M):** file inputs on control/obligation/AI evidence forms (engine
   ready), an /evidence page on the existing summary endpoint, `valid_until` staleness.
4. **Deterministic vendor intelligence (M):** replace the per-pageload LLM section with the
   accepted `vendor_signal_links` (dates, severity, drill-through), demote the LLM to assess.
5. **QoQ posture trends + exec PDF narrative/branding (M):** lift the 180-day cap, chart the
   series the API already returns, one-page narrative + tenant logo on the board PDF.
6. **Auditor trail access (S–M):** full history in the Decision Workspace, a read-only
   auditor path to /audit-log, `promoted_risk_id` provenance rendering.

## Recommended next workstream

**Tier 2 "Operational Presence": notifications + evidence UX + deterministic vendor
intelligence (items 2–4).** Rationale: after trust and wiring, the loudest walkthrough theme
was *silence* — work assigned that no one hears about, evidence engines without doors, and
intelligence claims backed by nondeterministic prose. All three reuse existing engine
machinery (senders, upload lane, link tables), none needs a schema or ADR change, and each is
independently demonstrable to a Fortune 500 CISO. The flag-train promotion (item 1) is
operator-owned and can run in parallel.
