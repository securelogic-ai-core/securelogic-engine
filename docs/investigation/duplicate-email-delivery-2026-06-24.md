# Duplicate customer email delivery — investigation & remediation (2026-06-24)

## Summary

The platform had **two independent daily customer-email senders** running in
production, an hour apart, from two different pipelines, two different signal
tables, and two different subscriber lists. A paying customer is enrolled in
**both** lists by the Stripe webhook, so the system could send the same person
two daily emails.

Remediation: the **legacy worker Newsletter** send path is now gated behind an
OFF-by-default feature flag (`SECURELOGIC_LEGACY_NEWSLETTER_ENABLED`). With the
flag unset — the default and the intended prod/staging state — the worker
performs no newsletter generation, promotion, delivery-queueing, or send. The
**Intelligence Brief** is left as the sole daily customer-email path. The change
is isolated to the intelligence-worker; the Brief pipeline is untouched.

## Root cause

Two parallel "daily digest" products were built at different times and never
reconciled:

| | Intelligence Brief (KEEP) | Legacy Newsletter (DISABLED) |
|---|---|---|
| Producer | `src/api/lib/briefScheduler.ts` → `sendBrief()` (`src/api/lib/briefEmailSender.ts`) | `services/intelligence-worker/src/pipeline/runPipeline.ts` → `sendNewsletter()` (`.../delivery/sendNewsletter.ts`) |
| Runs in | `securelogic-engine` web service | `securelogic-intelligence-worker` service |
| Schedule | node-cron, **07:00 UTC** daily (`schedulerRunner.ts`) | hourly loop gated to `BRIEF_SEND_HOUR = 8` → **08:00 UTC** daily (`runPipeline.ts`) |
| Signals FROM | `cyber_signals` | `signals` (worker legacy table) |
| Recipients FROM | `intelligence_brief_subscribers` | `subscribers` |
| Transport | Resend (`api.resend.com/emails`) | Resend (`resend.emails.send`) |

The duplication becomes a *customer-visible* defect because both subscriber
lists are populated for the same person:

- `src/api/webhooks/stripeWebhook.ts:426` → `INSERT INTO intelligence_brief_subscribers` (Brief list)
- `src/api/webhooks/stripeWebhook.ts:540` → `INSERT INTO subscribers (... tier='paid', status='active' ...)` (Newsletter list)

So a paying customer lands in both lists on the same Stripe subscription event
and is eligible for both daily emails.

## All production email send paths (audit)

Scheduled **daily customer-content** senders (the duplicate pair):
1. Intelligence Brief — `briefEmailSender.ts` via `briefScheduler` cron (07:00 UTC). **KEEP.**
2. Legacy Newsletter — `sendNewsletter.ts` via `runPipeline` (08:00 UTC). **DISABLED (this change).**

Other **scheduled, customer-facing** senders — engine `alertEmailService.ts`, a
3-tier per-user notification system registered as node-cron in
`schedulerRunner.ts` (discovered during production verification; NOT in scope of
this change — see risk #6):
3. **Daily Digest** — `SecureLogic AI — Daily Digest (N new findings)`, **08:00 UTC daily** (`digestScheduler.runDailyDigest`). Targets platform `users` (not `intelligence_brief_subscribers`), gated on `user_alert_preferences.daily_digest` (default TRUE), only when the org has findings in the last 24h. **This is the email that actually runs concurrently with the Brief.**
4. **Weekly Posture Summary** — Mondays 09:00 UTC.
5. **Per-finding alert** — `[severity] New finding: …`, event-triggered.

Event-triggered **transactional** senders (not duplicates, unchanged):
6. `src/api/routes/intelligenceBriefs.ts` `POST /intelligence-briefs/:id/send` — manual Brief send (entitlement-gated); reuses `sendBrief`.
7. `src/api/routes/accountRecovery.ts` — password-recovery email.
8. `src/api/routes/teamInvites.ts` — team-invite email.
9. `src/api/routes/customerAuth.ts` — auth/verification email (`Verify your SecureLogic AI account`).
10. `src/api/lib/exportReadyEmail.ts` — already OFF by default (`SECURELOGIC_EXPORT_EMAIL_ENABLED`).

## Were duplicates actually occurring? — NO (production-verified)

**Verified against the production Resend account** (`securelogicai.com`,
status=verified) by listing the send log via `GET https://api.resend.com/emails`
(200 emails, spanning **2026-04-22 → 2026-06-24**). Findings:

**The legacy worker Newsletter and the Intelligence Brief never sent in the same
period** — the Brief *replaced* the Newsletter:

| Product | Sender / subject signature | Send window (verified) | Status |
|---|---|---|---|
| Legacy worker Newsletter | `intelligence@…` · `SecureLogic AI Intelligence Brief #N — <Weekday>, <Month> <Day>` | **Apr 22 – Apr 27, 2026** (issues #5–#10) | **dormant since Apr 27** |
| Intelligence Brief | `briefs@…` · `Intelligence Brief: <date range>` | **May 3, 2026 – ongoing** (daily) | live |

There is a ~6-day gap between the last Newsletter (Apr 27) and the first Brief
(May 3). They were never concurrent, so **no customer ever received both the
Brief and the legacy Newsletter.**

Additionally, **every recipient in the entire log is one of the founder's own
addresses** (`simmee.crystian@gmail.com`, `thecrystians@gmail.com`,
`the5crystians@gmail.com`). There are **no external customers yet**, so zero
customer-facing duplicate emails have occurred to date via any path.

**Conclusion:** the Newsletter was the v1 product (April), superseded by the
engine Brief in early May; the worker send *code* was left armed but the path
went dormant (no draft issues generated since). This change closes that latent
risk — it is defense-in-depth, not the remediation of an active incident.

## Evidence from production logs (Resend send log)

Distinct senders over the full window (Apr 22 – Jun 24):
- `SecureLogic AI <briefs@securelogicai.com>` — 80× `Intelligence Brief: <range>` (the Brief, daily)
- `intelligence@securelogicai.com` — 120×, comprising:
  - 50× `Verify your SecureLogic AI account` (transactional)
  - 37× `SecureLogic AI — Daily Digest (N new findings)` (engine Daily Digest — see risk #6)
  - 18× `SecureLogic AI — Weekly Posture Summary` (engine, weekly)
  - 12× `SecureLogic AI Intelligence Brief #5..#10 — <Weekday>, April …` (legacy Newsletter, Apr only)
  - 3× `Security Alert: …account temporarily locked` (auth anomaly)

Brief is confirmed **operational**: latest send `2026-06-24 07:02 UTC`.

## Fix — files changed

New:
- `src/api/lib/legacyNewsletterFeatureFlag.ts` — `legacyNewsletterEnabled(env)`; returns true only when `SECURELOGIC_LEGACY_NEWSLETTER_ENABLED === "true"`. OFF by default. Mirrors the existing `exportReadyEmail.ts` / `vendorFuzzyMatch.ts` flag convention.
- `src/api/__tests__/legacyNewsletterFeatureFlag.test.ts` — 5 unit tests (default-off, prod-off, exact `"true"` only, explicit-env).

Modified:
- `services/intelligence-worker/src/pipeline/runPipeline.ts` — daily send window now `if (currentHour === BRIEF_SEND_HOUR && !legacyNewsletterEnabled())` logs `legacy_newsletter_disabled` and does nothing; the existing generate→promote→queue→`sendNewsletter` block moved to the `else if (currentHour === BRIEF_SEND_HOUR)` (enabled) branch. Block was **wrapped, not deleted**, so re-enable is one env var and no imports go unused.
- `services/intelligence-worker/src/__tests__/runPipeline.test.ts` — 4 structural tests asserting the gate and that `sendNewsletter` lives only in the enabled branch.

Not changed: every Intelligence Brief file (`briefScheduler.ts`, `briefEmailSender.ts`, `intelligenceBriefGenerator.ts`, the `intelligence_brief_*` tables and routes). The Brief send path is untouched.

## Verification performed (local)

- `tsc -p services/intelligence-worker/tsconfig.json --noEmit` → pass
- `tsc -p tsconfig.json --noEmit` → pass
- `npm run lint` (CI gate, `src/**`) → pass
- `vitest run src/api/__tests__/legacyNewsletterFeatureFlag.test.ts` → 5/5
- `vitest run services/intelligence-worker` → 133/133 (pipeline file 29/29, +4 new)
- `vitest run src/api/__tests__/briefEmailSender.test.ts` → 19/19 (Brief send path still green)

## Remaining risks / follow-ups

1. **Deploy required.** The fix is inert until the `securelogic-intelligence-worker` (and `-staging`) service redeploys with this code. Until then the legacy path still runs at 08:00 UTC in prod.
2. **Production verification is operator-gated** (commands above). The "were duplicates actually sent" question is answered only by the worker logs / Resend / `newsletter_deliveries.status`.
3. **Stale `subscribers` list remains.** This change stops *sends*; it does not retire the `subscribers` table or the `stripeWebhook.ts:540` enrollment. If the legacy product is permanently dead, a follow-up should stop writing `subscribers` and decide retention/cleanup of `newsletter_issues` / `newsletter_deliveries`.
4. **Admin newsletter view goes quiet.** `src/api/routes/adminNewsletterIssues.ts` reads `newsletter_issues`; with the flag off no new issues are generated (existing rows remain). Correct for a disabled product; note it so it isn't mistaken for a bug.
5. **`render.yaml` is blank in the working tree** (846-line deletion present at session start, unrelated to this work). Do not commit it. To make the disable explicit in IaC, add `SECURELOGIC_LEGACY_NEWSLETTER_ENABLED: "false"` to both worker blocks once render.yaml is restored — but the code default already disables it without any env change.
6. **RESOLVED — single weekly customer email (owner decision, 2026-06-24).** After investigation, the owner set the policy: the Intelligence Brief is the **single weekly** customer email; the per-finding Daily Digest send is **off** (findings stay in-app, surfaced by real-time Critical/High alerts only); and the Stripe flow no longer enrolls payers into the `subscribers` list. Implemented as a second change-set (see "Single-weekly-email policy" below).

## Single-weekly-email policy (2026-06-24, second change-set)

Three changes turn the previous Brief(daily)+Digest(daily) pair into one weekly Brief:

1. **Brief → weekly.** `schedulerRunner.ts` Brief cron `0 7 * * *` → `0 7 * * 1` (Mondays 07:00 UTC). The Brief already computes a trailing 7-day window (`briefScheduler.WINDOW_DAYS = 7`), so weekly editions are non-overlapping; no other change needed.
2. **Daily Digest send → off.** New `dailyDigestFeatureFlag.ts` (`SECURELOGIC_DAILY_DIGEST_ENABLED`, OFF by default) guards `digestScheduler.runDailyDigest()` — it returns early with `daily_digest_disabled` and never selects recipients or sends. The 08:00 cron still fires but no-ops. **Real-time alerts are unaffected:** `alertEmailService.sendCriticalFindingAlert` (Tier 1, event-driven) still fires when a Critical/High finding hits a customer's vendor. The Weekly Posture Summary (Tier 3) is also unaffected.
3. **Stripe no longer enrolls the `subscribers` list.** Removed `syncSubscriber()` and its call in `stripeWebhook.ts` (it inserted payers into `subscribers`, which fed the legacy Newsletter / digest-style sends — now off). The Brief subscription path (`intelligence_brief_subscribers`) is unchanged. `subscribers` remains admin-managed via `routes/adminSubscribers.ts`.

**Mapping nuance (verified):** the Daily Digest's audience is actually `users` gated by `user_alert_preferences.daily_digest` (DB default TRUE) — not the Stripe `subscribers` list, which fed the legacy Newsletter. Change #2 turns the digest fully off regardless of audience; change #3 stops the only Stripe-driven list enrollment. If the digest is ever re-enabled, note that `daily_digest` still defaults TRUE for new users (a separate migration would be needed to default-opt-out).

## Files changed (final)

Change-set 1 (legacy Newsletter disable): `src/api/lib/legacyNewsletterFeatureFlag.ts` (+test), `services/intelligence-worker/src/pipeline/runPipeline.ts` (+test).
Change-set 2 (single-weekly-email policy): `src/api/lib/schedulerRunner.ts`, `src/api/lib/dailyDigestFeatureFlag.ts` (+test), `src/api/lib/digestScheduler.ts` (gate), `src/api/webhooks/stripeWebhook.ts` (remove syncSubscriber), `src/api/__tests__/emailCadence.test.ts`.
Excluded from commit: `render.yaml` (pre-existing unrelated blanking).
