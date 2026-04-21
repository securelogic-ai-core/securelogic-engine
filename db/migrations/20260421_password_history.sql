CREATE TABLE IF NOT EXISTS password_history (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_history_user_id
  ON password_history(user_id);

-- Seed current hashes so existing passwords are immediately protected
INSERT INTO password_history (user_id, password_hash)
SELECT id, password_hash
FROM users
WHERE password_hash IS NOT NULL
ON CONFLICT DO NOTHING;
