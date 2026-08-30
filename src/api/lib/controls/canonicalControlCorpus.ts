/**
 * canonicalControlCorpus.ts - the SecureLogic canonical control reference
 * content, version-controlled and reviewable.
 *
 * -- What a canonical control is, and is not -------------------------------
 *
 * A reusable ASSURANCE / CONTROL CONCEPT. It is NOT a framework requirement.
 * The relationship the owner ruling requires is many-to-many in both
 * directions:
 *
 *     Framework Requirement  <->  Canonical Control  <->  Tenant Control
 *
 * So no framework identity appears in a canonical key, and a canonical control
 * is allowed to map to no framework at all. Exactly one entry below does today:
 * `segregation-of-duties` is a real assurance concept and NIST CSF 1.1 - the
 * first proof corpus - has no requirement that is a clean one-to-one for it, so
 * it is published with no crosswalk row rather than attached to an
 * approximation. Encoding NIST CSF's shape into the corpus merely because it is
 * first is exactly what the ruling forbids. `nistCsfCrosswalk.test.ts` asserts
 * that count, so this claim cannot quietly become false.
 *
 * -- Why the {industry}:control:* slugs are aliases and not keys ------------
 *
 * `TemplateControl.id` in src/templates IS a globally stable slug. It was never
 * persisted: templateLoader writes `template_source = industryId`, which
 * records which TEMPLATE a control came from, not which CONTROL it is. Those
 * slugs are retained here as ALIASES so their historical meaning survives
 * canonicalization, and they are NOT adopted as canonical keys because they are
 * industry-scoped and cannot express a control that belongs to no industry.
 *
 * -- Aliases are curated, not exhaustive -----------------------------------
 *
 * 115 template controls exist. Far fewer are aliased here, and that is the
 * point: the owner ruling forbids manufacturing false canonical mappings.
 * Where a template control spans two canonical concepts
 * (`b2b-ai:control:data-encryption-at-rest-in-transit` covers both at-rest and
 * in-transit encryption), it is deliberately left unaliased rather than
 * arbitrarily attached to one of them - an alias resolves to exactly ONE
 * canonical control, so a genuine one-to-two is not representable as an alias
 * and must not be faked as one. An unaliased template control is a
 * template-derived tenant control with no canonical identity, which is a
 * representable, legitimate state.
 *
 * -- Publication ------------------------------------------------------------
 *
 * Nothing here is authoritative until it is PUBLISHED into `canonical_controls`
 * by a named human, through scripts/publish-canonical-controls.ts. This module
 * is the reviewable source; the database row carries the governance act.
 */

import type { CanonicalControlAliasScheme } from "./canonicalControlIdentity.js";

/** Labels this curation pass. Written to crosswalk rows as `mapping_version`. */
export const CANONICAL_CONTROL_CORPUS_VERSION = "2026.08.1";

export type CanonicalControlAliasDefinition = {
  readonly alias_key: string;
  readonly alias_scheme: CanonicalControlAliasScheme;
};

export type CanonicalControlDefinition = {
  /** Appended to `securelogic:control:` to form the canonical key. */
  readonly slug: string;
  readonly display_name: string;
  readonly description: string;
  /**
   * Free text, mirroring `controls.control_family`, which has no CHECK. A
   * closed family vocabulary is a separate curation decision and is not
   * invented here to look tidy.
   */
  readonly control_family: string;
  readonly aliases: readonly CanonicalControlAliasDefinition[];
};

const T = "industry_template" as const;

export const CANONICAL_CONTROL_CORPUS: readonly CanonicalControlDefinition[] = [
  // ---- Governance ---------------------------------------------------------
  {
    slug: "security-policy-program",
    display_name: "Information security policy and programme",
    description:
      "A documented, leadership-approved information security policy and the governing programme that maintains it, communicates it, and reviews it on a defined cadence.",
    control_family: "Governance",
    aliases: [{ alias_key: "fintech:control:glba-isp-doc", alias_scheme: T }],
  },
  {
    slug: "security-roles-and-responsibilities",
    display_name: "Defined security roles and accountability",
    description:
      "Named accountability for security: defined roles, documented responsibilities, and a reporting line that reaches leadership. Covers both internal roles and the roles asserted in agreements with third parties.",
    control_family: "Governance",
    aliases: [
      { alias_key: "healthcare-saas:control:hipaa-security-officer", alias_scheme: T },
      { alias_key: "healthcare-saas:control:hipaa-privacy-officer", alias_scheme: T },
      { alias_key: "fintech:control:ciso-board-reporting", alias_scheme: T },
    ],
  },
  {
    slug: "legal-and-regulatory-obligation-register",
    display_name: "Legal and regulatory obligation register",
    description:
      "A maintained register of the laws, regulations and contractual obligations that bear on security and privacy, including which of them apply and why.",
    control_family: "Governance",
    aliases: [],
  },

  // ---- Risk ---------------------------------------------------------------
  {
    slug: "risk-assessment-programme",
    display_name: "Risk assessment programme",
    description:
      "A repeatable process that identifies threats and vulnerabilities, analyses likelihood and impact, and produces a reviewed risk register on a defined cadence.",
    control_family: "Risk management",
    aliases: [
      { alias_key: "healthcare-saas:control:annual-risk-assessment", alias_scheme: T },
      { alias_key: "healthcare-saas:control:risk-analysis-documentation", alias_scheme: T },
      { alias_key: "fintech:control:annual-cyber-risk-assessment", alias_scheme: T },
    ],
  },
  {
    slug: "risk-treatment-and-response",
    display_name: "Risk treatment and response",
    description:
      "Identified risks receive a decided response - mitigate, transfer, avoid or accept - with an owner, a target date and a governed acceptance path for the risks not treated.",
    control_family: "Risk management",
    aliases: [{ alias_key: "healthcare-saas:control:risk-management-plan-doc", alias_scheme: T }],
  },
  {
    slug: "threat-intelligence-consumption",
    display_name: "Threat intelligence consumption",
    description:
      "External threat and vulnerability intelligence is received from defined sources and routed to the people and processes that can act on it.",
    control_family: "Risk management",
    aliases: [],
  },
  {
    slug: "vulnerability-identification",
    display_name: "Vulnerability identification and testing",
    description:
      "Technical weaknesses are actively looked for - vulnerability scanning, penetration testing and equivalent assessment - on a defined cadence, with results tracked to remediation.",
    control_family: "Threat and vulnerability management",
    aliases: [
      { alias_key: "fintech:control:asv-scans", alias_scheme: T },
      { alias_key: "fintech:control:annual-pen-test", alias_scheme: T },
      { alias_key: "fintech:control:dfs-pen-test-vuln-assess", alias_scheme: T },
    ],
  },

  // ---- Asset management ---------------------------------------------------
  {
    slug: "hardware-asset-inventory",
    display_name: "Hardware and device inventory",
    description:
      "A maintained inventory of physical devices and systems, sufficient to tell what must be protected and to surface unknown or unauthorised devices.",
    control_family: "Asset management",
    aliases: [{ alias_key: "healthcare-saas:control:asset-inventory-ephi", alias_scheme: T }],
  },
  {
    slug: "software-asset-inventory",
    display_name: "Software and platform inventory",
    description:
      "A maintained inventory of software, platforms, applications and cloud services in use, sufficient to reason about vulnerability exposure and unauthorised installation.",
    control_family: "Asset management",
    aliases: [],
  },
  {
    slug: "data-flow-mapping",
    display_name: "Data flow mapping",
    description:
      "Documented mapping of how information moves between systems, business processes and external parties, sufficient to locate where sensitive data is exposed.",
    control_family: "Asset management",
    aliases: [],
  },
  {
    slug: "external-system-inventory",
    display_name: "External system and dependency inventory",
    description:
      "A catalogue of external systems, providers and interfaces the organisation depends on or connects to, including the dependency each one creates.",
    control_family: "Asset management",
    aliases: [],
  },
  {
    slug: "asset-criticality-classification",
    display_name: "Asset and data classification",
    description:
      "Systems and data are classified by criticality and sensitivity so that protection and investment can be prioritised rather than applied uniformly.",
    control_family: "Asset management",
    aliases: [{ alias_key: "healthcare-saas:control:data-classification-phi", alias_scheme: T }],
  },

  // ---- Resilience ---------------------------------------------------------
  {
    slug: "business-impact-analysis",
    display_name: "Business impact analysis",
    description:
      "Analysis of which business functions are critical, what they depend on, and what the impact of their disruption would be - including single points of failure.",
    control_family: "Resilience",
    aliases: [],
  },
  {
    slug: "business-continuity-plan",
    display_name: "Business continuity planning and testing",
    description:
      "A documented continuity plan with defined recovery objectives and minimum viable operations, exercised on a defined cadence rather than assumed to work.",
    control_family: "Resilience",
    aliases: [
      { alias_key: "healthcare-saas:control:contingency-plan-testing", alias_scheme: T },
      { alias_key: "healthcare-saas:control:tabletop-exercises", alias_scheme: T },
    ],
  },
  {
    slug: "backup-and-restore",
    display_name: "Backup and restoration",
    description:
      "Backups are taken to a defined schedule, protected against the failure they insure against, and periodically restored to prove they work.",
    control_family: "Resilience",
    aliases: [{ alias_key: "healthcare-saas:control:data-backup-rto-rpo", alias_scheme: T }],
  },
  {
    slug: "capacity-management",
    display_name: "Capacity management",
    description:
      "Capacity is monitored and planned against availability commitments, with alerting on resource thresholds before demand exceeds supply.",
    control_family: "Resilience",
    aliases: [],
  },
  {
    slug: "disaster-recovery-execution",
    display_name: "Disaster recovery execution",
    description:
      "A recovery plan that is executed during and after a disruptive event, restoring affected systems to a known state within the defined objectives.",
    control_family: "Resilience",
    aliases: [{ alias_key: "healthcare-saas:control:disaster-recovery-plan", alias_scheme: T }],
  },

  // ---- Identity and access ------------------------------------------------
  {
    slug: "identity-lifecycle-management",
    display_name: "Identity lifecycle management",
    description:
      "Identities and credentials are issued, managed, changed and revoked through a defined lifecycle, with prompt revocation on role change and departure.",
    control_family: "Identity and access management",
    aliases: [{ alias_key: "healthcare-saas:control:termination-procedures", alias_scheme: T }],
  },
  {
    slug: "multi-factor-authentication",
    display_name: "Multi-factor authentication",
    description:
      "Authentication to systems holding or reaching sensitive data requires more than a single factor, including for remote and administrative access.",
    control_family: "Identity and access management",
    aliases: [
      { alias_key: "healthcare-saas:control:mfa-ephi", alias_scheme: T },
      { alias_key: "fintech:control:dfs-mfa-npi", alias_scheme: T },
    ],
  },
  {
    slug: "access-authorization-and-review",
    display_name: "Access authorisation and periodic review",
    description:
      "Access is granted on least privilege against an approved authorisation, and is re-reviewed on a defined cadence rather than accumulating silently.",
    control_family: "Identity and access management",
    aliases: [
      { alias_key: "healthcare-saas:control:rbac-least-privilege", alias_scheme: T },
      { alias_key: "healthcare-saas:control:minimum-necessary-standard", alias_scheme: T },
      { alias_key: "fintech:control:dfs-access-privileges-review", alias_scheme: T },
      { alias_key: "fintech:control:cde-need-to-know-access", alias_scheme: T },
      { alias_key: "b2b-ai:control:training-dataset-access-controls", alias_scheme: T },
    ],
  },
  {
    slug: "privileged-access-management",
    display_name: "Privileged access management",
    description:
      "Administrative and other privileged access is separately identified, restricted, monitored, and held by people who understand the responsibility it carries.",
    control_family: "Identity and access management",
    aliases: [],
  },
  {
    slug: "remote-access-control",
    display_name: "Remote access control",
    description:
      "Remote access to internal systems is managed: authorised, authenticated, protected in transit, and terminated when no longer needed.",
    control_family: "Identity and access management",
    aliases: [],
  },
  {
    slug: "physical-access-control",
    display_name: "Physical access control and monitoring",
    description:
      "Physical access to facilities and equipment is restricted to authorised people and monitored, including the detection of unauthorised personnel and devices.",
    control_family: "Physical security",
    aliases: [],
  },
  {
    slug: "segregation-of-duties",
    display_name: "Segregation of duties",
    description:
      "Activities whose combination would let one person both initiate and approve a consequential action are separated, or compensated for by dual approval.",
    control_family: "Governance",
    aliases: [
      { alias_key: "fintech:control:segregation-of-duties", alias_scheme: T },
      { alias_key: "fintech:control:dual-approval-funds-movement", alias_scheme: T },
    ],
  },

  // ---- Data protection ----------------------------------------------------
  {
    slug: "network-segmentation-and-integrity",
    display_name: "Network segmentation and integrity",
    description:
      "Network integrity is protected through segmentation and equivalent isolation, so that sensitive environments are not reachable flat from the rest of the estate.",
    control_family: "Network security",
    aliases: [
      { alias_key: "fintech:control:network-segmentation-cde", alias_scheme: T },
      { alias_key: "healthcare-saas:control:network-segmentation-ephi", alias_scheme: T },
    ],
  },
  {
    slug: "encryption-at-rest",
    display_name: "Encryption of data at rest",
    description:
      "Sensitive data is encrypted where it is stored, with key management appropriate to the sensitivity of what it protects.",
    control_family: "Data protection",
    aliases: [{ alias_key: "healthcare-saas:control:encryption-at-rest-ephi", alias_scheme: T }],
  },
  {
    slug: "encryption-in-transit",
    display_name: "Encryption of data in transit",
    description:
      "Sensitive data is encrypted while moving between systems and to external parties, using current protocol versions and validated configuration.",
    control_family: "Data protection",
    aliases: [{ alias_key: "healthcare-saas:control:encryption-in-transit", alias_scheme: T }],
  },
  {
    slug: "media-sanitisation-and-disposal",
    display_name: "Media sanitisation and disposal",
    description:
      "Assets and media are sanitised or destroyed when removed from service or when retention ends, so that data cannot be recovered from them.",
    control_family: "Data protection",
    aliases: [
      { alias_key: "healthcare-saas:control:device-media-controls", alias_scheme: T },
      { alias_key: "fintech:control:secure-cardholder-data-deletion", alias_scheme: T },
    ],
  },
  {
    slug: "data-loss-prevention",
    display_name: "Data loss prevention",
    description:
      "Controls that detect or prevent sensitive data leaving the environment through unsanctioned channels.",
    control_family: "Data protection",
    aliases: [],
  },

  // ---- Secure operations --------------------------------------------------
  {
    slug: "secure-baseline-configuration",
    display_name: "Secure baseline configuration and integrity",
    description:
      "A defined secure baseline exists for systems, and deviation from it is detected - including through file and configuration integrity monitoring.",
    control_family: "Secure configuration",
    aliases: [
      { alias_key: "fintech:control:fim-cde", alias_scheme: T },
      { alias_key: "healthcare-saas:control:fim-ephi-repos", alias_scheme: T },
    ],
  },
  {
    slug: "change-management",
    display_name: "Change management",
    description:
      "Changes to production systems are requested, assessed, tested, approved and verified, so that unauthorised or untested change cannot reach production.",
    control_family: "Secure configuration",
    aliases: [],
  },
  {
    slug: "secure-development-lifecycle",
    display_name: "Secure development lifecycle",
    description:
      "Security is built into how systems are designed, built, tested and released, rather than assessed only after the fact.",
    control_family: "Secure development",
    aliases: [],
  },
  {
    slug: "malware-protection",
    display_name: "Malicious and unauthorised code protection",
    description:
      "Malicious code is prevented, detected and removed, and the execution of unauthorised code and applications is detected.",
    control_family: "Endpoint and workload protection",
    aliases: [],
  },

  // ---- Awareness ----------------------------------------------------------
  {
    slug: "security-awareness-training",
    display_name: "Security awareness and role-based training",
    description:
      "Personnel are trained on their security responsibilities on a defined cadence, with additional training for roles that carry elevated responsibility, and records retained.",
    control_family: "People",
    aliases: [
      { alias_key: "healthcare-saas:control:workforce-hipaa-training", alias_scheme: T },
      { alias_key: "healthcare-saas:control:training-records", alias_scheme: T },
    ],
  },

  // ---- Detection ----------------------------------------------------------
  {
    slug: "security-event-logging",
    display_name: "Security event logging",
    description:
      "Security-relevant events are logged from defined sources, retained for a defined period, and protected from alteration.",
    control_family: "Detection",
    aliases: [
      { alias_key: "healthcare-saas:control:audit-log-ephi-access", alias_scheme: T },
      { alias_key: "fintech:control:dfs-audit-trail-5y", alias_scheme: T },
      { alias_key: "b2b-ai:control:audit-logging-model-access", alias_scheme: T },
    ],
  },
  {
    slug: "network-monitoring",
    display_name: "Network monitoring against a known baseline",
    description:
      "Network operations and expected data flows are baselined, and the network is monitored against that baseline to surface anomalous activity.",
    control_family: "Detection",
    aliases: [],
  },
  {
    slug: "security-event-analysis-and-triage",
    display_name: "Security event analysis and triage",
    description:
      "Detected events and alerts are analysed against defined criteria to decide whether they represent a real threat, and escalated rather than auto-closed.",
    control_family: "Detection",
    aliases: [
      { alias_key: "healthcare-saas:control:siem-ephi-alerting", alias_scheme: T },
      { alias_key: "healthcare-saas:control:info-system-activity-review", alias_scheme: T },
    ],
  },
  {
    slug: "insider-activity-monitoring",
    display_name: "Personnel and insider activity monitoring",
    description:
      "Personnel activity is monitored for anomalous or unauthorised access patterns, within the bounds of the applicable privacy obligations.",
    control_family: "Detection",
    aliases: [{ alias_key: "healthcare-saas:control:anomalous-access-detection", alias_scheme: T }],
  },
  {
    slug: "third-party-activity-monitoring",
    display_name: "Third-party activity monitoring",
    description:
      "The activity of external service providers within the environment is monitored, not merely contracted for.",
    control_family: "Third-party risk",
    aliases: [],
  },
  {
    slug: "third-party-risk-management",
    display_name: "Third-party risk management",
    description:
      "Third parties are assessed before onboarding and reassessed on a defined cadence, with security obligations carried into the agreement and dependencies tracked.",
    control_family: "Third-party risk",
    aliases: [
      { alias_key: "healthcare-saas:control:vendor-risk-management-baa", alias_scheme: T },
      { alias_key: "healthcare-saas:control:baa-pre-onboarding", alias_scheme: T },
      { alias_key: "fintech:control:dfs-third-party-assessment", alias_scheme: T },
      { alias_key: "b2b-ai:control:foundation-model-vendor-dd", alias_scheme: T },
      { alias_key: "b2b-ai:control:vendor-model-dependency-tracking", alias_scheme: T },
    ],
  },

  // ---- Response -----------------------------------------------------------
  {
    slug: "incident-response-plan",
    display_name: "Incident response plan and roles",
    description:
      "A documented incident response plan with assigned roles that is executed during an incident, and which the people named in it know they hold.",
    control_family: "Incident response",
    aliases: [
      { alias_key: "healthcare-saas:control:incident-response-plan-72h", alias_scheme: T },
      { alias_key: "fintech:control:irp-regulatory-timelines", alias_scheme: T },
      { alias_key: "b2b-ai:control:ai-incident-response", alias_scheme: T },
    ],
  },
  {
    slug: "incident-reporting-and-escalation",
    display_name: "Incident reporting and external notification",
    description:
      "Incidents are reported internally against defined criteria and notified externally within the applicable regulatory and contractual timelines.",
    control_family: "Incident response",
    aliases: [
      { alias_key: "healthcare-saas:control:breach-notification-procedures", alias_scheme: T },
      { alias_key: "fintech:control:dfs-incident-72h", alias_scheme: T },
      { alias_key: "b2b-ai:control:serious-incident-reporting", alias_scheme: T },
    ],
  },
  {
    slug: "incident-containment",
    display_name: "Incident containment",
    description:
      "Confirmed incidents are contained to limit spread and further impact, using pre-considered containment options rather than improvised ones.",
    control_family: "Incident response",
    aliases: [],
  },
  {
    slug: "incident-mitigation-and-remediation",
    display_name: "Incident mitigation and remediation",
    description:
      "Incidents are mitigated, root cause is established, and corrective action is tracked to closure so that the same failure does not recur.",
    control_family: "Incident response",
    aliases: [],
  },
  {
    slug: "recovery-communications",
    display_name: "Recovery communications",
    description:
      "Recovery activities are communicated to internal and external stakeholders, including public and reputational communications where the event warrants them.",
    control_family: "Resilience",
    aliases: [],
  },
] as const;
