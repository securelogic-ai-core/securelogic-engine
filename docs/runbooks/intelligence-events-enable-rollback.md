# Runbook — Intelligence Events: enablement, rollback, operator ledger

Covers the canonical Intelligence Event layer (Intelligence Pipeline Hardening)
and the brief-reliability catch-up. Everything is DARK by default; nothing in
this runbook has been executed by the engineering program (GATE B).

Design memo: `docs/architecture/erip/IE-INTELLIGENCE-EVENTS-MEMO.md`.
Tracker: `docs/validation/intelligence-pipeline-hardening-tracker.md`.

## 1. What ships dark

- Migration `20260822_intelligence_events.sql` — 3 GLOBAL tables
  (`intelligence_events`, `intelligence_event_sources`, `intelligence_event_timeline`).
  Additive; created empty; nothing reads/writes them until the flag is on.
- Migration `20260823_findings_intelligence_event.sql` — additive `findings.source_type`
  value `'intelligence_event'` + a partial unique dedup index. Enables one finding per
  (org, event), updated not duplicated. Legacy `cyber_signal` findings untouched.
- Migration `20260824_intelligence_event_notifications.sql` — ORG-scoped notification
  dedup ledger (RLS NOT FORCE + app_request grant). Prevents duplicate per-event sends.
- Flag `SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED` (default `"false"` ×4 ingestion services).
  When on, the hourly intelligence-worker projects GLOBAL cyber_signals into events.
- Flag `SECURELOGIC_BRIEF_CATCHUP_ENABLED` (default `"false"` ×2 engine services).
  When on, a boot on the Tuesday send window recovers a missed weekly brief send.

## 2. Staging validation (operator-owned)

1. Apply migrations in staging (`npm run migrate`). Confirm the 3 tables exist and are empty.
2. Set `SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED=true` on the staging intelligence-worker
   (and engine-staging). Let the hourly pipeline run, or run
   `npm run intelligence-events:project` once.
3. Verify: `SELECT canonical_key, severity, status, source_count, confidence FROM intelligence_events LIMIT 20;`
   — same-CVE signals from multiple sources appear as ONE row; `source_count > 1` where corroborated.
   `SELECT relation, count(*) FROM intelligence_event_sources GROUP BY 1;` — attribution preserved.
   `SELECT entry_type, count(*) FROM intelligence_event_timeline GROUP BY 1;` — timeline accrued.
4. Idempotency: run the projection twice; the second run reports `projected 0` and adds no rows.
5. Brief catch-up (separate): set `SECURELOGIC_BRIEF_CATCHUP_ENABLED=true` on engine-staging,
   simulate a missed Tuesday send, restart the service in the Tuesday window, confirm exactly
   one recovery send and that the idempotency guard prevents any double-delivery.

## 3. Production enablement checklist (GATE B — operator only, NOT executed)

- [ ] Migration `20260822` applied to prod (additive; safe to apply while dark).
- [ ] Staging validation §2 green.
- [ ] Flip `SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED=true` on the prod intelligence-worker first;
      observe `intelligence_event_projection` log counts for one cycle before enabling elsewhere.
- [ ] (Later, IE.P7) enable downstream reads only after the projection has backfilled.

## 4. Rollback

Fully reversible at every stage:

- **Disable:** set both flags back to `"false"` (the default). Projection stops doing DB work
  immediately; every existing surface reverts to legacy behaviour byte-for-byte. No data
  migration needed — the event tables simply stop being written/read.
- **Remove (optional):** the tables are additive and referenced by nothing in the legacy path:
  ```sql
  DROP TABLE IF EXISTS intelligence_event_notifications;
  DROP INDEX IF EXISTS idx_findings_intelligence_event_unique;
  DROP TABLE IF EXISTS intelligence_event_timeline;
  DROP TABLE IF EXISTS intelligence_event_sources;
  DROP TABLE IF EXISTS intelligence_events;
  ```
  The only shared table touched is `findings` (an additive CHECK value + a partial index);
  event-sourced findings can be dropped with
  `DELETE FROM findings WHERE source_type='intelligence_event';` — legacy `cyber_signal`
  findings are untouched. Removal otherwise restores the exact pre-epic schema.

## 5. Operator ledger (documented, NEVER executed by the program)

| # | Action | Owner | Status |
|---|---|---|---|
| O-1 | Apply migration `20260822` in staging then prod | operator (DB creds) | NOT DONE |
| O-2 | Staging validation of Intelligence Event projection (§2) | operator | NOT DONE |
| O-3 | Run `npm run intelligence-events:project` backfill in staging/prod | operator | NOT DONE |
| O-4 | Production enablement of `SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED` (GATE B) | operator | NOT DONE |
| O-5 | Staging validation + enablement of `SECURELOGIC_BRIEF_CATCHUP_ENABLED` (GATE B) | operator | NOT DONE |
| O-6 | Confirm `BRIEF_FROM_EMAIL` is a verified Resend sender before any brief enablement | operator | NOT DONE |

Nothing above is performed by the engineering program. Merges land on `develop` only;
`main` is frozen; no flag is enabled in any environment.
