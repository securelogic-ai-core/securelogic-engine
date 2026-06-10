CREATE TABLE legal_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('terms_of_service', 'privacy_policy', 'ai_transparency_policy')),
  document_version TEXT NOT NULL,
  consent_method TEXT NOT NULL CHECK (consent_method IN ('signup_checkbox', 'team_invite_accept', 'sso_first_login_interstitial', 're_consent_dialog', 'admin_recorded')),
  ip_address INET,
  user_agent TEXT,
  consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, document_type, document_version)
);

CREATE INDEX idx_legal_consents_user_id ON legal_consents(user_id);
CREATE INDEX idx_legal_consents_org_id ON legal_consents(organization_id);

COMMENT ON TABLE legal_consents IS 'Audit-grade record of every consent event. One row per (user, document_type, document_version). Supports future re-consent flows when policy versions change.';
