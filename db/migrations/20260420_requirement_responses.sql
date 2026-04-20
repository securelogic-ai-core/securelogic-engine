CREATE TABLE IF NOT EXISTS requirement_responses (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requirement_id   uuid        NOT NULL REFERENCES requirements(id)  ON DELETE CASCADE,
  assessment_type  text        NOT NULL CHECK (assessment_type IN ('self', 'vendor')),
  subject_id       uuid        NOT NULL,
  -- For self assessments subject_id = organization_id.
  -- For vendor assessments subject_id = vendor_id.
  status           text        NOT NULL CHECK (status IN ('pass', 'fail', 'partial', 'not_assessed')),
  notes            text,
  evidence_url     text,
  assessed_by      uuid        REFERENCES users(id) ON DELETE SET NULL,
  assessed_at      timestamptz NOT NULL DEFAULT NOW(),
  created_at       timestamptz NOT NULL DEFAULT NOW(),
  updated_at       timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, requirement_id, assessment_type, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_req_responses_org_framework
  ON requirement_responses (organization_id)
  INCLUDE (requirement_id, assessment_type, subject_id, status);
