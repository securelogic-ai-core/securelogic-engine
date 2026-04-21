-- controls expansion: add type, status, domain, family, maturity, implementation
-- All columns are nullable or have safe defaults so existing rows are unaffected.

ALTER TABLE controls
  ADD COLUMN IF NOT EXISTS control_type         text,
  ADD COLUMN IF NOT EXISTS status               text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS domain               text,
  ADD COLUMN IF NOT EXISTS control_family       text,
  ADD COLUMN IF NOT EXISTS maturity_level       text,
  ADD COLUMN IF NOT EXISTS implementation_status text;
