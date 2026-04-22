CREATE TABLE IF NOT EXISTS password_history (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_history_user_id
  ON password_history(user_id);

-- Seed current hashes so existing passwords are immediately protected.
-- FRESH-DEPLOY GUARD: users.password_hash is added by 20260513_customer_auth.sql
-- which runs after this file. Skip the back-fill when the column does not yet
-- exist (fresh deployments have no password data to seed at this point anyway).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'users'
      AND column_name  = 'password_hash'
  ) THEN
    INSERT INTO password_history (user_id, password_hash)
    SELECT id, password_hash FROM users
    WHERE password_hash IS NOT NULL
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
