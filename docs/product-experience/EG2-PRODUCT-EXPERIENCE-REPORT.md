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

