/**
 * nistCsfCrosswalk.ts - the FIRST proof corpus for the governed canonical
 * control crosswalk: NIST CSF 1.1.
 *
 * -- Why 1.1 and not 2.0 ---------------------------------------------------
 *
 * Because 1.1 is the version this codebase actually writes into `frameworks`.
 * `FRAMEWORK_TEMPLATES.nist_csf` is "NIST Cybersecurity Framework" / "1.1", and
 * every one of its 57 requirement references below is a `reference_id` that
 * POST /api/frameworks/activate creates. Curating 2.0 first would produce a
 * crosswalk that is correct and joins to nothing - a vacuous pass, which the
 * owner ruling explicitly names as the failure to avoid. 2.0 is a second
 * curation pass against the same `framework_key` and a different
 * `framework_version`; the schema is already versioned for it.
 *
 * -- Many-to-many, demonstrated rather than asserted -----------------------
 *
 * Several requirements below map to more than one canonical control (ID.BE-4
 * needs both a business impact analysis and an external dependency inventory),
 * and several canonical controls carry more than one requirement
 * (`security-roles-and-responsibilities` appears under ID.AM-6, ID.GV-2 and
 * RS.CO-1). One canonical control in the corpus - `segregation-of-duties` -
 * maps to nothing here at all, which is the point: a canonical control is not a
 * framework requirement.
 *
 * -- Completeness, stated honestly -----------------------------------------
 *
 * This covers all 57 NIST CSF 1.1 references in the shipped template, and it is
 * NOT the completed crosswalk corpus. SOC 2 / 2017 is curated separately in
 * `soc2TscCrosswalk.ts` (VA-S4-4C-1); GDPR, CCPA/CPRA and NIST AI RMF remain
 * priority frameworks under Ruling 1 with no content anywhere yet.
 * `nistCsfCrosswalk.test.ts` asserts the coverage claim against
 * FRAMEWORK_TEMPLATES so the claim cannot rot.
 *
 * -- Governance ------------------------------------------------------------
 *
 * Every row published from this module carries `mapping_source: 'securelogic'`
 * and `proposed_by_actor_kind: 'securelogic_curator'`, and cannot reach
 * `approved` or `published` in the database without a named human approver -
 * a CHECK, not a convention. A model may propose additions with
 * `mapping_source: 'ai_proposed'`; it can never publish them.
 */

export const NIST_CSF_FRAMEWORK_KEY = "nist-csf";
export const NIST_CSF_FRAMEWORK_VERSION = "1.1";

export type CrosswalkEntry = {
  /** `requirements.reference_id`, verbatim. */
  readonly requirement_reference: string;
  /** Canonical control SLUGS (not keys) from CANONICAL_CONTROL_CORPUS. */
  readonly canonical_control_slugs: readonly string[];
  /** Why this requirement is satisfied by these controls - for the next reviewer. */
  readonly rationale: string;
};

export const NIST_CSF_1_1_CROSSWALK: readonly CrosswalkEntry[] = [
  // ---- IDENTIFY / Asset Management ---------------------------------------
  {
    requirement_reference: "ID.AM-1",
    canonical_control_slugs: ["hardware-asset-inventory"],
    rationale: "Physical device inventory is exactly the hardware inventory control.",
  },
  {
    requirement_reference: "ID.AM-2",
    canonical_control_slugs: ["software-asset-inventory"],
    rationale: "Software and platform inventory, including SaaS.",
  },
  {
    requirement_reference: "ID.AM-3",
    canonical_control_slugs: ["data-flow-mapping"],
    rationale: "Communication and data flow mapping.",
  },
  {
    requirement_reference: "ID.AM-4",
    canonical_control_slugs: ["external-system-inventory"],
    rationale: "Catalogue of external information systems and the connections to them.",
  },
  {
    requirement_reference: "ID.AM-5",
    canonical_control_slugs: ["asset-criticality-classification"],
    rationale: "Prioritising resources is classification by criticality and sensitivity.",
  },
  {
    requirement_reference: "ID.AM-6",
    canonical_control_slugs: ["security-roles-and-responsibilities"],
    rationale: "Established cybersecurity roles across the workforce.",
  },

  // ---- IDENTIFY / Business Environment ------------------------------------
  {
    requirement_reference: "ID.BE-1",
    canonical_control_slugs: ["external-system-inventory", "third-party-risk-management"],
    rationale:
      "Knowing the organisation's place in the supply chain needs both the dependency catalogue and the third-party programme that reasons about it.",
  },
  {
    requirement_reference: "ID.BE-2",
    canonical_control_slugs: [
      "legal-and-regulatory-obligation-register",
      "business-impact-analysis",
    ],
    rationale:
      "Sector criticality is established from the obligations that attach to the sector and from the impact analysis that shows what depends on the organisation.",
  },
  {
    requirement_reference: "ID.BE-3",
    canonical_control_slugs: ["asset-criticality-classification", "business-impact-analysis"],
    rationale: "Establishing priorities is classification informed by business impact.",
  },
  {
    requirement_reference: "ID.BE-4",
    canonical_control_slugs: ["business-impact-analysis", "external-system-inventory"],
    rationale:
      "Dependencies for critical service delivery: the internal analysis plus the external dependency catalogue.",
  },
  {
    requirement_reference: "ID.BE-5",
    canonical_control_slugs: ["business-continuity-plan", "business-impact-analysis"],
    rationale:
      "Resilience requirements are recovery objectives, which come from the impact analysis and live in the continuity plan.",
  },

  // ---- IDENTIFY / Governance ----------------------------------------------
  {
    requirement_reference: "ID.GV-1",
    canonical_control_slugs: ["security-policy-program"],
    rationale: "An established, approved cybersecurity policy.",
  },
  {
    requirement_reference: "ID.GV-2",
    canonical_control_slugs: ["security-roles-and-responsibilities", "third-party-risk-management"],
    rationale:
      "Coordinated roles internally AND the security responsibilities carried into third-party agreements.",
  },
  {
    requirement_reference: "ID.GV-3",
    canonical_control_slugs: ["legal-and-regulatory-obligation-register"],
    rationale: "Understanding legal and regulatory requirements is the obligation register.",
  },
  {
    requirement_reference: "ID.GV-4",
    canonical_control_slugs: ["security-policy-program", "risk-assessment-programme"],
    rationale:
      "Governance processes addressing cyber risk means the programme and the risk process that feeds it.",
  },

  // ---- IDENTIFY / Risk Assessment -----------------------------------------
  {
    requirement_reference: "ID.RA-1",
    canonical_control_slugs: ["vulnerability-identification"],
    rationale: "Asset vulnerabilities are identified by scanning and testing.",
  },
  {
    requirement_reference: "ID.RA-2",
    canonical_control_slugs: ["threat-intelligence-consumption"],
    rationale: "Receipt of threat intelligence from information sharing sources.",
  },
  {
    requirement_reference: "ID.RA-3",
    canonical_control_slugs: ["risk-assessment-programme", "threat-intelligence-consumption"],
    rationale:
      "Threat identification draws on both the internal risk process and external intelligence.",
  },
  {
    requirement_reference: "ID.RA-4",
    canonical_control_slugs: ["risk-assessment-programme", "business-impact-analysis"],
    rationale: "Potential business impacts are the impact half of the risk analysis.",
  },
  {
    requirement_reference: "ID.RA-5",
    canonical_control_slugs: ["risk-assessment-programme"],
    rationale: "Combining threat, vulnerability, likelihood and impact into a risk determination.",
  },
  {
    requirement_reference: "ID.RA-6",
    canonical_control_slugs: ["risk-treatment-and-response"],
    rationale: "Identified and prioritised risk responses.",
  },

  // ---- PROTECT / Access Control -------------------------------------------
  {
    requirement_reference: "PR.AC-1",
    canonical_control_slugs: ["identity-lifecycle-management", "multi-factor-authentication"],
    rationale:
      "Managing identities and credentials covers both the issuance/revocation lifecycle and the strength of the authentication itself.",
  },
  {
    requirement_reference: "PR.AC-2",
    canonical_control_slugs: ["physical-access-control"],
    rationale: "Physical access is managed and protected.",
  },
  {
    requirement_reference: "PR.AC-3",
    canonical_control_slugs: ["remote-access-control", "multi-factor-authentication"],
    rationale:
      "Managed remote access, with authentication strength as the control that makes it defensible.",
  },
  {
    requirement_reference: "PR.AC-4",
    canonical_control_slugs: ["access-authorization-and-review", "privileged-access-management"],
    rationale:
      "Permissions managed on least privilege, with privileged permissions treated separately.",
  },
  {
    requirement_reference: "PR.AC-5",
    canonical_control_slugs: ["network-segmentation-and-integrity"],
    rationale: "Network integrity protection through segmentation.",
  },

  // ---- PROTECT / Awareness and Training -----------------------------------
  {
    requirement_reference: "PR.AT-1",
    canonical_control_slugs: ["security-awareness-training"],
    rationale: "All users are informed and trained.",
  },
  {
    requirement_reference: "PR.AT-2",
    canonical_control_slugs: ["security-awareness-training", "privileged-access-management"],
    rationale:
      "Privileged users understanding their roles is role-based training plus the privileged access programme that defines the role.",
  },

  // ---- PROTECT / Data Security --------------------------------------------
  {
    requirement_reference: "PR.DS-1",
    canonical_control_slugs: ["encryption-at-rest"],
    rationale: "Data-at-rest protection.",
  },
  {
    requirement_reference: "PR.DS-2",
    canonical_control_slugs: ["encryption-in-transit"],
    rationale: "Data-in-transit protection.",
  },
  {
    requirement_reference: "PR.DS-3",
    canonical_control_slugs: ["media-sanitisation-and-disposal"],
    rationale: "Formal management of assets through removal, transfer and disposition.",
  },
  {
    requirement_reference: "PR.DS-4",
    canonical_control_slugs: ["capacity-management"],
    rationale: "Adequate capacity to ensure availability is maintained.",
  },
  {
    requirement_reference: "PR.DS-5",
    canonical_control_slugs: ["data-loss-prevention"],
    rationale: "Protections against data leaks.",
  },

  // ---- PROTECT / Information Protection Processes -------------------------
  {
    requirement_reference: "PR.IP-1",
    canonical_control_slugs: ["secure-baseline-configuration"],
    rationale: "A baseline configuration is created and maintained.",
  },
  {
    requirement_reference: "PR.IP-2",
    canonical_control_slugs: ["secure-development-lifecycle"],
    rationale: "A system development lifecycle to manage systems is implemented.",
  },
  {
    requirement_reference: "PR.IP-3",
    canonical_control_slugs: ["change-management"],
    rationale: "Configuration change control processes are in place.",
  },
  {
    requirement_reference: "PR.IP-4",
    canonical_control_slugs: ["backup-and-restore"],
    rationale: "Backups are conducted, maintained and tested.",
  },

  // ---- DETECT / Anomalies and Events --------------------------------------
  {
    requirement_reference: "DE.AE-1",
    canonical_control_slugs: ["network-monitoring", "secure-baseline-configuration"],
    rationale:
      "A baseline of network operations and expected data flows is both a monitoring capability and a baseline-management one.",
  },
  {
    requirement_reference: "DE.AE-2",
    canonical_control_slugs: ["security-event-analysis-and-triage"],
    rationale: "Detected events are analysed to understand attack targets and methods.",
  },
  {
    requirement_reference: "DE.AE-3",
    canonical_control_slugs: ["security-event-logging"],
    rationale: "Event data are collected and correlated from multiple sources.",
  },

  // ---- DETECT / Security Continuous Monitoring ----------------------------
  {
    requirement_reference: "DE.CM-1",
    canonical_control_slugs: ["network-monitoring"],
    rationale: "The network is monitored to detect potential cybersecurity events.",
  },
  {
    requirement_reference: "DE.CM-2",
    canonical_control_slugs: ["physical-access-control"],
    rationale: "The physical environment is monitored to detect potential events.",
  },
  {
    requirement_reference: "DE.CM-3",
    canonical_control_slugs: ["insider-activity-monitoring"],
    rationale: "Personnel activity is monitored to detect potential cybersecurity events.",
  },
  {
    requirement_reference: "DE.CM-4",
    canonical_control_slugs: ["malware-protection"],
    rationale: "Malicious code is detected.",
  },
  {
    requirement_reference: "DE.CM-5",
    canonical_control_slugs: ["malware-protection", "secure-baseline-configuration"],
    rationale:
      "Unauthorised mobile code detection is both an anti-malware capability and a deviation-from-baseline one.",
  },
  {
    requirement_reference: "DE.CM-6",
    canonical_control_slugs: ["third-party-activity-monitoring"],
    rationale: "External service provider activity is monitored.",
  },
  {
    requirement_reference: "DE.CM-7",
    canonical_control_slugs: ["physical-access-control", "insider-activity-monitoring"],
    rationale:
      "Monitoring for unauthorised personnel, connections, devices and software spans the physical and the behavioural.",
  },

  // ---- RESPOND ------------------------------------------------------------
  {
    requirement_reference: "RS.RP-1",
    canonical_control_slugs: ["incident-response-plan"],
    rationale: "The response plan is executed during or after an incident.",
  },
  {
    requirement_reference: "RS.CO-1",
    canonical_control_slugs: ["incident-response-plan", "security-roles-and-responsibilities"],
    rationale:
      "Personnel knowing their roles and order of operations is the plan plus the accountability that names them.",
  },
  {
    requirement_reference: "RS.CO-2",
    canonical_control_slugs: ["incident-reporting-and-escalation"],
    rationale: "Incidents are reported consistent with established criteria.",
  },
  {
    requirement_reference: "RS.AN-1",
    canonical_control_slugs: ["security-event-analysis-and-triage"],
    rationale: "Notifications from detection systems are investigated.",
  },
  {
    requirement_reference: "RS.MI-1",
    canonical_control_slugs: ["incident-containment"],
    rationale: "Incidents are contained.",
  },
  {
    requirement_reference: "RS.MI-2",
    canonical_control_slugs: ["incident-mitigation-and-remediation"],
    rationale: "Incidents are mitigated.",
  },

  // ---- RECOVER ------------------------------------------------------------
  {
    requirement_reference: "RC.RP-1",
    canonical_control_slugs: ["disaster-recovery-execution", "business-continuity-plan"],
    rationale:
      "Executing the recovery plan during or after an incident draws on both the DR execution capability and the continuity plan it belongs to.",
  },
  {
    requirement_reference: "RC.CO-1",
    canonical_control_slugs: ["recovery-communications"],
    rationale: "Public relations are managed.",
  },
  {
    requirement_reference: "RC.CO-2",
    canonical_control_slugs: ["recovery-communications"],
    rationale: "Reputation is repaired after an incident.",
  },
  {
    requirement_reference: "RC.CO-3",
    canonical_control_slugs: ["recovery-communications"],
    rationale:
      "Recovery activities are communicated to internal stakeholders and executive teams.",
  },
] as const;
