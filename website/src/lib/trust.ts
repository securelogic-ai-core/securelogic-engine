/**
 * Shared trust/security content — the single source of truth for both the
 * Trust Center hub (/trust) and the Security detail page (/security). Keeping
 * these arrays here prevents the two surfaces from drifting and keeps every
 * claim honest and in one place (no duplicated, divergent copy).
 *
 * Honesty constraint (FINAL_PRODUCT_STANDARD): state posture as it is. Do not
 * imply certifications we do not hold. The "planned" list is explicitly future.
 */

export const SECURITY_EMAIL = "security@securelogicai.com";

export const DATA_PROTECTION_ROWS: [string, string][] = [
  ["In transit", "TLS encryption for all connections including database"],
  ["At rest", "Infrastructure-provider encryption (Render, Cloudflare R2)"],
  ["Sensitive fields", "Application-layer AES-256-GCM encryption with separate keys"],
  ["Passwords", "Argon2id hashing meeting OWASP recommendations"],
  ["Audit logs", "Database-trigger-enforced immutability"],
  ["AI processing", "No customer content used for AI model training, ours or providers'"],
];

export const AUTH_ITEMS: string[] = [
  "Multi-Factor Authentication (TOTP) supported for all accounts",
  "Organization-level MFA enforcement for administrators",
  "Argon2id password hashing with reuse prevention",
  "Account lockout after 5 failed login attempts",
  "SAML-based Single Sign-On (SSO) for enterprise customers",
  "API keys are hashed at rest, revocable at any time, with optional expiration",
];

export const MONITORING_ITEMS: string[] = [
  "90+ event types tracked in immutable security audit logs",
  "Automated anomaly detection for credential stuffing and API key probing",
  "Real-time operator alerts via secure webhook for security-relevant events",
  "Application error monitoring via Sentry with sensitive data redacted before transmission",
];

export const SUBPROCESSORS: [string, string][] = [
  ["Render", "application hosting and managed databases"],
  ["Cloudflare", "content delivery, DDoS protection, object storage"],
  ["Stripe", "payment processing (PCI DSS Level 1)"],
  ["Anthropic", "large language model AI services"],
  ["OpenAI", "speech-to-text transcription"],
  ["Sentry", "application error monitoring"],
  ["Resend", "transactional email delivery"],
];

export const CURRENTLY_IN_PLACE: string[] = [
  "Multi-layer encryption (in transit, at rest, application-layer)",
  "Immutable security audit logs",
  "Multi-Factor Authentication and SSO support",
  "Automated security testing on every code change",
  "Anomaly detection and real-time operator alerting",
];

export const PLANNED_MILESTONES: string[] = [
  "Independent third-party penetration testing",
  "SOC 2 Type II attestation",
  "Documented Incident Response runbook",
  "Published Business Continuity and Disaster Recovery objectives",
  "Bug bounty program",
];

export const DISCLOSURE_COMMITMENTS: string[] = [
  "Acknowledge your report within 5 business days",
  "Provide a substantive response within 30 days",
  "Credit researchers who report responsibly (with permission)",
];
