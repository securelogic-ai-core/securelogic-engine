/**
 * Financial Services Fintech industry starter template.
 *
 * Source: curation appendix (Package 5 spec, 2026-05-05). Verbatim.
 *
 * Curation notes encoded:
 *   - Sardine appears once with combined KYC + Fraud description
 *     (appendix instructed "handle dedup by listing once with combined
 *     description").
 *   - Synapse retained as historical reference with needs_review:true
 *     (filed bankruptcy 2024; kept for due-diligence questionnaire
 *     response).
 *   - Multi-state NMLS obligation flagged needs_review (per-state
 *     granularity is the customer's call).
 */

import { composeTemplateDescription, type Template } from "./types.js";

// Curator-authored. Counts are NOT in these strings — they're appended
// by the description getter from the array lengths at access time.
const INTRO =
  "For fintech companies — payments, lending, neobanks, wealth management, " +
  "crypto on/off-ramps.";
const FRAMEWORKS_FOCUS =
  "aligned to PCI-DSS, SOX, and money-transmitter requirements";

export const FINTECH_TEMPLATE: Template = {
  id: "fintech",
  name: "Financial Services Fintech",
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
    // Cloud (criticality: critical)
    {
      id: "fintech:vendor:aws",
      name: "AWS",
      criticality: "critical",
      category: "cloud_infrastructure",
      description: "Cloud infrastructure provider.",
    },
    {
      id: "fintech:vendor:microsoft-azure",
      name: "Microsoft Azure",
      criticality: "critical",
      category: "cloud_infrastructure",
      description: "Cloud infrastructure provider.",
    },
    {
      id: "fintech:vendor:google-cloud-platform",
      name: "Google Cloud Platform",
      criticality: "critical",
      category: "cloud_infrastructure",
      description: "Cloud infrastructure provider.",
    },
    {
      id: "fintech:vendor:cloudflare",
      name: "Cloudflare",
      criticality: "critical",
      category: "cloud_infrastructure",
      description: "CDN, DDoS protection, edge compute.",
    },

    // Payments (criticality: critical, processes_payment_data: true)
    {
      id: "fintech:vendor:stripe",
      name: "Stripe",
      criticality: "critical",
      category: "payments",
      description: "Payments platform.",
      flags: { processes_payment_data: true },
    },
    {
      id: "fintech:vendor:adyen",
      name: "Adyen",
      criticality: "critical",
      category: "payments",
      description: "Payments platform.",
      flags: { processes_payment_data: true },
    },
    {
      id: "fintech:vendor:plaid",
      name: "Plaid",
      criticality: "critical",
      category: "payments",
      description: "Bank account connectivity / data network.",
      flags: { processes_payment_data: true },
    },
    {
      id: "fintech:vendor:marqeta",
      name: "Marqeta",
      criticality: "critical",
      category: "payments",
      description: "Card issuing platform.",
      flags: { processes_payment_data: true },
    },
    {
      id: "fintech:vendor:modern-treasury",
      name: "Modern Treasury",
      criticality: "critical",
      category: "payments",
      description: "Payment operations platform.",
      flags: { processes_payment_data: true },
    },
    {
      id: "fintech:vendor:dwolla",
      name: "Dwolla",
      criticality: "critical",
      category: "payments",
      description: "ACH payment platform.",
      flags: { processes_payment_data: true },
    },
    {
      id: "fintech:vendor:wise",
      name: "Wise",
      criticality: "critical",
      category: "payments",
      description: "International transfers.",
      flags: { processes_payment_data: true },
    },

    // Banking-as-a-service (criticality: critical)
    {
      id: "fintech:vendor:unit",
      name: "Unit",
      criticality: "critical",
      category: "banking_as_a_service",
      description: "Banking-as-a-service platform.",
    },
    {
      id: "fintech:vendor:treasury-prime",
      name: "Treasury Prime",
      criticality: "critical",
      category: "banking_as_a_service",
      description: "Banking-as-a-service platform.",
    },
    {
      id: "fintech:vendor:column",
      name: "Column",
      criticality: "critical",
      category: "banking_as_a_service",
      description: "Nationally chartered bank with developer API.",
    },
    {
      id: "fintech:vendor:synapse",
      name: "Synapse",
      criticality: "critical",
      category: "banking_as_a_service",
      description:
        "Historical reference; filed bankruptcy 2024. Inventory entry retained for due-diligence questionnaire response only.",
      needs_review: true,
    },

    // KYC/AML (criticality: high, category: identity_compliance).
    // Sardine appears in both KYC and Fraud sections of the appendix;
    // collapsed here per the appendix dedup instruction.
    {
      id: "fintech:vendor:persona",
      name: "Persona",
      criticality: "high",
      category: "identity_compliance",
      description: "KYC / identity verification platform.",
    },
    {
      id: "fintech:vendor:alloy",
      name: "Alloy",
      criticality: "high",
      category: "identity_compliance",
      description: "Identity decisioning platform.",
    },
    {
      id: "fintech:vendor:sardine",
      name: "Sardine",
      criticality: "high",
      category: "identity_compliance",
      description: "Fraud + KYC/AML risk platform.",
    },
    {
      id: "fintech:vendor:complyadvantage",
      name: "ComplyAdvantage",
      criticality: "high",
      category: "identity_compliance",
      description: "AML data and screening.",
    },
    {
      id: "fintech:vendor:chainalysis",
      name: "Chainalysis",
      criticality: "high",
      category: "identity_compliance",
      description: "Blockchain analytics for AML and sanctions screening.",
    },

    // Identity (criticality: high)
    {
      id: "fintech:vendor:okta",
      name: "Okta",
      criticality: "high",
      category: "identity_management",
      description: "Identity provider, SSO, MFA.",
    },
    {
      id: "fintech:vendor:auth0",
      name: "Auth0",
      criticality: "high",
      category: "identity_management",
      description: "Authentication-as-a-service.",
    },
    {
      id: "fintech:vendor:onfido",
      name: "Onfido",
      criticality: "high",
      category: "identity_management",
      description: "Identity verification (document + biometric).",
    },
    {
      id: "fintech:vendor:jumio",
      name: "Jumio",
      criticality: "high",
      category: "identity_management",
      description: "Identity verification (document + biometric).",
    },

    // Fraud (criticality: high). Sardine intentionally not listed here —
    // see KYC/AML section.
    {
      id: "fintech:vendor:sift",
      name: "Sift",
      criticality: "high",
      category: "fraud",
      description: "Digital trust & safety / fraud prevention.",
    },
    {
      id: "fintech:vendor:forter",
      name: "Forter",
      criticality: "high",
      category: "fraud",
      description: "Real-time fraud prevention.",
    },

    // Data & analytics (criticality: high)
    {
      id: "fintech:vendor:snowflake",
      name: "Snowflake",
      criticality: "high",
      category: "data_warehouse_analytics",
      description: "Data warehouse.",
    },
    {
      id: "fintech:vendor:databricks",
      name: "Databricks",
      criticality: "high",
      category: "data_warehouse_analytics",
      description: "Data + ML platform.",
    },
    {
      id: "fintech:vendor:segment",
      name: "Segment",
      criticality: "high",
      category: "data_warehouse_analytics",
      description: "Customer data platform.",
    },
    {
      id: "fintech:vendor:amplitude",
      name: "Amplitude",
      criticality: "high",
      category: "data_warehouse_analytics",
      description: "Product analytics.",
    },

    // Communication (criticality: medium)
    {
      id: "fintech:vendor:twilio",
      name: "Twilio",
      criticality: "medium",
      category: "communication",
      description: "Communications API (SMS, voice).",
    },
    {
      id: "fintech:vendor:sendgrid",
      name: "SendGrid",
      criticality: "medium",
      category: "communication",
      description: "Email delivery.",
    },

    // Productivity (criticality: medium)
    {
      id: "fintech:vendor:google-workspace",
      name: "Google Workspace",
      criticality: "medium",
      category: "productivity_collaboration",
      description: "Email, docs, drive.",
    },
    {
      id: "fintech:vendor:microsoft-365",
      name: "Microsoft 365",
      criticality: "medium",
      category: "productivity_collaboration",
      description: "Email, docs, drive.",
    },
    {
      id: "fintech:vendor:slack",
      name: "Slack",
      criticality: "medium",
      category: "productivity_collaboration",
      description: "Team messaging.",
    },
    {
      id: "fintech:vendor:zoom",
      name: "Zoom",
      criticality: "medium",
      category: "productivity_collaboration",
      description: "Video conferencing.",
    },

    // Engineering (criticality: medium)
    {
      id: "fintech:vendor:github",
      name: "GitHub",
      criticality: "medium",
      category: "engineering_tooling",
      description: "Source code management.",
    },
    {
      id: "fintech:vendor:vercel",
      name: "Vercel",
      criticality: "medium",
      category: "engineering_tooling",
      description: "Frontend hosting platform.",
    },
    {
      id: "fintech:vendor:datadog",
      name: "Datadog",
      criticality: "medium",
      category: "engineering_tooling",
      description: "Observability platform.",
    },
  ],

  obligations: [
    {
      id: "fintech:obligation:bsa-aml",
      regulation_name: "Bank Secrecy Act / AML",
      jurisdiction: "US Federal",
      priority: "immediate",
      description:
        "31 USC 5311 et seq. Customer identification, suspicious activity reporting, recordkeeping for financial institutions.",
    },
    {
      id: "fintech:obligation:sox",
      regulation_name: "Sarbanes-Oxley Act",
      jurisdiction: "US Federal",
      priority: "planned",
      description:
        "Applies if public or planning IPO. Internal controls over financial reporting (Section 404).",
    },
    {
      id: "fintech:obligation:glba",
      regulation_name: "Gramm-Leach-Bliley Act (GLBA)",
      jurisdiction: "US Federal",
      priority: "immediate",
      description:
        "Safeguards Rule and Privacy Rule for nonpublic personal information of consumers.",
    },
    {
      id: "fintech:obligation:tila",
      regulation_name: "Truth in Lending Act (TILA)",
      jurisdiction: "US Federal",
      priority: "near_term",
      description:
        "Applies if extending credit. Disclosure requirements under 15 USC 1601.",
    },
    {
      id: "fintech:obligation:ecoa",
      regulation_name: "Equal Credit Opportunity Act (ECOA)",
      jurisdiction: "US Federal",
      priority: "near_term",
      description:
        "15 USC 1691. Prohibits discrimination in credit decisions; adverse action notice requirements.",
    },
    {
      id: "fintech:obligation:fcra",
      regulation_name: "Fair Credit Reporting Act (FCRA)",
      jurisdiction: "US Federal",
      priority: "near_term",
      description:
        "15 USC 1681. Credit reporting agency requirements and consumer rights.",
    },
    {
      id: "fintech:obligation:efta-reg-e",
      regulation_name: "Electronic Fund Transfer Act / Regulation E",
      jurisdiction: "US Federal",
      priority: "near_term",
      description:
        "12 CFR 1005. Consumer protections for electronic fund transfers.",
    },
    {
      id: "fintech:obligation:cfpb-udaap",
      regulation_name: "CFPB UDAAP",
      jurisdiction: "US Federal",
      priority: "immediate",
      description:
        "Unfair, Deceptive, or Abusive Acts or Practices. Ongoing examination standard.",
    },
    {
      id: "fintech:obligation:ny-dfs-part-504",
      regulation_name: "NY DFS Part 504 (AML Transaction Monitoring)",
      jurisdiction: "New York, US",
      priority: "immediate",
      description:
        "23 NYCRR 504. Annual senior-officer certification of transaction monitoring and filtering programs.",
    },
    {
      id: "fintech:obligation:ny-dfs-23-nycrr-500",
      regulation_name: "NY DFS 23 NYCRR 500 (Cybersecurity Regulation)",
      jurisdiction: "New York, US",
      priority: "immediate",
      description:
        "Comprehensive cybersecurity program requirements for covered financial entities.",
    },
    {
      id: "fintech:obligation:california-money-transmission-act",
      regulation_name: "California Money Transmission Act",
      jurisdiction: "California, US",
      priority: "near_term",
      description:
        "Cal. Financial Code § 2000 et seq. Money transmitter licensing in California.",
    },
    {
      id: "fintech:obligation:state-money-transmitter-nmls",
      regulation_name: "State money transmitter licensing (multi-state NMLS)",
      jurisdiction: "Multiple US states",
      priority: "near_term",
      description:
        "Operating nationally requires licensing in 49+ states plus DC. Customer should expand into per-state rows for active operating states.",
      needs_review: true,
    },
    {
      id: "fintech:obligation:pci-dss-v4-0-1",
      regulation_name: "PCI-DSS v4.0.1",
      jurisdiction: "Industry framework",
      priority: "immediate",
      description:
        "Payment Card Industry Data Security Standard. Required if storing, processing, or transmitting cardholder data. Effective March 2024.",
    },
    {
      id: "fintech:obligation:psd2",
      regulation_name: "PSD2",
      jurisdiction: "European Union",
      priority: "planned",
      description:
        "Revised Payment Services Directive. Applies if EU operations or serving EU customers.",
    },
    {
      id: "fintech:obligation:gdpr",
      regulation_name: "GDPR",
      jurisdiction: "European Union",
      priority: "near_term",
      description:
        "General Data Protection Regulation. Applies broadly to any processing of EU resident personal data.",
    },
    {
      id: "fintech:obligation:soc2-type-ii",
      regulation_name: "SOC 2 Type II",
      jurisdiction: "Industry framework",
      priority: "immediate",
      description:
        "AICPA Trust Services Criteria. Standard enterprise SaaS expectation.",
    },
  ],

  controls: [
    // Cardholder data environment (PCI-DSS v4.0.1)
    {
      id: "fintech:control:network-segmentation-cde",
      name: "Network segmentation isolating CDE",
      description: "",
      framework_ref: "pci-dss-4.0.1",
    },
    {
      id: "fintech:control:tokenization-pan",
      name: "Tokenization of PAN at point of capture",
      description: "",
      framework_ref: "pci-dss-4.0.1",
    },
    {
      id: "fintech:control:asv-scans",
      name: "Quarterly external vulnerability scans by ASV",
      description: "",
      framework_ref: "pci-dss-4.0.1",
    },
    {
      id: "fintech:control:annual-pen-test",
      name: "Annual penetration testing",
      description: "",
      framework_ref: "pci-dss-4.0.1",
    },
    {
      id: "fintech:control:fim-cde",
      name: "File integrity monitoring on CDE systems",
      description: "",
      framework_ref: "pci-dss-4.0.1",
    },
    {
      id: "fintech:control:cde-need-to-know-access",
      name: "Restricted access to cardholder data on need-to-know basis",
      description: "",
      framework_ref: "pci-dss-4.0.1",
    },
    {
      id: "fintech:control:pan-masking",
      name: "PAN masking when displayed",
      description: "",
      framework_ref: "pci-dss-4.0.1",
    },
    {
      id: "fintech:control:secure-cardholder-data-deletion",
      name: "Secure deletion of cardholder data per retention policy",
      description: "",
      framework_ref: "pci-dss-4.0.1",
    },

    // AML/KYC (BSA/AML)
    {
      id: "fintech:control:cip",
      name: "Customer Identification Program (CIP)",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "fintech:control:cdd-beneficial-ownership",
      name: "Customer Due Diligence (CDD) including beneficial ownership",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "fintech:control:edd-high-risk",
      name: "Enhanced Due Diligence (EDD) for high-risk customers",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "fintech:control:ofac-onboarding-screening",
      name: "OFAC / sanctions screening at onboarding",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "fintech:control:ofac-ongoing-screening",
      name: "Ongoing OFAC / sanctions screening (real-time or daily batch)",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "fintech:control:transaction-monitoring",
      name: "Transaction monitoring with suspicious activity rules",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "fintech:control:sar-filing-procedures",
      name: "SAR (Suspicious Activity Report) filing procedures",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "fintech:control:ctr-filing",
      name: "CTR (Currency Transaction Report) for >$10K cash",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "fintech:control:aml-training",
      name: "AML training program (annual)",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "fintech:control:aml-officer",
      name: "Designated AML Compliance Officer / BSA Officer",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "fintech:control:aml-program-testing",
      name: "Independent AML program testing (annual or biennial)",
      description: "",
      framework_ref: "nist-csf-2.0",
    },

    // NY DFS 23 NYCRR 500
    {
      id: "fintech:control:ciso-board-reporting",
      name: "CISO appointment with annual board reporting",
      description: "",
      framework_ref: "ny-dfs-23-nycrr-500",
    },
    {
      id: "fintech:control:annual-cyber-risk-assessment",
      name: "Annual cybersecurity risk assessment",
      description: "",
      framework_ref: "ny-dfs-23-nycrr-500",
    },
    {
      id: "fintech:control:dfs-pen-test-vuln-assess",
      name: "Penetration testing (annual) and vulnerability assessments (biannual)",
      description: "",
      framework_ref: "ny-dfs-23-nycrr-500",
    },
    {
      id: "fintech:control:dfs-encryption-npi",
      name: "Encryption of nonpublic information in transit and at rest",
      description: "",
      framework_ref: "ny-dfs-23-nycrr-500",
    },
    {
      id: "fintech:control:dfs-access-privileges-review",
      name: "Access privileges with annual review",
      description: "",
      framework_ref: "ny-dfs-23-nycrr-500",
    },
    {
      id: "fintech:control:dfs-mfa-npi",
      name: "Multi-factor authentication for nonpublic info access",
      description: "",
      framework_ref: "ny-dfs-23-nycrr-500",
    },
    {
      id: "fintech:control:dfs-audit-trail-5y",
      name: "Audit trail with 5-year retention for capital markets activity",
      description: "",
      framework_ref: "ny-dfs-23-nycrr-500",
    },
    {
      id: "fintech:control:dfs-incident-72h",
      name: "Cybersecurity incident reporting to DFS within 72 hours",
      description: "",
      framework_ref: "ny-dfs-23-nycrr-500",
    },
    {
      id: "fintech:control:dfs-third-party-assessment",
      name: "Third-party service provider security assessment",
      description: "",
      framework_ref: "ny-dfs-23-nycrr-500",
    },

    // General financial controls
    {
      id: "fintech:control:dual-approval-funds-movement",
      name: "Dual approval for funds movement above thresholds",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "fintech:control:segregation-of-duties",
      name: "Segregation of duties between initiation and approval",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "fintech:control:daily-reconciliation",
      name: "Daily reconciliation of customer ledger to bank balances",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "fintech:control:settlement-timing",
      name: "Settlement timing controls",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "fintech:control:model-risk-governance",
      name: "Model risk governance for credit/fraud models",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "fintech:control:adverse-action-notice",
      name: "Adverse action notice generation for declined credit applications (ECOA/FCRA)",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "fintech:control:reg-e-tila-disclosures",
      name: "Disclosure delivery for Reg E / TILA transactions",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "fintech:control:glba-privacy-notice",
      name: "Privacy notice delivery (GLBA)",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "fintech:control:glba-safeguards-review",
      name: "Annual safeguards program review (GLBA)",
      description: "",
      framework_ref: "nist-csf-2.0",
    },

    // Documentation
    {
      id: "fintech:control:aml-program-doc",
      name: "AML program documentation",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "fintech:control:bsa-risk-assessment-doc",
      name: "BSA risk assessment",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "fintech:control:glba-isp-doc",
      name: "Information security program documentation (GLBA)",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
    {
      id: "fintech:control:irp-regulatory-timelines",
      name: "Incident response plan with regulatory notification timelines",
      description: "",
      framework_ref: "nist-csf-2.0",
    },
  ],
};
