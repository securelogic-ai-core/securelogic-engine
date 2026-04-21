-- Risk scale presets and per-org configuration
-- Migration: 20260421_risk_scales

-- --------------------------------------------------------
-- Presets table: 4 built-in presets
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS risk_scale_presets (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL UNIQUE,
  display_name text       NOT NULL,
  levels      jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT NOW()
);

-- Seed presets (idempotent)

INSERT INTO risk_scale_presets (name, display_name, levels)
VALUES
  (
    'standard',
    'Standard',
    '[
      {"value":"low",      "label":"Low",       "color":"#22c55e","rank":1},
      {"value":"medium",   "label":"Medium",    "color":"#f59e0b","rank":2},
      {"value":"high",     "label":"High",      "color":"#f97316","rank":3},
      {"value":"critical", "label":"Critical",  "color":"#ef4444","rank":4}
    ]'::jsonb
  ),
  (
    'nist',
    'NIST',
    '[
      {"value":"low",      "label":"Low",       "color":"#22c55e","rank":1},
      {"value":"moderate", "label":"Moderate",  "color":"#f59e0b","rank":2},
      {"value":"high",     "label":"High",      "color":"#f97316","rank":3},
      {"value":"very_high","label":"Very High", "color":"#ef4444","rank":4}
    ]'::jsonb
  ),
  (
    'simple',
    'Simple',
    '[
      {"value":"low",  "label":"Low",  "color":"#22c55e","rank":1},
      {"value":"high", "label":"High", "color":"#ef4444","rank":2}
    ]'::jsonb
  ),
  (
    'custom',
    'Custom',
    '[]'::jsonb
  )
ON CONFLICT (name) DO NOTHING;

-- --------------------------------------------------------
-- Per-org scale configuration
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS organization_risk_scales (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL UNIQUE
                               REFERENCES organizations(id)
                               ON DELETE CASCADE,
  preset_name      text        NOT NULL DEFAULT 'standard',
  custom_levels    jsonb,
  -- null  = use preset levels unchanged
  -- non-null = org has customized labels/colors on top of the preset
  created_at       timestamptz NOT NULL DEFAULT NOW(),
  updated_at       timestamptz NOT NULL DEFAULT NOW()
);
