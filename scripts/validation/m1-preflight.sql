-- m1-preflight.sql — M-1 PR-3: the fail-closed pre-activation gate.
-- Design: docs/M1-app-request-flip-design.md §5 step 0 (P-1..P-4).
--
-- RUN (read-only; catalog SELECTs + RAISE only — no writes of any kind):
--     psql "$OWNER_DSN" -X -v ON_ERROR_STOP=1 -f scripts/validation/m1-preflight.sql
--
-- Run per environment on the OWNER channel BEFORE the DATABASE_URL flip, and
-- re-run after any migration wave that precedes the flip. Every check RAISEs
-- EXCEPTION on failure (psql exits non-zero) — silence is never a pass; the
-- script prints an explicit "M1 PREFLIGHT: PASS" only if every gate holds.
--
-- Gates:
--   G1  app_request role exists with exactly the designed attributes
--   G2  erasure_agent remains NOLOGIN with the designed attributes
--   G3  no unexpected BYPASSRLS role (postgres itself excepted)
--   G4  the connected identity is the owner side, NOT app_request, and
--       app_request/erasure_agent own zero objects (identity confusion)
--   G5  every public table (and view) has app_request grants or is on the
--       explicit Tier-D allowlist — bidirectional, mirroring the C-3 test
--   G6  no RLS-enabled table has zero policies (deny-all trap)
--   G7  no table uses FORCE ROW LEVEL SECURITY (the A2 path we did not take)
--   G8  app_request holds USAGE on all sequences
--   G9  service-state: no live session is already connected as app_request
--       (pre-flip expectation; rerun post-flip with m1_expect_flipped=1)

\set ON_ERROR_STOP 1

DO $preflight$
DECLARE
  bad TEXT;
  n   INT;
BEGIN
  ---------------------------------------------------------------------------
  -- G1: app_request attributes
  ---------------------------------------------------------------------------
  SELECT count(*) INTO n FROM pg_roles
   WHERE rolname = 'app_request'
     AND rolcanlogin AND NOT rolbypassrls AND NOT rolsuper
     AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication;
  IF n <> 1 THEN
    RAISE EXCEPTION 'G1 FAIL: app_request missing or attribute drift — expected LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION (found % matching)', n;
  END IF;

  ---------------------------------------------------------------------------
  -- G2: erasure_agent stays inert
  ---------------------------------------------------------------------------
  SELECT count(*) INTO n FROM pg_roles
   WHERE rolname = 'erasure_agent'
     AND NOT rolcanlogin AND NOT rolbypassrls AND NOT rolsuper
     AND NOT rolcreaterole AND NOT rolcreatedb;
  IF n <> 1 THEN
    RAISE EXCEPTION 'G2 FAIL: erasure_agent missing or no longer NOLOGIN-inert — E-2 Increment 4 owns any credential issuance, not the M-1 flip';
  END IF;

  ---------------------------------------------------------------------------
  -- G3: no unexpected BYPASSRLS. Superusers bypass RLS inherently (Render's
  -- `postgres`, the harness superuser) — the drift this gate catches is an
  -- ORDINARY role that has been granted BYPASSRLS, which would make RLS
  -- decoration for whatever connects as it.
  ---------------------------------------------------------------------------
  SELECT string_agg(rolname, ', ') INTO bad FROM pg_roles
   WHERE rolbypassrls AND NOT rolsuper;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'G3 FAIL: non-superuser BYPASSRLS role(s): % — RLS would be decoration for them', bad;
  END IF;

  ---------------------------------------------------------------------------
  -- G4: identity — this session must be owner-side, and the restricted roles
  --     must own nothing
  ---------------------------------------------------------------------------
  IF current_user = 'app_request' THEN
    RAISE EXCEPTION 'G4 FAIL: preflight is connected AS app_request — run it on the owner/migration channel';
  END IF;
  SELECT count(*) INTO n FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace
     AND NOT pg_has_role(current_user, c.relowner, 'USAGE');
  IF n > 0 THEN
    RAISE EXCEPTION 'G4 FAIL: the connected identity does not own (directly or via membership) % public relation(s) — owner/runtime identity confusion', n;
  END IF;
  SELECT string_agg(DISTINCT relowner::regrole::text, ', ') INTO bad
    FROM pg_class
   WHERE relnamespace = 'public'::regnamespace
     AND relowner::regrole::text IN ('app_request', 'erasure_agent');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'G4 FAIL: restricted role(s) own objects: %', bad;
  END IF;

  ---------------------------------------------------------------------------
  -- G5: grant coverage — bidirectional against the Tier-D allowlist.
  --     Keep this list IN SYNC with test/isolation/appRequestGrants.test.ts.
  ---------------------------------------------------------------------------
  SELECT string_agg(c.relname, ', ') INTO bad
    FROM pg_class c
   WHERE c.relkind IN ('r', 'v', 'm')
     AND c.relnamespace = 'public'::regnamespace
     AND c.relname NOT IN (
       'auth_anomaly_alerts', 'webhook_events_processed', 'worker_runs',
       'schema_migrations', 'email_provider_events', 'feed_health', 'sources',
       'intelligence_event_timeline',
       'intelligence_event_workflow_triggers')
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.role_table_grants g
        WHERE g.table_schema = 'public' AND g.table_name = c.relname
          AND g.grantee = 'app_request');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'G5 FAIL: relations with ZERO app_request grants and no Tier-D entry (post-flip 42501): %', bad;
  END IF;
  SELECT string_agg(t.name, ', ') INTO bad
    FROM unnest(ARRAY[
       'auth_anomaly_alerts', 'webhook_events_processed', 'worker_runs',
       'email_provider_events', 'feed_health', 'sources',
       'intelligence_event_timeline', 'intelligence_event_workflow_triggers'
    ]) AS t(name)
   WHERE EXISTS (
       SELECT 1 FROM information_schema.role_table_grants g
        WHERE g.table_schema = 'public' AND g.table_name = t.name
          AND g.grantee = 'app_request');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'G5 FAIL: Tier-D-allowlisted table(s) NOW have grants (stale allowlist): %', bad;
  END IF;

  ---------------------------------------------------------------------------
  -- G6: RLS-enabled with no policy = deny-all trap
  ---------------------------------------------------------------------------
  SELECT string_agg(c.relname, ', ') INTO bad
    FROM pg_class c
   WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace
     AND c.relrowsecurity
     AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'G6 FAIL: RLS enabled with ZERO policies (deny-all for app_request): %', bad;
  END IF;

  ---------------------------------------------------------------------------
  -- G7: FORCE RLS must not appear (Decision A1 explicitly declined A2)
  ---------------------------------------------------------------------------
  SELECT string_agg(relname, ', ') INTO bad
    FROM pg_class
   WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace
     AND relforcerowsecurity;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'G7 FAIL: FORCE ROW LEVEL SECURITY present on: % — would subject the owner/migration channel to RLS', bad;
  END IF;

  ---------------------------------------------------------------------------
  -- G8: sequence USAGE
  ---------------------------------------------------------------------------
  -- OFFSET 0 fences the subquery so has_sequence_privilege only ever sees
  -- relkind='S' rows (the planner may otherwise evaluate it first).
  -- schema_migrations_id_seq is exempt: its table is Tier-D (app_request may
  -- not touch migration bookkeeping), so its sequence needs no grant either.
  SELECT string_agg(s.relname, ', ') INTO bad
    FROM (SELECT c.relname, c.oid FROM pg_class c
           WHERE c.relkind = 'S' AND c.relnamespace = 'public'::regnamespace
             AND c.relname <> 'schema_migrations_id_seq'
           OFFSET 0) s
   WHERE NOT has_sequence_privilege('app_request', s.oid, 'USAGE');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'G8 FAIL: sequences without app_request USAGE: %', bad;
  END IF;

  ---------------------------------------------------------------------------
  -- G9: service state — nothing should already be connected as app_request
  --     before the flip (a session would mean a credential exists and is in
  --     use outside this activation)
  ---------------------------------------------------------------------------
  SELECT count(*) INTO n FROM pg_stat_activity WHERE usename = 'app_request';
  IF n > 0 AND COALESCE(current_setting('m1.expect_flipped', true), '') <> '1' THEN
    RAISE EXCEPTION 'G9 FAIL: % live session(s) already connected as app_request pre-flip — investigate before proceeding', n;
  END IF;

  RAISE NOTICE 'M1 PREFLIGHT: PASS — all gates hold (G1..G9)';
END
$preflight$;
