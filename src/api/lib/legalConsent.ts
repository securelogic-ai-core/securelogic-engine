/**
 * legalConsent.ts — Audit-grade legal consent tracking.
 *
 * The platform requires every human user to consent to the current versions of
 * three legal documents (Terms of Service, Privacy Policy, AI Transparency
 * Policy) before using authenticated routes. Consent events are written to the
 * `legal_consents` table — one immutable row per (user, document_type,
 * document_version) — so we keep an auditable history across version changes.
 *
 * Re-consent is automatic: bump the version constant below when a document is
 * republished and the requireConsent middleware will treat every existing
 * consent as stale and force users to re-accept on their next request.
 */

import { logger } from "../infra/logger.js";

/**
 * A minimal queryable surface. Both a pooled client (pg.PoolClient) and a Pool
 * satisfy this, so callers may pass either a transaction client (signup /
 * invite-accept paths) or the pool directly (read-only checks).
 */
export interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
}

// Current document versions. Update these constants when publishing new versions
// of the corresponding documents. The migration to require re-consent happens
// automatically: users will be caught by the requireConsent middleware on next
// authenticated request.
export const CURRENT_TERMS_VERSION = "1.0";
export const CURRENT_PRIVACY_VERSION = "1.0";
export const CURRENT_AI_POLICY_VERSION = "1.0";

export const DOCUMENT_TYPES = ["terms_of_service", "privacy_policy", "ai_transparency_policy"] as const;
export type DocumentType = typeof DOCUMENT_TYPES[number];

export const CURRENT_VERSIONS: Record<DocumentType, string> = {
  terms_of_service: CURRENT_TERMS_VERSION,
  privacy_policy: CURRENT_PRIVACY_VERSION,
  ai_transparency_policy: CURRENT_AI_POLICY_VERSION,
};

export type ConsentMethod =
  | "signup_checkbox"
  | "team_invite_accept"
  | "sso_first_login_interstitial"
  | "re_consent_dialog"
  | "admin_recorded";

export interface RecordConsentParams {
  userId: string;
  organizationId: string;
  documentType: DocumentType;
  documentVersion: string;
  consentMethod: ConsentMethod;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

/**
 * Records a single consent event. Idempotent — duplicate (user_id,
 * document_type, document_version) inserts are ignored via ON CONFLICT DO
 * NOTHING. Callers should pass a transaction client (pgElevated or app_request
 * channel) already inside the relevant transaction, or the pool for standalone
 * writes.
 */
export async function recordConsent(
  client: Queryable,
  params: RecordConsentParams
): Promise<void> {
  await client.query(
    `INSERT INTO legal_consents
     (user_id, organization_id, document_type, document_version, consent_method, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, document_type, document_version) DO NOTHING`,
    [
      params.userId,
      params.organizationId,
      params.documentType,
      params.documentVersion,
      params.consentMethod,
      params.ipAddress || null,
      params.userAgent || null,
    ]
  );
  logger.info({
    event: "legal_consent_recorded",
    userId: params.userId,
    documentType: params.documentType,
    documentVersion: params.documentVersion,
    consentMethod: params.consentMethod,
  });
}

/**
 * Records all current-version consents for a user (used at signup, invite
 * accept, etc.).
 */
export async function recordAllCurrentConsents(
  client: Queryable,
  baseParams: Omit<RecordConsentParams, "documentType" | "documentVersion">
): Promise<void> {
  for (const docType of DOCUMENT_TYPES) {
    await recordConsent(client, {
      ...baseParams,
      documentType: docType,
      documentVersion: CURRENT_VERSIONS[docType],
    });
  }
}

/**
 * Returns the document types the user has NOT yet consented to at the current
 * version. Used by requireConsent middleware. A consent at an older version is
 * treated as missing.
 */
export async function getMissingConsents(
  client: Queryable,
  userId: string
): Promise<DocumentType[]> {
  const result = await client.query(
    `SELECT document_type, document_version FROM legal_consents WHERE user_id = $1`,
    [userId]
  );
  const consented = new Set(
    result.rows
      .filter((r: any) => CURRENT_VERSIONS[r.document_type as DocumentType] === r.document_version)
      .map((r: any) => r.document_type)
  );
  return DOCUMENT_TYPES.filter((doc) => !consented.has(doc));
}
