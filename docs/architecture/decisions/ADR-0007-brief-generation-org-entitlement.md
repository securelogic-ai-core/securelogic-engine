# ADR-0007 — Intelligence Brief generation is an organizational entitlement; subscriber records are delivery-only

- **Status:** RATIFIED (2026-07-31). Operator ruling delivered in-session as the
  "Ratified Product Model" for the brief-eligibility architecture correction.
- **Date:** 2026-07-31
- **Source:** Investigation of the empty-`intelligence_brief_subscribers` /
  stale-brief incident (2026-07-31): the weekly scheduler enumerated its org
  population from `SELECT DISTINCT organization_id FROM intelligence_brief_subscribers
  WHERE active = TRUE`, so an active platform customer with zero email-recipient
  rows silently received no brief at all — a coupling contradicting both
  TENANT_ISOLATION_STANDARD §6 (fan-out enumerates active orgs) and the
  ungated-read contract in `intelligenceBriefs.ts` ("free orgs see the briefs
  the platform produces for them").

---

## The ratified model (permanent architectural rule)

1. Every ACTIVE platform organization is entitled to Intelligence Briefs.
2. Brief **generation** is an organizational entitlement, derived from
   `organizations.status = 'active'` — the platform's canonical fan-out
   predicate, computed in exactly one place: `src/api/lib/briefEligibility.ts`
   (`listBriefEligibleOrgIds`).
3. **Email delivery** is a separate capability. `intelligence_brief_subscribers`
   rows exist ONLY to determine who receives email copies (and with what
   per-recipient preferences). They are opt-in recipient records — never an
   eligibility gate, and never manufactured to satisfy the pipeline.
4. An organization with zero active recipients still gets its brief generated
   and published in-platform; the email leg is skipped, the skip reason is
   recorded (`emails_skipped_no_recipients`, `orgs_without_recipients` in the
   scheduler run summary), and delivery health reports it as a **warning**.
5. Zero briefs generated while active organizations exist is an **error**
   (operational failure), alerted via the operator webhook
   (`briefDeliveryHealth`, reasons `no_briefs_generated` /
   `all_generation_failed`).

## Consequences

- `briefScheduler.runScheduler()` Step 1 enumerates via
  `listBriefEligibleOrgIds()`; the scheduler contains no subscriber-table SQL
  (contract-tested in `briefGenerationEligibility.test.ts`).
- `briefCatchup` detects "did this week's run happen?" from the newest
  **published brief** (`intelligence_briefs.generated_at`), not from
  `intelligence_brief_sends` — a legitimate zero-recipient week records no
  sends, and send-based detection would regenerate duplicate briefs on every
  Tuesday boot. Missed/failed *delivery* is the delivery-health alert's job.
- A daily outcome-based sweep (`briefStalenessMonitor`, 08:30 UTC) alerts when
  any active org's newest published brief is missing or older than 8 days
  (mirrors the app's `STALE_AFTER_DAYS`) — catching the cron-never-fired case
  no per-run health check can see. New orgs younger than the threshold are
  excluded (no false alarms).
- No recipient backfill is performed. Subscriber rows are consent-bearing
  recipient records (the privacy policy classifies them as marketing subscriber
  information); manufacturing rows would fabricate opt-ins the corrected
  architecture no longer needs. Orgs without recipients surface weekly in the
  delivery-coverage warning for deliberate operator/customer action.
- Free-wedge signups continue to land under the sentinel `BRIEF_ORG_ID`
  organization, which is enumerated like any other active org.
- Existing recipient provisioning (signup auto-enroll, Stripe paid-upgrade
  auto-subscribe, tenant subscriber API) is unchanged — it now affects email
  coverage only, never generation.

## Explicit confirmation

An active platform organization can never again lose Intelligence Brief
generation solely because no `intelligence_brief_subscribers` records exist.
