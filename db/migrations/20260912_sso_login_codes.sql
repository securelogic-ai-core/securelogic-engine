-- Migration: sso_login_codes
-- Package: SSO token-handoff hardening (enterprise architecture review §6:
--          "SAML JWT-in-URL")
--
-- One-time, short-TTL login codes for the SAML ACS → app session handoff.
-- Before this table, the ACS redirect carried the FULL session JWT (plus
-- email/name) in the URL query string — browser history, proxy/server access
-- logs, and Referer exposure for a token that lives EXPIRY_SECONDS. With the
-- exchange flow (flag SECURELOGIC_SSO_CODE_EXCHANGE_ENABLED) the URL carries
-- only an opaque single-use code; the app exchanges it server-side via
-- POST /api/sso/exchange for the session JWT.
--
--   * code_hash    — sha256 hex of the raw code; the raw code is never stored.
--   * expires_at   — 60s TTL; expired rows are inert (consume checks it) and
--                    swept opportunistically on create.
--   * consumed_at  — single-use marker; consume is one atomic UPDATE … WHERE
--                    consumed_at IS NULL, so a replayed code loses the race.
--   * email / display_name — carried to the app callback exactly as the
--                    legacy URL did, but out of the URL.
--
-- Access model: written/consumed by the engine's UNAUTHENTICATED auth path
-- (ACS + exchange) via the owner pool — at consume time the org is unknown
-- until the code row is read, so tenant-scoped access is impossible by
-- construction. RLS is still enabled (NULLIF-GUC pattern, INERT pre-flip)
-- for defense in depth against any future tenant-scoped reader.
--
-- Additive only. Rollback (manual, forward-only convention):
--   DROP TABLE sso_login_codes;

CREATE TABLE IF NOT EXISTS sso_login_codes (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash        TEXT        NOT NULL UNIQUE,
  email            TEXT        NOT NULL,
  display_name     TEXT        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL,
  consumed_at      TIMESTAMPTZ NULL
);

-- Opportunistic sweep on create targets dead rows (expired or consumed).
CREATE INDEX IF NOT EXISTS idx_sso_login_codes_expiry
  ON sso_login_codes (expires_at);

ALTER TABLE sso_login_codes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'sso_login_codes'
       AND policyname = 'sso_login_codes_tenant_isolation'
  ) THEN
    CREATE POLICY sso_login_codes_tenant_isolation ON sso_login_codes
      USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
  END IF;
END $$;

-- Deliberately NO app_request grant: this table is owner-pool-only by its
-- access model (unauthenticated auth path; org unknown until the row is
-- read), and the grant should match the model (security review N4). If a
-- tenant-scoped reader ever appears, add the grant with that reader.

COMMENT ON TABLE sso_login_codes IS
  'One-time short-TTL codes for the SAML ACS -> app session handoff (replaces the session JWT in the redirect URL). code_hash only, 60s TTL, single-use via atomic consumed_at claim. Written/consumed by the unauthenticated auth path on the owner pool.';
