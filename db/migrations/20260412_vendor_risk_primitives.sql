-- Vendor Risk Primitives
--
-- Extends the existing vendors table (created in 001_securelogic_platform.sql)
-- with the fields required to make Vendor a first-class platform primitive.
--
-- This migration is additive only:
--   - No columns are removed
--   - No existing columns are altered in a breaking way
--   - current_risk_score and framework_coverage are left in place
--     (they are pre-platform legacy fields; they will be superseded in
--      a later package once control/framework primitives exist)
--   - assessments.vendor_id FK (ON DELETE SET NULL) is unaffected
--
-- Linkage convention (no FK enforced — polymorphic pattern):
--   findings.source_type = 'vendor_review' with findings.source_id = vendors.id
--   means that vendor-originated findings can be filtered and rolled up by
--   vendor without requiring a hard FK on the polymorphic source_id column.
--   This convention is established here and must be honoured by all future
--   modules that create findings from vendor reviews.

-- ============================================================
-- 1. ADD MISSING PLATFORM FIELDS TO vendors
-- ============================================================

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS service_description TEXT,
  ADD COLUMN IF NOT EXISTS data_sensitivity    TEXT,
  ADD COLUMN IF NOT EXISTS access_level        TEXT,
  ADD COLUMN IF NOT EXISTS website             TEXT,
  ADD COLUMN IF NOT EXISTS status              TEXT NOT NULL DEFAULT 'active';

-- ============================================================
-- 2. ADD CHECK CONSTRAINTS
-- ============================================================

-- criticality: the column already exists but had no constraint in the original migration
-- Use a DO block so re-running is idempotent (constraint may already exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'vendors'
      AND constraint_name = 'vendors_criticality_check'
  ) THEN
    ALTER TABLE vendors
      ADD CONSTRAINT vendors_criticality_check
        CHECK (criticality IS NULL OR criticality IN ('critical', 'high', 'medium', 'low'));
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'vendors'
      AND constraint_name = 'vendors_data_sensitivity_check'
  ) THEN
    ALTER TABLE vendors
      ADD CONSTRAINT vendors_data_sensitivity_check
        CHECK (data_sensitivity IS NULL OR data_sensitivity IN ('none', 'internal', 'confidential', 'restricted'));
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'vendors'
      AND constraint_name = 'vendors_access_level_check'
  ) THEN
    ALTER TABLE vendors
      ADD CONSTRAINT vendors_access_level_check
        CHECK (access_level IS NULL OR access_level IN ('none', 'read_only', 'read_write', 'admin', 'network_access'));
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'vendors'
      AND constraint_name = 'vendors_status_check'
  ) THEN
    ALTER TABLE vendors
      ADD CONSTRAINT vendors_status_check
        CHECK (status IN ('active', 'archived'));
  END IF;
END;
$$;

-- ============================================================
-- 3. INDEXES FOR PLATFORM-LEVEL QUERIES
-- ============================================================

-- idx_vendors_org already exists from 001_securelogic_platform.sql
-- Add status and criticality indexes for filtered list queries

CREATE INDEX IF NOT EXISTS idx_vendors_org_status
  ON vendors (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_vendors_org_criticality
  ON vendors (organization_id, criticality);

CREATE INDEX IF NOT EXISTS idx_vendors_owner
  ON vendors (owner_user_id);
