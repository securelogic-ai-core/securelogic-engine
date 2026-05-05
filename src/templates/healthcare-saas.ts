/**
 * Healthcare SaaS industry starter template.
 *
 * Source: curation appendix (Package 5 spec, 2026-05-05). Content is
 * verbatim from the appendix — DO NOT summarize, expand, or paraphrase.
 * If something looks wrong, raise it with the operator before editing.
 *
 * needs_review entries (5):
 *   - HIPAA Security Rule (proposed-rule flux)
 *   - Washington My Health My Data Act (coverage scope unsettled)
 *   - PIPEDA healthcare context (provincial-law interaction)
 *   - MFA control (note tied to proposed 2025 rule)
 *   - 72-hour restoration target (note tied to proposed 2025 rule)
 *
 * The presence of any needs_review entry gates the entire template
 * behind SECURELOGIC_INDUSTRY_TEMPLATES_ENABLED.
 */

import { composeTemplateDescription, type Template } from "./types.js";

// Curator-authored. Counts are NOT in these strings — they're appended
// by the description getter from the array lengths at access time.
const INTRO =
  "For SaaS companies handling protected health information (PHI) — " +
  "EHR vendors, telehealth platforms, healthcare analytics, " +
  "patient engagement tools.";
const FRAMEWORKS_FOCUS = "aligned to HIPAA Security Rule";

export const HEALTHCARE_SAAS_TEMPLATE: Template = {
  id: "healthcare-saas",
  name: "Healthcare SaaS",
  // Getter: counts read from this.vendors / this.obligations / this.controls
  // every access. Cannot drift from the arrays below.
  get description(): string {
    return composeTemplateDescription({
      intro: INTRO,
      vendorCount:     this.vendors.length,
      obligationCount: this.obligations.length,
      controlCount:    this.controls.length,
      frameworksFocus: FRAMEWORKS_FOCUS,
    });
  },
  version: "1.0.1",
  last_reviewed_at: "2026-05-05",

  ai_systems: [],

  vendors: [
    // Cloud infrastructure (criticality: critical, category: cloud_infrastructure)
    {
      id: "healthcare-saas:vendor:aws",
      name: "AWS",
      criticality: "critical",
      category: "cloud_infrastructure",
      description: "Primary cloud provider; HIPAA-eligible services per BAA.",
    },
    {
      id: "healthcare-saas:vendor:microsoft-azure",
      name: "Microsoft Azure",
      criticality: "critical",
      category: "cloud_infrastructure",
      description: "Cloud platform with HIPAA-eligible services.",
    },
    {
      id: "healthcare-saas:vendor:google-cloud-platform",
      name: "Google Cloud Platform",
      criticality: "critical",
      category: "cloud_infrastructure",
      description: "Cloud platform with HIPAA-eligible services per BAA.",
    },
    {
      id: "healthcare-saas:vendor:cloudflare",
      name: "Cloudflare",
      criticality: "critical",
      category: "cloud_infrastructure",
      description: "CDN, DDoS protection, edge compute. HIPAA BAA available on enterprise tiers.",
    },

    // Healthcare-specific (criticality: high, category: healthcare_integration,
    // processes_phi: true, baa_required: true)
    {
      id: "healthcare-saas:vendor:epic",
      name: "Epic",
      criticality: "high",
      category: "healthcare_integration",
      description: "EHR platform; integration via FHIR/HL7.",
      flags: { processes_phi: true, baa_required: true },
    },
    {
      id: "healthcare-saas:vendor:oracle-health-cerner",
      name: "Oracle Health (Cerner)",
      criticality: "high",
      category: "healthcare_integration",
      description: "EHR platform; integration via FHIR/HL7.",
      flags: { processes_phi: true, baa_required: true },
    },
    {
      id: "healthcare-saas:vendor:athenahealth",
      name: "Athenahealth",
      criticality: "high",
      category: "healthcare_integration",
      description: "Cloud-based EHR and practice management.",
      flags: { processes_phi: true, baa_required: true },
    },
    {
      id: "healthcare-saas:vendor:redox",
      name: "Redox",
      criticality: "high",
      category: "healthcare_integration",
      description: "Healthcare integration platform (HL7v2, FHIR, X12).",
      flags: { processes_phi: true, baa_required: true },
    },
    {
      id: "healthcare-saas:vendor:particle-health",
      name: "Particle Health",
      criticality: "high",
      category: "healthcare_integration",
      description: "Patient data network for cross-provider record exchange.",
      flags: { processes_phi: true, baa_required: true },
    },
    {
      id: "healthcare-saas:vendor:datavant",
      name: "Datavant",
      criticality: "high",
      category: "healthcare_integration",
      description: "De-identification and tokenization for healthcare data.",
      flags: { processes_phi: true, baa_required: true },
    },

    // Identity & access (criticality: high, category: identity_management)
    {
      id: "healthcare-saas:vendor:okta",
      name: "Okta",
      criticality: "high",
      category: "identity_management",
      description: "Identity provider, SSO, MFA. HIPAA BAA available.",
    },
    {
      id: "healthcare-saas:vendor:auth0",
      name: "Auth0",
      criticality: "high",
      category: "identity_management",
      description: "Authentication-as-a-service. HIPAA BAA available.",
    },
    {
      id: "healthcare-saas:vendor:microsoft-entra-id",
      name: "Microsoft Entra ID",
      criticality: "high",
      category: "identity_management",
      description: "Identity platform (formerly Azure AD).",
    },

    // Communication (criticality: high, category: communication,
    // processes_phi: true, baa_required: true)
    {
      id: "healthcare-saas:vendor:twilio",
      name: "Twilio",
      criticality: "high",
      category: "communication",
      description: "Communications API; HIPAA-eligible products only with BAA.",
      flags: { processes_phi: true, baa_required: true },
    },
    {
      id: "healthcare-saas:vendor:sendgrid",
      name: "SendGrid",
      criticality: "high",
      category: "communication",
      description: "Email delivery; HIPAA BAA for Pro+ tiers.",
      flags: { processes_phi: true, baa_required: true },
    },
    {
      id: "healthcare-saas:vendor:postmark",
      name: "Postmark",
      criticality: "high",
      category: "communication",
      description: "Transactional email; HIPAA BAA available.",
      flags: { processes_phi: true, baa_required: true },
    },

    // Data & analytics (criticality: high, category: data_warehouse_analytics,
    // processes_phi: true, baa_required: true)
    {
      id: "healthcare-saas:vendor:snowflake",
      name: "Snowflake",
      criticality: "high",
      category: "data_warehouse_analytics",
      description: "Data warehouse; HIPAA BAA available.",
      flags: { processes_phi: true, baa_required: true },
    },
    {
      id: "healthcare-saas:vendor:databricks",
      name: "Databricks",
      criticality: "high",
      category: "data_warehouse_analytics",
      description: "Data + ML platform; HIPAA BAA available.",
      flags: { processes_phi: true, baa_required: true },
    },
    {
      id: "healthcare-saas:vendor:segment",
      name: "Segment",
      criticality: "high",
      category: "data_warehouse_analytics",
      description: "Customer data platform; HIPAA BAA available on Business tier.",
      flags: { processes_phi: true, baa_required: true },
    },
    {
      id: "healthcare-saas:vendor:mixpanel",
      name: "Mixpanel",
      criticality: "high",
      category: "data_warehouse_analytics",
      description: "Product analytics; HIPAA BAA available on Enterprise.",
      flags: { processes_phi: true, baa_required: true },
    },

    // Productivity & collaboration (criticality: high,
    // category: productivity_collaboration, processes_phi: true,
    // baa_required: true)
    {
      id: "healthcare-saas:vendor:google-workspace",
      name: "Google Workspace",
      criticality: "high",
      category: "productivity_collaboration",
      description: "Email, docs, drive. HIPAA BAA available on Business tier+.",
      flags: { processes_phi: true, baa_required: true },
    },
    {
      id: "healthcare-saas:vendor:microsoft-365",
      name: "Microsoft 365",
      criticality: "high",
      category: "productivity_collaboration",
      description: "Email, docs, drive. HIPAA BAA available.",
      flags: { processes_phi: true, baa_required: true },
    },
    {
      id: "healthcare-saas:vendor:slack",
      name: "Slack",
      criticality: "high",
      category: "productivity_collaboration",
      description: "Team messaging; HIPAA BAA available on Enterprise Grid.",
      flags: { processes_phi: true, baa_required: true },
    },
    {
      id: "healthcare-saas:vendor:zoom",
      name: "Zoom",
      criticality: "high",
      category: "productivity_collaboration",
      description: "Video conferencing; HIPAA-compliant plan required.",
      flags: { processes_phi: true, baa_required: true },
    },

    // Engineering (criticality: medium, category: engineering_tooling)
    {
      id: "healthcare-saas:vendor:github",
      name: "GitHub",
      criticality: "medium",
      category: "engineering_tooling",
      description: "Source code management.",
    },
    {
      id: "healthcare-saas:vendor:gitlab",
      name: "GitLab",
      criticality: "medium",
      category: "engineering_tooling",
      description: "Source code + CI/CD.",
    },
    {
      id: "healthcare-saas:vendor:vercel",
      name: "Vercel",
      criticality: "medium",
      category: "engineering_tooling",
      description: "Frontend hosting platform.",
    },

    // Customer support (criticality: high, category: customer_support,
    // processes_phi: true, baa_required: true)
    {
      id: "healthcare-saas:vendor:zendesk",
      name: "Zendesk",
      criticality: "high",
      category: "customer_support",
      description: "Customer support platform; HIPAA BAA available on Suite Enterprise.",
      flags: { processes_phi: true, baa_required: true },
    },
    {
      id: "healthcare-saas:vendor:intercom",
      name: "Intercom",
      criticality: "high",
      category: "customer_support",
      description: "Customer messaging; HIPAA BAA available on Premium plans.",
      flags: { processes_phi: true, baa_required: true },
    },
  ],

  obligations: [
    {
      id: "healthcare-saas:obligation:hipaa-privacy-rule",
      regulation_name: "HIPAA Privacy Rule",
      jurisdiction: "US Federal",
      priority: "immediate",
      description:
        "45 CFR Part 164 Subpart E. Establishes uses and disclosures of protected health information.",
    },
    {
      id: "healthcare-saas:obligation:hipaa-security-rule",
      regulation_name: "HIPAA Security Rule",
      jurisdiction: "US Federal",
      priority: "immediate",
      description:
        "45 CFR Part 164 Subpart C. Administrative, physical, and technical safeguards for ePHI. NOTE: Proposed update finalization expected May 2026; controls in this template reflect both current and proposed-rule requirements.",
      needs_review: true,
    },
    {
      id: "healthcare-saas:obligation:hipaa-breach-notification-rule",
      regulation_name: "HIPAA Breach Notification Rule",
      jurisdiction: "US Federal",
      priority: "immediate",
      description:
        "45 CFR Part 164 Subpart D. 60-day notification to affected individuals and HHS for breaches of unsecured PHI.",
    },
    {
      id: "healthcare-saas:obligation:hitech-act",
      regulation_name: "HITECH Act",
      jurisdiction: "US Federal",
      priority: "near_term",
      description:
        "Health Information Technology for Economic and Clinical Health Act. Strengthens HIPAA penalties and extends provisions to business associates.",
    },
    {
      id: "healthcare-saas:obligation:42-cfr-part-2",
      regulation_name: "42 CFR Part 2",
      jurisdiction: "US Federal",
      priority: "planned",
      description:
        "Confidentiality of substance use disorder patient records. Applies if handling SUD treatment records.",
    },
    {
      id: "healthcare-saas:obligation:california-cmia",
      regulation_name: "California CMIA",
      jurisdiction: "California, US",
      priority: "near_term",
      description:
        "California Confidentiality of Medical Information Act (Civil Code §§ 56-56.37).",
    },
    {
      id: "healthcare-saas:obligation:texas-medical-records-privacy-act",
      regulation_name: "Texas Medical Records Privacy Act",
      jurisdiction: "Texas, US",
      priority: "near_term",
      description:
        "Tex. Health & Safety Code Chapter 181. Texas-specific medical privacy rules.",
    },
    {
      id: "healthcare-saas:obligation:washington-my-health-my-data-act",
      regulation_name: "Washington My Health My Data Act",
      jurisdiction: "Washington, US",
      priority: "near_term",
      description:
        "Consumer health data privacy act (RCW 19.373). Coverage scope of SaaS-handled health data is unsettled.",
      needs_review: true,
    },
    {
      id: "healthcare-saas:obligation:new-york-shield-act",
      regulation_name: "New York SHIELD Act",
      jurisdiction: "New York, US",
      priority: "planned",
      description:
        "Stop Hacks and Improve Electronic Data Security Act. Reasonable security requirements for private information of NY residents.",
    },
    {
      id: "healthcare-saas:obligation:gdpr-article-9",
      regulation_name: "GDPR Article 9 (special category data)",
      jurisdiction: "European Union",
      priority: "near_term",
      description:
        "Health data is special category data under GDPR; processing requires explicit consent or other Article 9 lawful basis.",
    },
    {
      id: "healthcare-saas:obligation:uk-gdpr-dpa-2018",
      regulation_name: "UK GDPR + Data Protection Act 2018",
      jurisdiction: "United Kingdom",
      priority: "planned",
      description:
        "UK equivalent of GDPR plus DPA 2018 special category data protections.",
    },
    {
      id: "healthcare-saas:obligation:pipeda-healthcare",
      regulation_name: "PIPEDA (healthcare context)",
      jurisdiction: "Canada",
      priority: "planned",
      description:
        "Personal Information Protection and Electronic Documents Act applied to health information; interaction with provincial health privacy laws varies.",
      needs_review: true,
    },
    {
      id: "healthcare-saas:obligation:hitrust-csf-certification",
      regulation_name: "HITRUST CSF certification",
      jurisdiction: "Industry framework",
      priority: "planned",
      description:
        "Common Security Framework. Often contractually required by healthcare customers.",
    },
    {
      id: "healthcare-saas:obligation:soc2-type-ii",
      regulation_name: "SOC 2 Type II",
      jurisdiction: "Industry framework",
      priority: "near_term",
      description:
        "AICPA Trust Services Criteria for security, availability, confidentiality. Standard SaaS expectation.",
    },
  ],

  controls: [
    // Identify (NIST CSF 2.0)
    {
      id: "healthcare-saas:control:asset-inventory-ephi",
      name: "Asset inventory of systems processing ePHI",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "healthcare-saas:control:data-classification-phi",
      name: "Data classification policy distinguishing PHI from non-PHI",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "healthcare-saas:control:vendor-risk-management-baa",
      name: "Vendor risk management program with BAA tracking",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "healthcare-saas:control:annual-risk-assessment",
      name: "Annual risk assessment per Security Rule §164.308(a)(1)(ii)(A)",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "healthcare-saas:control:hipaa-privacy-officer",
      name: "Designated HIPAA Privacy Officer",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "healthcare-saas:control:hipaa-security-officer",
      name: "Designated HIPAA Security Officer",
      description: "",
      framework_ref: "nist-csf-2.0",
    },

    // Protect
    {
      id: "healthcare-saas:control:mfa-ephi",
      name: "Multi-factor authentication on all systems accessing ePHI",
      description: "Mandatory under proposed 2025 rule update.",
      framework_ref: "nist-csf-2.0",
      needs_review: true,
    },
    {
      id: "healthcare-saas:control:encryption-at-rest-ephi",
      name: "Encryption at rest for ePHI databases (AES-256 minimum)",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "healthcare-saas:control:encryption-in-transit",
      name: "Encryption in transit (TLS 1.2+)",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "healthcare-saas:control:rbac-least-privilege",
      name: "Role-based access control with least-privilege defaults",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "healthcare-saas:control:workforce-hipaa-training",
      name: "Workforce HIPAA training (annual minimum)",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "healthcare-saas:control:sanction-policy",
      name: "Sanction policy for workforce members violating policies",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "healthcare-saas:control:termination-procedures",
      name: "Termination procedures with same-day access revocation",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "healthcare-saas:control:workstation-policies",
      name: "Workstation use and security policies",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "healthcare-saas:control:device-media-controls",
      name: "Device and media controls including disposal procedures",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "healthcare-saas:control:network-segmentation-ephi",
      name: "Network segmentation isolating ePHI environments",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "healthcare-saas:control:minimum-necessary-standard",
      name: "Minimum necessary standard documentation",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "healthcare-saas:control:baa-pre-onboarding",
      name: "BAA execution required before vendor onboarding",
      description: "",
      framework_ref: "nist-csf-2.0",
    },

    // Detect
    {
      id: "healthcare-saas:control:audit-log-ephi-access",
      name: "Audit log collection on all ePHI access events",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "healthcare-saas:control:siem-ephi-alerting",
      name: "SIEM with ePHI access alerting",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "healthcare-saas:control:fim-ephi-repos",
      name: "File integrity monitoring on ePHI repositories",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "healthcare-saas:control:anomalous-access-detection",
      name: "Anomalous access detection",
      description: "",
      framework_ref: "nist-csf-2.0",
    },

    // Respond
    {
      id: "healthcare-saas:control:incident-response-plan-72h",
      name: "Incident response plan with 72-hour restoration target",
      description: "Restoration target from proposed 2025 rule.",
      framework_ref: "nist-csf-2.0",
      needs_review: true,
    },
    {
      id: "healthcare-saas:control:breach-notification-procedures",
      name: "Breach notification procedures (60-day individual, 60-day HHS, immediate media if ≥500 affected)",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "healthcare-saas:control:tabletop-exercises",
      name: "Tabletop exercises (annual)",
      description: "",
      framework_ref: "nist-csf-2.0",
    },

    // Recover
    {
      id: "healthcare-saas:control:data-backup-rto-rpo",
      name: "Data backup plan with documented RTO/RPO",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "healthcare-saas:control:disaster-recovery-plan",
      name: "Disaster recovery plan",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "healthcare-saas:control:contingency-plan-testing",
      name: "Contingency plan testing (annual)",
      description: "",
      framework_ref: "nist-csf-2.0",
    },

    // Patient rights (HIPAA Privacy Rule specific)
    {
      id: "healthcare-saas:control:patient-access-request",
      name: "Patient access request handling procedure",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "healthcare-saas:control:right-to-amend",
      name: "Right to amend procedure",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "healthcare-saas:control:accounting-of-disclosures",
      name: "Accounting of disclosures procedure",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "healthcare-saas:control:notice-of-privacy-practices",
      name: "Notice of Privacy Practices distribution",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "healthcare-saas:control:patient-complaint-handling",
      name: "Patient complaint handling procedure",
      description: "",
      framework_ref: "nist-csf-2.0",
    },

    // Documentation
    {
      id: "healthcare-saas:control:risk-analysis-documentation",
      name: "Risk analysis documentation (current)",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "healthcare-saas:control:risk-management-plan-doc",
      name: "Risk management plan documentation",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "healthcare-saas:control:info-system-activity-review",
      name: "Information system activity review documentation",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "healthcare-saas:control:sanctions-documentation",
      name: "Sanctions documentation",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "healthcare-saas:control:training-records",
      name: "Training records",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
  ],
};
