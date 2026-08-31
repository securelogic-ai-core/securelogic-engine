/**
 * soc2TscCrosswalk.ts — the SECOND corpus for the governed canonical control
 * crosswalk: the AICPA Trust Services Criteria, 2017.
 *
 * ── Why 2017, and why exactly these 36 references ──────────────────────────
 *
 * For the same reason `nistCsfCrosswalk.ts` curated CSF 1.1 rather than 2.0:
 * these are the references this codebase actually writes into `frameworks`.
 * `FRAMEWORK_TEMPLATES.soc2` is "SOC 2 Type II" / "2017", and every one of the
 * 36 `requirement_reference` values below is a `reference_id` that
 * POST /api/frameworks/activate creates for a tenant. `soc2` / `2017` is
 * already in `CANONICAL_FRAMEWORK_VERSIONS`, so no new framework identity and
 * no S4-specific taxonomy is introduced here — this is CONTENT for an
 * architecture that already exists.
 *
 * `soc2TscCrosswalk.test.ts` asserts that claim against FRAMEWORK_TEMPLATES so
 * it cannot rot into a crosswalk that is correct and joins to nothing.
 *
 * ── What this deliberately does NOT cover ──────────────────────────────────
 *
 * The 2017 TSC contains criteria the shipped template does not: the
 * confidentiality series (C1.1, C1.2), processing integrity (PI1.x) and the
 * privacy series (P1–P8). They are absent here ON PURPOSE, and their absence is
 * a live gap rather than an oversight:
 *
 *   A vendor's SOC 2 report can test a control against C1.1, and the S4
 *   coverage chain reads the VENDOR side of this table. A tested control keyed
 *   `C1.1` therefore resolves to no canonical control today, and the hop dies
 *   there — measured in the staging corpus, where the tested-control
 *   identifiers are CC6.1, CC6.2, CC7.2, A1.2 and C1.1.
 *
 * Adding them is not a content chore: the crosswalk is keyed on a GLOBAL
 * framework identity and does not require a tenant to have activated the
 * reference, so vendor-side-only criteria are representable — but publishing
 * references no shipped template contains is an authority decision about what
 * this table asserts, and it is owed to the owner rather than taken here.
 *
 * ── Mapping discipline ─────────────────────────────────────────────────────
 *
 * Many-to-many in both directions, as the schema allows and the domain
 * requires: CC6.1 is one criterion carrying seven canonical controls, and
 * `risk-assessment-programme` carries five criteria. Mappings are made against
 * the criterion's points of focus, not its title alone — CC6.1's inventory and
 * classification points of focus are why the asset controls appear there
 * rather than only under an availability criterion.
 *
 * ── Governance ─────────────────────────────────────────────────────────────
 *
 * Every row published from this module carries `mapping_source: 'securelogic'`
 * and `proposed_by_actor_kind: 'securelogic_curator'`, and cannot reach
 * `approved` or `published` without a named human approver — a CHECK, not a
 * convention. No heuristic, no string-similarity fallback, no silent mapping:
 * a reference absent from this module resolves to nothing, visibly.
 */

import type { CrosswalkEntry } from "./nistCsfCrosswalk.js";

export const SOC2_FRAMEWORK_KEY = "soc2";
export const SOC2_FRAMEWORK_VERSION = "2017";

export const SOC2_TSC_2017_CROSSWALK: readonly CrosswalkEntry[] = [
  // ---- CC1: Control Environment (COSO 1-5) --------------------------------
  {
    requirement_reference: "CC1.1",
    canonical_control_slugs: ["security-policy-program"],
    rationale:
      "A documented, communicated code of conduct with enforcement is the policy programme instrument; there is no separate 'ethics' control in the canonical corpus and inventing one would fragment the same obligation.",
  },
  {
    requirement_reference: "CC1.2",
    canonical_control_slugs: ["security-roles-and-responsibilities"],
    rationale:
      "Board oversight of security is an accountability structure: who is answerable for security, at what level. That is the roles-and-responsibilities control, not a governance meeting artefact.",
  },
  {
    requirement_reference: "CC1.3",
    canonical_control_slugs: ["security-roles-and-responsibilities", "segregation-of-duties"],
    rationale:
      "Structure, authority and responsibility. Reporting lines and defined security responsibilities are the roles control; the criterion's points of focus on limiting authority to reduce conflicting duties are segregation of duties.",
  },
  {
    requirement_reference: "CC1.4",
    canonical_control_slugs: ["security-awareness-training", "security-roles-and-responsibilities"],
    rationale:
      "Commitment to competence is met by the training programme that develops the required skills and by the role definitions that state which competencies a security-relevant role needs.",
  },
  {
    requirement_reference: "CC1.5",
    canonical_control_slugs: ["security-roles-and-responsibilities", "security-policy-program"],
    rationale:
      "Accountability requires both a named holder of the responsibility and a policy that makes non-compliance a consequence-bearing act.",
  },

  // ---- CC2: Communication and Information ---------------------------------
  {
    requirement_reference: "CC2.1",
    canonical_control_slugs: ["security-event-logging", "risk-assessment-programme"],
    rationale:
      "Relevant, quality information to support internal control: logging generates the security information, and the risk programme is where it is actually consumed for decisions.",
  },
  {
    requirement_reference: "CC2.2",
    canonical_control_slugs: ["security-policy-program", "security-awareness-training"],
    rationale:
      "Internal communication of security obligations happens through published policy and the awareness programme that carries it to staff with acknowledgement.",
  },
  {
    requirement_reference: "CC2.3",
    canonical_control_slugs: ["incident-reporting-and-escalation", "recovery-communications"],
    rationale:
      "External communication. For a service organisation the security-relevant instances are notifying affected external parties of an incident and communicating status during recovery.",
  },

  // ---- CC3: Risk Assessment -----------------------------------------------
  {
    requirement_reference: "CC3.1",
    canonical_control_slugs: ["risk-assessment-programme", "legal-and-regulatory-obligation-register"],
    rationale:
      "Objectives specified with enough clarity to identify risk. COSO Principle 6 explicitly includes compliance objectives, which is the obligation register — the criterion is not met by a risk method alone.",
  },
  {
    requirement_reference: "CC3.2",
    canonical_control_slugs: ["risk-assessment-programme", "asset-criticality-classification", "threat-intelligence-consumption"],
    rationale:
      "Identifying and analysing risk requires knowing what matters (criticality classification) and what is acting against it (threat intelligence), not just a method for scoring.",
  },
  {
    requirement_reference: "CC3.3",
    canonical_control_slugs: ["risk-assessment-programme", "segregation-of-duties", "insider-activity-monitoring"],
    rationale:
      "Fraud risk. Considering fraud is the risk programme; the controls that actually address it are separation of conflicting duties and monitoring of insider activity.",
  },
  {
    requirement_reference: "CC3.4",
    canonical_control_slugs: ["change-management", "risk-assessment-programme"],
    rationale:
      "Identifying and assessing changes that could significantly affect internal control is the change process feeding the risk assessment — the criterion is about the linkage, so both are required.",
  },

  // ---- CC4: Monitoring Activities -----------------------------------------
  {
    requirement_reference: "CC4.1",
    canonical_control_slugs: ["vulnerability-identification", "access-authorization-and-review"],
    rationale:
      "Ongoing and separate evaluations of whether controls are present and functioning. In practice these are the recurring vulnerability assessment and the periodic access review.",
  },
  {
    requirement_reference: "CC4.2",
    canonical_control_slugs: ["risk-treatment-and-response", "incident-reporting-and-escalation"],
    rationale:
      "Evaluating and communicating deficiencies: remediation tracking is the treatment control, and escalation to those responsible for corrective action is the reporting control.",
  },

  // ---- CC5: Control Activities --------------------------------------------
  {
    requirement_reference: "CC5.1",
    canonical_control_slugs: ["risk-treatment-and-response"],
    rationale:
      "Selecting and developing control activities that mitigate risk to acceptable levels is exactly the risk treatment decision.",
  },
  {
    requirement_reference: "CC5.2",
    canonical_control_slugs: ["secure-baseline-configuration", "change-management"],
    rationale:
      "General control activities over technology. The two general controls a service organisation is actually tested on are baseline configuration and controlled change.",
  },
  {
    requirement_reference: "CC5.3",
    canonical_control_slugs: ["security-policy-program"],
    rationale:
      "Deploying control activities through policies that establish expectations and procedures that put them into action is the policy programme.",
  },

  // ---- CC6: Logical and Physical Access ------------------------------------
  {
    requirement_reference: "CC6.1",
    canonical_control_slugs: [
      "identity-lifecycle-management",
      "access-authorization-and-review",
      "encryption-at-rest",
      "encryption-in-transit",
      "network-segmentation-and-integrity",
      "hardware-asset-inventory",
      "software-asset-inventory",
      "asset-criticality-classification",
    ],
    rationale:
      "The broadest criterion in the set. Its points of focus name identification and management of the information asset inventory, classification of those assets, restriction of logical access, and use of encryption to protect them — so the asset and cryptographic controls belong here, not only the access ones.",
  },
  {
    requirement_reference: "CC6.2",
    canonical_control_slugs: ["identity-lifecycle-management", "access-authorization-and-review"],
    rationale:
      "Registration and authorisation of new users before access is issued, and removal when it is no longer required: joiner/mover/leaver plus the authorisation decision.",
  },
  {
    requirement_reference: "CC6.3",
    canonical_control_slugs: ["access-authorization-and-review", "privileged-access-management", "identity-lifecycle-management"],
    rationale:
      "Role-based access, least privilege and timely modification or removal. Privileged access is called out separately because the criterion's points of focus require considering the segregation of incompatible privileged functions.",
  },
  {
    requirement_reference: "CC6.4",
    canonical_control_slugs: ["physical-access-control"],
    rationale: "Restriction of physical access to facilities and protected information assets.",
  },
  {
    requirement_reference: "CC6.5",
    canonical_control_slugs: ["media-sanitisation-and-disposal"],
    rationale:
      "Rendering data unreadable before disposal or reuse of physical assets is media sanitisation, a distinct control from access restriction.",
  },
  {
    requirement_reference: "CC6.6",
    canonical_control_slugs: ["network-segmentation-and-integrity", "remote-access-control", "multi-factor-authentication"],
    rationale:
      "Protection against threats from outside the system boundary: boundary protection, controlled remote access, and strong authentication of external connections.",
  },
  {
    requirement_reference: "CC6.7",
    canonical_control_slugs: ["encryption-in-transit", "data-loss-prevention", "remote-access-control", "data-flow-mapping"],
    rationale:
      "Restricting the transmission, movement and removal of information. Knowing the flows is a precondition for restricting them, which is why data-flow mapping is here rather than under an inventory criterion.",
  },
  {
    requirement_reference: "CC6.8",
    canonical_control_slugs: ["malware-protection", "secure-baseline-configuration"],
    rationale:
      "Preventing and detecting unauthorised or malicious software: anti-malware controls plus the baseline that constrains what may run at all.",
  },

  // ---- CC7: System Operations ----------------------------------------------
  {
    requirement_reference: "CC7.1",
    canonical_control_slugs: ["vulnerability-identification", "secure-baseline-configuration", "threat-intelligence-consumption"],
    rationale:
      "Detecting configuration changes and newly-introduced vulnerabilities. The criterion requires both the detection procedures and the baseline they are evaluated against; threat intelligence is what makes 'newly introduced' knowable.",
  },
  {
    requirement_reference: "CC7.2",
    canonical_control_slugs: ["security-event-logging", "network-monitoring", "security-event-analysis-and-triage"],
    rationale:
      "Monitoring components for anomalies indicative of malicious acts, and analysing them to determine whether they represent a security event.",
  },
  {
    requirement_reference: "CC7.3",
    canonical_control_slugs: ["security-event-analysis-and-triage", "incident-response-plan"],
    rationale:
      "Evaluating security events to decide whether they constitute a failure to meet objectives — the triage decision, against a defined response plan.",
  },
  {
    requirement_reference: "CC7.4",
    canonical_control_slugs: [
      "incident-response-plan",
      "incident-containment",
      "incident-mitigation-and-remediation",
      "incident-reporting-and-escalation",
    ],
    rationale:
      "Responding to identified security incidents: the plan, containment, remediation, and communication of the incident to those who must act.",
  },
  {
    requirement_reference: "CC7.5",
    canonical_control_slugs: ["incident-mitigation-and-remediation", "disaster-recovery-execution", "recovery-communications"],
    rationale:
      "Recovering from identified security incidents, including restoration of the affected service and communication of restoration.",
  },

  // ---- CC8: Change Management ----------------------------------------------
  {
    requirement_reference: "CC8.1",
    canonical_control_slugs: ["change-management", "secure-development-lifecycle"],
    rationale:
      "Authorising, designing, developing, testing, approving and implementing changes. For a service organisation the development pipeline is inseparable from the change process, and the criterion covers both.",
  },

  // ---- CC9: Risk Mitigation ------------------------------------------------
  {
    requirement_reference: "CC9.1",
    canonical_control_slugs: ["business-continuity-plan", "business-impact-analysis", "risk-treatment-and-response"],
    rationale:
      "Mitigating risks arising from business disruption. The impact analysis sizes the disruption, the continuity plan is the mitigation, and the treatment control records the decision.",
  },
  {
    requirement_reference: "CC9.2",
    canonical_control_slugs: ["third-party-risk-management", "third-party-activity-monitoring", "external-system-inventory"],
    rationale:
      "Assessing and managing vendor and business-partner risk. You cannot assess what you have not enumerated, so the external system inventory is part of meeting this criterion, not a neighbouring concern.",
  },

  // ---- A1: Availability ----------------------------------------------------
  {
    requirement_reference: "A1.1",
    canonical_control_slugs: ["capacity-management"],
    rationale:
      "Maintaining, monitoring and evaluating current processing capacity and use of system components against demand.",
  },
  {
    requirement_reference: "A1.2",
    canonical_control_slugs: ["backup-and-restore", "disaster-recovery-execution", "physical-access-control"],
    rationale:
      "Environmental protections, backup processes and recovery infrastructure. Environmental protection of the facility sits with the physical control; there is no separate environmental-controls canonical control and inventing one for a single criterion would fragment it.",
  },
  {
    requirement_reference: "A1.3",
    canonical_control_slugs: ["disaster-recovery-execution", "business-continuity-plan"],
    rationale:
      "Testing the recovery plan is a distinct criterion from having one: the test is an execution of the recovery procedure against the documented plan.",
  },
] as const;
