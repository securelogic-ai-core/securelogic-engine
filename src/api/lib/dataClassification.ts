/**
 * dataClassification.ts — runtime constants for the GDPR/CCPA Data Subject
 * Rights workstream (GDPR Arts. 15 / 17 / 20 + CCPA equivalents).
 *
 * SOURCE OF TRUTH: docs/DATA_CLASSIFICATION.md. This file is the machine-
 * readable mirror of that document so future PRs (the export engine — PR #2,
 * and the deletion reaper — PR #6) can reference the classification
 * programmatically instead of re-parsing markdown. Keep the two in sync; the
 * test src/api/__tests__/dataClassification.test.ts asserts this file stays
 * complete against the live migration schema.
 *
 * REFERENCE-ONLY IN PR #1: nothing in the current codebase imports this module.
 * It exists to be reviewed now and consumed by later PRs.
 *
 * Category definitions (see DATA_CLASSIFICATION.md §"Category definitions"):
 *   A — User PII root (the user record itself).
 *   B — User-scoped data (lives and dies with the user; ON DELETE CASCADE).
 *   C — Org content authored by a user (anonymize the actor reference on delete).
 *   D — Org data not tied to a specific user (leave alone on user delete).
 *   E — System-wide / operational (leave alone).
 *   F — Billing / financial (special legal-retention handling).
 *
 * rlsStatus reflects A04-G1 (the mid-flight Postgres RLS rollout), so the
 * reaper / export engine know which tables already enforce row-level security
 * (and therefore need the elevated/owner channel for legitimate cross-org work):
 *   'enabled' — ENABLE ROW LEVEL SECURITY + tenant policy is live in the DB now.
 *   'pending' — Tier A customer-data table that WILL get a policy in A04-G1 but
 *               does not have one yet.
 *   'none'    — system-wide / Tier B/C/D table; no per-org RLS policy planned.
 */

export type DataCategory = "A" | "B" | "C" | "D" | "E" | "F";
export type PiiRisk = "high" | "medium" | "low" | "none";
export type RlsStatus = "enabled" | "pending" | "none";

export interface TableClassification {
  category: DataCategory;
  /** Columns that reference a specific user (FK to users.id or user-id text). */
  userRefColumns?: string[];
  piiRisk: PiiRisk;
  rlsStatus: RlsStatus;
  /**
   * Email-keyed export inclusion (Decision Q6). A handful of Category-E tables
   * key personal data by EMAIL ADDRESS rather than a users.id FK
   * (`subscribers`, `intelligence_brief_subscribers`, `newsletter_deliveries`).
   * They are STILL category 'E' for deletion (leave alone — a subscriber is an
   * email, not necessarily a platform user), but a user's Art. 15 self-export
   * MUST include the rows matching the requester's CURRENT email. This flag
   * marks that "delete=leave, export=include-by-email" distinction so the export
   * engine includes them and the reaper still skips them.
   *
   * NOT set on `email_suppressions`: that table is excluded from both delete and
   * export (Decision O-8 — removing/exposing a suppression risks re-enabling mail
   * to a bounced/complained address).
   *
   * Historical email matching is NOT supported (no email history is tracked) —
   * only the subject's current `users.email` is matched. Mirrored in the
   * DATA_CLASSIFICATION.md export-format section.
   */
  exportByEmailOnly?: boolean;
  /**
   * Columns that physically exist on the table but MUST NOT appear in a data
   * export — credentials, capability tokens, and their expiry companions. The
   * export engine projects an explicit column allowlist (every column EXCEPT
   * these) instead of `SELECT *` for any table that sets this; a missing column
   * list for such a table is a hard error (it refuses to fall back to `SELECT *`).
   *
   * This is the EXPORT-side mirror of `TOMBSTONE_USER_PATCH`, but a SEPARATE
   * field on purpose: deletion and export concerns differ. Tombstone scrubs a
   * column's VALUE in place on delete (Art. 17) while keeping the column; export
   * OMITS the column entirely from the Art. 15 copy. A column can need one,
   * the other, or both — e.g. `users.email` is tombstone-scrubbed but MUST be
   * exported (it is the subject's own data), whereas `users.password_hash` is
   * both scrubbed on delete AND excluded from export. Keeping the lists distinct
   * prevents one concern silently dictating the other.
   *
   * NOT a substitute for the free-text PII manual-review process (O-7).
   */
  exportExcludedColumns?: string[];
  /** Notes that the reaper / export engine must respect for this table. */
  specialHandling?: string;
}

/**
 * Per-table classification. Every table created by a file in db/migrations/
 * MUST have an entry here — enforced by dataClassification.test.ts.
 *
 * Mirror of docs/DATA_CLASSIFICATION.md §"Per-table classification".
 */
export const TABLE_CLASSIFICATION: Record<string, TableClassification> = {
  // ── A — User PII root ──────────────────────────────────────────────────────
  users: {
    category: "A",
    piiRisk: "high",
    rlsStatus: "pending",
    // Credentials + live capability tokens (+ their expiry companions) are
    // omitted from the Art. 15 export. password_hash is a hash, but totp_secret
    // and the *_token columns are live plaintext secrets. See exportExcludedColumns.
    exportExcludedColumns: [
      "password_hash",
      "totp_secret",
      "totp_backup_codes",
      "email_verification_token",
      "email_verification_expires_at",
      "password_reset_token",
      "password_reset_expires_at",
    ],
    specialHandling:
      "TOMBSTONE on delete (O-3): never DELETE this row. Scrub PII in place via TOMBSTONE_USER_PATCH, preserve the UUID. RLS pending — users is a pre-context-auth structural prerequisite for the A04-G1 flip.",
  },

  // ── B — User-scoped data (CASCADE; dies with the user) ─────────────────────
  password_history: { category: "B", userRefColumns: ["user_id"], piiRisk: "high", rlsStatus: "pending", specialHandling: "Password hashes. CASCADE. Exclude from data export." },
  user_alert_preferences: { category: "B", userRefColumns: ["user_id"], piiRisk: "low", rlsStatus: "pending" },
  alert_sends: { category: "B", userRefColumns: ["user_id"], piiRisk: "low", rlsStatus: "pending" },
  dashboard_preferences: { category: "B", userRefColumns: ["user_id"], piiRisk: "low", rlsStatus: "pending", specialHandling: "preference_type='org_default' rows have user_id NULL and are effectively category D — leave those." },
  legal_consents: { category: "B", userRefColumns: ["user_id"], piiRisk: "high", rlsStatus: "pending", specialHandling: "Holds ip_address + user_agent. CASCADE. NO RLS today (NOT a template — canonical RLS pattern is the findings pilot)." },
  org_invites: { category: "B", userRefColumns: ["invited_by_user_id"], piiRisk: "medium", rlsStatus: "pending", exportExcludedColumns: ["token"], specialHandling: "invited_by_user_id is ON DELETE CASCADE — under tombstone the user row is never deleted, so pending invites this user sent are preserved. `token` is a live invite-acceptance capability (UNIQUE, 7-day TTL) — excluded from export." },

  // ── C — Org content authored by a user (anonymize actor) ───────────────────
  risks: { category: "C", userRefColumns: ["owner_user_id"], piiRisk: "high", rlsStatus: "enabled" },
  risk_treatments: { category: "C", userRefColumns: ["reviewer_uuid", "owner_user_id", "reviewer_id"], piiRisk: "high", rlsStatus: "pending", specialHandling: "Deprecated TEXT reviewer_id may hold a raw email/name — anonymize too." },
  risk_control_links: { category: "C", userRefColumns: ["created_by_user_id"], piiRisk: "low", rlsStatus: "enabled" },
  risk_obligation_links: { category: "C", userRefColumns: ["created_by_user_id"], piiRisk: "low", rlsStatus: "enabled" },
  risk_scoring_weights: { category: "C", userRefColumns: ["updated_by_user_id"], piiRisk: "none", rlsStatus: "pending" },
  risk_settings: { category: "C", userRefColumns: ["updated_by_user_id"], piiRisk: "none", rlsStatus: "pending" },
  controls: { category: "C", userRefColumns: ["owner_user_id"], piiRisk: "high", rlsStatus: "pending" },
  control_assessments: { category: "C", userRefColumns: ["reviewer_id"], piiRisk: "high", rlsStatus: "pending" },
  requirement_responses: { category: "C", userRefColumns: ["assessed_by"], piiRisk: "high", rlsStatus: "pending" },
  obligations: { category: "C", userRefColumns: ["owner_user_id"], piiRisk: "high", rlsStatus: "pending" },
  obligation_assessments: { category: "C", userRefColumns: ["reviewer_uuid", "reviewer_id"], piiRisk: "high", rlsStatus: "pending", specialHandling: "Deprecated TEXT reviewer_id may hold a raw email/name." },
  vendors: { category: "C", userRefColumns: ["owner_user_id"], piiRisk: "high", rlsStatus: "pending" },
  vendor_assessments: { category: "C", userRefColumns: ["reviewer_id"], piiRisk: "high", rlsStatus: "enabled" },
  vendor_reviews: { category: "C", userRefColumns: ["reviewer_uuid", "reviewer_id"], piiRisk: "high", rlsStatus: "pending", specialHandling: "Deprecated TEXT reviewer_id may hold a raw email/name." },
  vendor_assurance_documents: { category: "C", userRefColumns: ["uploaded_by_user_id", "finalized_by_user_id", "approved_by_user_id"], piiRisk: "medium", rlsStatus: "pending", specialHandling: "Original PDFs live in R2 under org/{orgId}/vendor-assurance/ — org-owned, included in org export, not user export." },
  vendor_assurance_cuecs: { category: "C", userRefColumns: ["review_status_updated_by_user_id"], piiRisk: "high", rlsStatus: "pending" },
  vendor_assurance_cuec_control_mappings: { category: "C", userRefColumns: ["created_by_user_id", "updated_by_user_id"], piiRisk: "none", rlsStatus: "pending" },
  vendor_assurance_review_decisions: { category: "C", userRefColumns: ["decided_by_user_id"], piiRisk: "high", rlsStatus: "pending" },
  vendor_assurance_field_overrides: { category: "C", userRefColumns: ["overridden_by_user_id"], piiRisk: "high", rlsStatus: "pending" },
  ai_systems: { category: "C", userRefColumns: ["owner_user_id"], piiRisk: "high", rlsStatus: "pending" },
  ai_governance_assessments: { category: "C", userRefColumns: ["reviewer_uuid", "reviewer_id"], piiRisk: "high", rlsStatus: "pending", specialHandling: "Deprecated TEXT reviewer_id may hold a raw email/name." },
  governance_reviews: { category: "C", userRefColumns: ["reviewer_id"], piiRisk: "high", rlsStatus: "pending" },
  ai_system_vendor_dependencies: { category: "C", userRefColumns: ["created_by_user_id"], piiRisk: "high", rlsStatus: "pending" },
  dependency_assessments: { category: "C", userRefColumns: ["reviewer_uuid", "reviewer_id"], piiRisk: "high", rlsStatus: "pending", specialHandling: "Deprecated TEXT reviewer_id may hold a raw email/name." },
  assessments: { category: "C", userRefColumns: ["created_by"], piiRisk: "high", rlsStatus: "pending" },
  findings: { category: "C", userRefColumns: ["owner_user_id"], piiRisk: "high", rlsStatus: "enabled" },
  actions: { category: "C", userRefColumns: ["owner_user_id"], piiRisk: "high", rlsStatus: "pending" },
  signal_match_suggestions: { category: "C", userRefColumns: ["accepted_by_user_id", "dismissed_by_user_id"], piiRisk: "medium", rlsStatus: "pending" },
  signal_vendor_links: { category: "C", userRefColumns: ["created_by_user_id"], piiRisk: "low", rlsStatus: "enabled" },
  signal_ai_system_links: { category: "C", userRefColumns: ["created_by_user_id"], piiRisk: "low", rlsStatus: "pending" },
  signal_control_links: { category: "C", userRefColumns: ["created_by_user_id"], piiRisk: "low", rlsStatus: "pending" },
  signal_obligation_links: { category: "C", userRefColumns: ["created_by_user_id"], piiRisk: "low", rlsStatus: "pending" },

  // ── D — Org data not tied to a specific user (leave alone on user delete) ──
  organizations: { category: "D", piiRisk: "low", rlsStatus: "none", exportExcludedColumns: ["stripe_customer_id", "stripe_subscription_id", "stripe_subscription_tier", "stripe_subscription_status", "payment_failed_at", "promo_code"], specialHandling: "ROOT-TENANT. Carries Stripe F-fields (stripe_customer_id, stripe_subscription_*, payment_failed_at) + promo_code with legal-retention — OMITTED from the org_full export (exportExcludedColumns, PR #2b/Q5); entitlement_level (the portable plan tier) is retained. Only touched on ORG deletion, which is out of scope for this workstream." },
  vendor_assurance_extractions: { category: "D", piiRisk: "low", rlsStatus: "pending" },
  vendor_assurance_extraction_spans: { category: "D", piiRisk: "low", rlsStatus: "pending" },
  frameworks: { category: "D", piiRisk: "low", rlsStatus: "pending" },
  requirements: { category: "D", piiRisk: "low", rlsStatus: "pending" },
  policies: { category: "D", piiRisk: "medium", rlsStatus: "pending" },
  policy_control_links: { category: "D", piiRisk: "none", rlsStatus: "pending" },
  control_mappings: { category: "D", piiRisk: "none", rlsStatus: "pending" },
  obligation_mappings: { category: "D", piiRisk: "none", rlsStatus: "pending" },
  dependencies: { category: "D", piiRisk: "medium", rlsStatus: "pending" },
  evidence: { category: "D", piiRisk: "medium", rlsStatus: "pending", specialHandling: "collected_by is free TEXT (not a user FK) — may embed a name/email; manual-review territory (O-7)." },
  reports: { category: "D", piiRisk: "low", rlsStatus: "pending" },
  posture_snapshots: { category: "D", piiRisk: "none", rlsStatus: "enabled" },
  domain_scores: { category: "D", piiRisk: "none", rlsStatus: "pending" },
  organization_risk_scales: { category: "D", piiRisk: "none", rlsStatus: "pending" },
  webhook_endpoints: { category: "D", piiRisk: "low", rlsStatus: "pending", exportExcludedColumns: ["secret"], specialHandling: "`secret` is the HMAC signing secret for webhook delivery — OMITTED from the org_full export (exportExcludedColumns, PR #2b/Q5); url, event_types, status, description are retained for portability." },
  webhook_deliveries: { category: "D", piiRisk: "low", rlsStatus: "pending" },
  org_sso_configs: { category: "D", piiRisk: "low", rlsStatus: "none", specialHandling: "Org-level SAML IdP config; no user ref." },
  api_usage_daily: { category: "D", piiRisk: "none", rlsStatus: "pending" },

  // ── E — System-wide / operational (leave alone) ────────────────────────────
  signals: { category: "E", piiRisk: "low", rlsStatus: "pending" },
  insights: { category: "E", piiRisk: "low", rlsStatus: "pending" },
  trends: { category: "E", piiRisk: "low", rlsStatus: "pending" },
  trend_signals: { category: "E", piiRisk: "none", rlsStatus: "pending" },
  cyber_signals: { category: "E", piiRisk: "low", rlsStatus: "pending" },
  feed_health: { category: "E", piiRisk: "none", rlsStatus: "none", specialHandling: "GLOBAL operational table — per-source ingestion health (source, timestamps, counts, last_error). Not org-scoped, no PII." },
  intelligence_briefs: { category: "E", piiRisk: "low", rlsStatus: "pending" },
  intelligence_brief_items: { category: "E", piiRisk: "low", rlsStatus: "pending" },
  intelligence_brief_sends: { category: "E", piiRisk: "low", rlsStatus: "pending", specialHandling: "Delivery audit trail; subscriber_id FK. Retained for deliverability/audit." },
  intelligence_brief_sources: { category: "E", piiRisk: "none", rlsStatus: "none", specialHandling: "SHARED-REF source catalog (Tier C, SELECT-only)." },
  newsletter_issues: { category: "E", piiRisk: "low", rlsStatus: "pending" },
  newsletter_issue_insights: { category: "E", piiRisk: "none", rlsStatus: "pending" },
  published_artifacts: { category: "E", piiRisk: "none", rlsStatus: "none", specialHandling: "SHARED-REF published-brief store (Tier C, SELECT-only)." },
  worker_runs: { category: "E", piiRisk: "none", rlsStatus: "none", specialHandling: "Owner-only telemetry (Tier D — no app_request grant)." },
  auth_anomaly_alerts: { category: "E", piiRisk: "low", rlsStatus: "none", specialHandling: "Owner-only (Tier D). subject column holds an offending IP." },
  risk_scale_presets: { category: "E", piiRisk: "none", rlsStatus: "none", specialHandling: "SHARED-REF preset catalog (Tier C, SELECT-only); no org column." },
  webhook_events_processed: { category: "E", piiRisk: "none", rlsStatus: "none", specialHandling: "Owner-only webhook idempotency ledger (Tier D)." },
  jobs: { category: "E", piiRisk: "low", rlsStatus: "enabled", specialHandling: "NEW (this PR). Org-scoped async work queue; requested_by_user_id ON DELETE SET NULL (never fires under tombstone). Worker reads cross-org on the elevated channel." },
  data_export_files: { category: "E", piiRisk: "medium", rlsStatus: "enabled", specialHandling: "NEW (this PR). The R2 bundle it points to CONTAINS a full PII export — purge after 7 days (O-11). download_token_hash lookup precedes org context → use pgElevated. Holds downloaded_from_ip." },

  // ── E (special, audit) ─────────────────────────────────────────────────────
  audit_log: { category: "E", piiRisk: "medium", rlsStatus: "none", specialHandling: "HTTP request log. No user FK; actor_label may embed an email. Tier B (SELECT+INSERT, no UPDATE/DELETE). GDPR retention vs erasure tension — keep, document lawful basis." },
  security_audit_log: { category: "E", piiRisk: "medium", rlsStatus: "none", specialHandling: "APPEND-ONLY (immutability triggers, 20260614). actor_user_id is ON DELETE SET NULL — a hard user delete would trigger a cascade UPDATE the trigger REJECTS, aborting the delete. Tombstone (O-3) avoids this entirely by never deleting the user row. Tier B (SELECT+INSERT)." },

  // ── E (special, email-keyed PII — not user-id keyed) ───────────────────────
  subscribers: { category: "E", exportByEmailOnly: true, piiRisk: "high", rlsStatus: "pending", specialHandling: "Email-keyed (UNIQUE email), NOT user_id keyed. Match by the user's current email, not a user FK. Platform-level (no organization_id) — email is the sole key. delete=leave, export=include-by-email (Q6)." },
  intelligence_brief_subscribers: { category: "E", exportByEmailOnly: true, piiRisk: "high", rlsStatus: "pending", specialHandling: "Keyed by (organization_id, email), NOT user_id. A subscriber is an email address, not necessarily a platform user. Match by current email. delete=leave, export=include-by-email (Q6)." },
  newsletter_deliveries: { category: "E", exportByEmailOnly: true, piiRisk: "medium", rlsStatus: "pending", specialHandling: "Holds subscriber_email. Delivery audit trail. Match by current email. delete=leave, export=include-by-email (Q6)." },
  email_suppressions: { category: "E", piiRisk: "medium", rlsStatus: "none", specialHandling: "KEEP on user delete (O-8): deleting a suppression could re-enable mail to a bounced/complained address. Lawful basis = deliverability/compliance obligation. Tier C (SELECT-only). Platform-level, no org column." },

  // ── F — Billing / financial (special legal-retention handling) ─────────────
  api_keys: { category: "F", userRefColumns: ["created_by_user_id"], piiRisk: "medium", rlsStatus: "pending", specialHandling: "Carries legacy Stripe mirror fields (stripe_customer_id, payment_failed_at, stripe_subscription_tier) with legal-retention. Org-scoped, not user-scoped — a single member self-delete does NOT touch billing. Anonymize created_by_user_id only (SET NULL never fires under tombstone)." },
};

/**
 * The exact field rewrites the reaper (PR #6) applies to the users row on
 * tombstone. NOT applied by any code in this PR — encoded here for review and
 * for the reaper to consume.
 *
 * Mirror of docs/DATA_CLASSIFICATION.md §"Tombstone behavior specification".
 *
 * Template tokens (resolved by the reaper at write time):
 *   "{id}"  → the user's own UUID (so the scrubbed email stays globally UNIQUE,
 *             satisfying the users_email_unique constraint).
 *   "{now}" → now() / the reap timestamp.
 *
 * NOTE — totp_backup_codes: the O-3 spec said "→ NULL", but the column is
 * `text[] NOT NULL DEFAULT '{}'`, so NULL would violate NOT NULL. The only
 * valid scrub is an empty array. Encoded as [] accordingly.
 */
export const TOMBSTONE_USER_PATCH = {
  // identity / PII
  email: "deleted-{id}@deleted.invalid",
  name: "Deleted User",
  // credentials & secrets
  password_hash: "",
  totp_secret: null,
  totp_enabled: false,
  totp_backup_codes: [] as string[], // NOT NULL text[] → empty array, not NULL
  // tokens
  email_verified: false,
  email_verification_token: null,
  email_verification_expires_at: null,
  password_reset_token: null,
  password_reset_expires_at: null,
  // behavioral / login telemetry
  failed_login_attempts: 0,
  lockout_until: null,
  last_failed_login_at: null,
  last_login_at: null,
  previous_login_at: null,
  password_changed_at: null,
  // identity provider linkage
  sso_provider: null,
  // per-user UI state (NOT NULL text[]) → empty array, not NULL
  dismissed_banner_keys: [] as string[],
  // lifecycle
  status: "deleted",
  deleted_at: "{now}",
  updated_at: "{now}",
} as const;

/**
 * users columns that are deliberately PRESERVED on tombstone (NOT NULL and/or
 * identity columns whose whole purpose is to survive deletion). Listing them
 * explicitly lets the drift test prove every NOT-NULL/PII column is a conscious
 * scrub-or-preserve decision rather than silently unhandled.
 *
 * Mirror of docs/DATA_CLASSIFICATION.md §"Tombstone behavior specification".
 */
export const TOMBSTONE_PRESERVED_COLUMNS: readonly string[] = [
  "id", // the whole point of tombstone — UUID preserved for audit integrity
  "organization_id", // FK / audit attribution integrity
  "role", // org structure, last-admin accounting
  "created_at", // audit
  "deletion_scheduled_at", // audit: when the grace window started
  "deletion_requested_by_user_id", // audit: who requested the deletion
  "deletion_reason", // audit: why
];

/**
 * The four valid users.status lifecycle states and their meaning.
 * Mirror of docs/DATA_CLASSIFICATION.md §"User lifecycle states" and the CHECK
 * constraint in 20260621_gdpr_foundations.sql.
 */
export const USER_LIFECYCLE_STATES = {
  active: "Normal user, can authenticate.",
  inactive:
    "Deactivated by admin or auto-deactivated (e.g. team-member removal). Cannot authenticate. NOT pending deletion. Pre-existing behavior.",
  pending_deletion:
    "Deletion requested; in the 30-day grace window; cannot authenticate; cancellable until the reaper runs.",
  deleted:
    "Tombstoned: PII scrubbed in place, UUID preserved. Terminal state.",
} as const;
