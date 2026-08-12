-- Migration: vendor_portal_access
-- Package:   Vendor Assurance — Phase 3 (external trust boundary)
--
-- THE FIRST UNAUTHENTICATED WRITE PATH IN THE PLATFORM THAT TOUCHES TENANT DATA.
--
-- Two tables, and the separation between them is the security design, not
-- bookkeeping:
--
--   vendor_engagement_invites   a long-lived CAPABILITY, delivered by email
--   vendor_portal_sessions      a short-lived AUTHENTICATED SESSION
--
-- ── Why the invite is exchanged for a session ──────────────────────────────
--
-- The existing /accept-invite precedent puts the token in the URL. That is fine
-- for a one-shot internal invite. A vendor engagement lives for WEEKS, so a
-- URL-borne token would persist for that whole period in browser history, in
-- Referer headers to any third-party asset, and in every access log between the
-- vendor and us.
--
-- So the invite token is exchanged ONCE for a session token delivered as an
-- httpOnly cookie, and the app redirects to a URL with no secret in it. The
-- invite remains re-exchangeable until expiry (the vendor returns via the same
-- email), and every exchange is audited.
--
-- ── Both tokens are stored as SHA-256 hashes, never raw ────────────────────
--
-- Exactly the model dataExportDownloadToken.ts already establishes: 256 bits of
-- entropy, plain SHA-256 at rest, lookup BY hash on a unique index. A database
-- read never yields a usable token. Not an HMAC — there is no server-side secret
-- in the scheme; security rests on the entropy, the unique-hash lookup and a
-- bounded expiry, the same posture as an API key.
--
-- ── Fail-closed by construction ────────────────────────────────────────────
--
-- Neither table has a "disabled" flag that must be checked. Validity is derived
-- from expires_at / revoked_at, so a query that forgets a condition returns a
-- row that the resolver then rejects on time — rather than a row that looks
-- valid because someone forgot to check a boolean.
--
-- ── Rate limiting lives HERE, not only in Redis ────────────────────────────
--
-- src/api/middleware/apiRateLimiter.ts FAILS OPEN when Redis is unavailable
-- (`if (!redisReady) next()`). That is defensible for authenticated API keys and
-- unacceptable for an unauthenticated external surface: a Redis blip would
-- remove the only limit on a public endpoint. request_count / window_started_at
-- give the portal a DB-backed limiter that survives a Redis outage.
--
-- Additive only. Empty at birth. RLS lands with the tables.

-- ---------------------------------------------------------------
-- vendor_engagement_invites
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vendor_engagement_invites (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  engagement_id         UUID        NOT NULL REFERENCES vendor_engagements(id) ON DELETE CASCADE,

  -- SHA-256 of a 256-bit random token. The raw value exists only in the
  -- invitation email and is never persisted or logged. UNIQUE so the resolver
  -- can look up BY hash and match at most one row.
  invite_token_hash     TEXT        NOT NULL UNIQUE,

  contact_email         TEXT        NOT NULL,
  contact_name          TEXT        NULL,

  expires_at            TIMESTAMPTZ NOT NULL,
  revoked_at            TIMESTAMPTZ NULL,
  revoked_by_user_id    UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  revocation_reason     TEXT        NULL,

  -- First and most recent exchange. Re-exchange is permitted until expiry so the
  -- vendor can return via the same email; each one is audited.
  first_exchanged_at    TIMESTAMPTZ NULL,
  last_exchanged_at     TIMESTAMPTZ NULL,
  exchange_count        INTEGER     NOT NULL DEFAULT 0 CHECK (exchange_count >= 0),

  created_by_user_id    UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT vendor_engagement_invites_revocation_reason CHECK (
    revoked_at IS NULL OR (revocation_reason IS NOT NULL AND length(trim(revocation_reason)) > 0)
  )
);

-- The resolver's only lookup path.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_engagement_invites_token
  ON vendor_engagement_invites (invite_token_hash);

CREATE INDEX IF NOT EXISTS idx_vendor_engagement_invites_engagement
  ON vendor_engagement_invites (engagement_id, created_at DESC);

-- Live invites for an engagement: the "can this be issued / is it still open"
-- question, without scanning revoked and expired rows.
CREATE INDEX IF NOT EXISTS idx_vendor_engagement_invites_live
  ON vendor_engagement_invites (organization_id, engagement_id)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------
-- vendor_portal_sessions
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vendor_portal_sessions (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invite_id             UUID        NOT NULL REFERENCES vendor_engagement_invites(id) ON DELETE CASCADE,
  -- Denormalised from the invite: the resolver needs the engagement on EVERY
  -- request, and a join through invites on the hot path of an unauthenticated
  -- endpoint is a place for a mistake to hide.
  engagement_id         UUID        NOT NULL REFERENCES vendor_engagements(id) ON DELETE CASCADE,

  session_token_hash    TEXT        NOT NULL UNIQUE,

  -- Idle AND absolute, like the internal session policy. Idle alone lets a
  -- session live forever under polling; absolute alone leaves an abandoned
  -- browser open for the full window.
  idle_expires_at       TIMESTAMPTZ NOT NULL,
  absolute_expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at            TIMESTAMPTZ NULL,

  -- Recorded and FLAGGED on change, never used to block: vendors legitimately
  -- switch networks and devices mid-questionnaire, and blocking on that would
  -- lock out honest users while barely inconveniencing an attacker who already
  -- holds the cookie.
  created_ip            TEXT        NULL,
  created_user_agent_sha256 TEXT    NULL,
  last_seen_ip          TEXT        NULL,
  fingerprint_changed_at TIMESTAMPTZ NULL,

  -- DB-backed rate limiting. The Redis limiter FAILS OPEN when Redis is down —
  -- acceptable for authenticated API keys, not for a public endpoint.
  request_count         INTEGER     NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  window_started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT vendor_portal_sessions_absolute_after_idle CHECK (
    absolute_expires_at >= idle_expires_at
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_portal_sessions_token
  ON vendor_portal_sessions (session_token_hash);

CREATE INDEX IF NOT EXISTS idx_vendor_portal_sessions_engagement
  ON vendor_portal_sessions (engagement_id, created_at DESC);

-- Mass revocation: killing every live session for an engagement, or org-wide
-- when the portal kill switch is thrown.
CREATE INDEX IF NOT EXISTS idx_vendor_portal_sessions_live
  ON vendor_portal_sessions (organization_id, engagement_id)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE vendor_engagement_invites IS
  'Long-lived capability delivered by email. invite_token_hash is SHA-256 of a '
  '256-bit random token; the raw value exists only in the email and is never '
  'persisted or logged. Exchanged for a short-lived portal session rather than '
  'used directly, so a weeks-long secret never lives in a URL.';

COMMENT ON TABLE vendor_portal_sessions IS
  'Short-lived authenticated session for the external vendor portal, delivered '
  'as an httpOnly cookie. Scoped to exactly ONE engagement. request_count / '
  'window_started_at provide DB-backed rate limiting because the Redis limiter '
  'fails open, which is unacceptable on an unauthenticated surface.';

-- ---------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------
-- NOT FORCE: the token/session resolver runs BEFORE any org context exists —
-- it is what establishes the org — so it must look the row up on the elevated
-- channel, exactly as the tokenized data-export download route does. Everything
-- AFTER resolution runs inside withTenant(orgId).

ALTER TABLE vendor_engagement_invites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_engagement_invites_tenant_isolation ON vendor_engagement_invites;
CREATE POLICY vendor_engagement_invites_tenant_isolation ON vendor_engagement_invites
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE vendor_portal_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_portal_sessions_tenant_isolation ON vendor_portal_sessions;
CREATE POLICY vendor_portal_sessions_tenant_isolation ON vendor_portal_sessions
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON vendor_engagement_invites TO app_request;
GRANT SELECT, INSERT, UPDATE, DELETE ON vendor_portal_sessions    TO app_request;
