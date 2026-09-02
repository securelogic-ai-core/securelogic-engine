-- 20261082 — ADR-0012 Step 2, part 3 of 3. evidence_lifecycle_events: the
-- append-only record of what happened to an artifact and to each of its uses.
--
-- Re-slotted from the ADR's reserved 20261054; see 20261080's header. The
-- reserved range 20261051–55 is retired unused.
--
-- ── WHY A SEPARATE STREAM ──────────────────────────────────────────────────
--
-- ADR-0012's standing rule is that evidence history is immutable and correction
-- happens through supersession, never destructive mutation. A rule like that is
-- only worth as much as the record that can demonstrate it was kept. The
-- decision-basis snapshot (link ids + sha256 in the deciding audit payload)
-- answers "what did we rely on at that moment"; this table answers the other
-- half — "what happened to this artifact and its uses, in order".
--
-- Mirrors finding_lifecycle_events / risk_lifecycle_events in shape and in
-- privilege: SELECT + INSERT only, UPDATE/DELETE/TRUNCATE refused by the SHARED
-- worm_guard_mutation (20261017), never a private copy.
--
-- ── EMPTY BY CONSTRUCTION, AND NOT BACKFILLED ──────────────────────────────
--
-- No writer exists in this package, and no historical event was manufactured
-- for legacy evidence (owner direction, 2026-09-01). A lifecycle stream that
-- begins with invented events would be worse than one that begins empty: it
-- would look like a complete history while being a reconstruction. It begins
-- empty, and the first row it ever holds will be a real one.
--
-- Reversible: docs/release/ROLLBACK-20261082.sql.

CREATE TABLE IF NOT EXISTS evidence_lifecycle_events (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- The subject, held BY VALUE with no foreign key — the security_audit_log
  -- discipline. An event stream must be able to record that an artifact was
  -- destroyed, which a RESTRICT would forbid and a CASCADE would erase. It also
  -- keeps this table from becoming a second blocker on the evidence row: 20261081
  -- already holds one (deliberately), and stacking a WORM table behind a cascade
  -- is how finding_lifecycle_events came to block DELETE FROM users estate-wide.
  evidence_id      UUID        NOT NULL,
  link_id          UUID        NULL,

  event_type       TEXT        NOT NULL,

  -- ON DELETE SET NULL matches finding_lifecycle_events.actor_user_id and the
  -- rest of the lifecycle family. KNOWN AND PRE-EXISTING TENSION, recorded
  -- rather than rediscovered: SET NULL is an UPDATE, and the WORM guard refuses
  -- UPDATE, so a hard DELETE FROM users would fail here as it already does on
  -- finding_lifecycle_events. It is latent only because product code tombstones
  -- users instead of deleting them (D-1). This migration does not widen that
  -- condition and does not fix it; the certified-erasure exception in
  -- worm_guard_mutation is the sanctioned path.
  actor_user_id    UUID        NULL REFERENCES users(id) ON DELETE SET NULL,

  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- What changed, by value, so the event stays readable after the columns it
  -- describes have moved on. The gap_basis pattern.
  detail           JSONB       NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT evidence_lifecycle_event_type_check CHECK (
    event_type IN (
      'linked',                       -- a use was recorded
      'confirmed',                    -- a human confirmed THAT use
      'detached',                     -- a use ended
      'superseded',                   -- a newer version of the artifact arrived
      'validity_established',         -- a human committed valid_from/valid_until
      'assurance_class_established',  -- a human committed the assurance class
      'expiry_observed'               -- the sweep NOTICED an expiry; it flips nothing
    )
  ),

  CONSTRAINT evidence_lifecycle_detail_is_object CHECK (
    jsonb_typeof(detail) = 'object'
  ),

  -- Events about a use must name the use.
  CONSTRAINT evidence_lifecycle_link_grain_check CHECK (
    (event_type IN ('linked', 'confirmed', 'detached') AND link_id IS NOT NULL)
    OR
    (event_type NOT IN ('linked', 'confirmed', 'detached'))
  )
);

CREATE INDEX IF NOT EXISTS idx_evidence_lifecycle_events_evidence
  ON evidence_lifecycle_events (organization_id, evidence_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_evidence_lifecycle_events_link
  ON evidence_lifecycle_events (link_id, occurred_at DESC)
  WHERE link_id IS NOT NULL;

-- ---------------------------------------------------------------
-- Append-only, via the ONE shared guard
-- ---------------------------------------------------------------

DROP TRIGGER IF EXISTS prevent_evidence_lifecycle_events_row_mutation ON evidence_lifecycle_events;
CREATE TRIGGER prevent_evidence_lifecycle_events_row_mutation
  BEFORE UPDATE OR DELETE ON evidence_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION worm_guard_mutation('append-only');

DROP TRIGGER IF EXISTS prevent_evidence_lifecycle_events_truncate ON evidence_lifecycle_events;
CREATE TRIGGER prevent_evidence_lifecycle_events_truncate
  BEFORE TRUNCATE ON evidence_lifecycle_events
  FOR EACH STATEMENT EXECUTE FUNCTION worm_guard_mutation('append-only');

-- ---------------------------------------------------------------
-- Tenant isolation
-- ---------------------------------------------------------------

ALTER TABLE evidence_lifecycle_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS evidence_lifecycle_events_tenant_isolation ON evidence_lifecycle_events;
CREATE POLICY evidence_lifecycle_events_tenant_isolation ON evidence_lifecycle_events
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_request') THEN
    GRANT SELECT, INSERT ON evidence_lifecycle_events TO app_request;
  END IF;
END
$$;

COMMENT ON TABLE evidence_lifecycle_events IS
  'ADR-0012 Step 2. Append-only stream of what happened to an evidence artifact '
  'and to each of its uses. SELECT+INSERT only; UPDATE/DELETE/TRUNCATE refused by '
  'the shared worm_guard_mutation. evidence_id and link_id are held by value with '
  'no FK so the stream can outlive its subject — an event saying an artifact was '
  'destroyed must not be destroyed with it. Empty on the day it ships: no writer '
  'exists and no historical event was fabricated.';

COMMENT ON COLUMN evidence_lifecycle_events.event_type IS
  '''expiry_observed'' is a NOTICE, never a state change. ADR-0012 §2.3: the '
  'sweep worker notifies and audits, it flips nothing — posture must not depend '
  'on whether a cron fired, and expiry never un-closes a closed finding (ADR-0009).';
