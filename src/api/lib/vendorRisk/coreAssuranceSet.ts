/**
 * coreAssuranceSet.ts — the SecureLogic Core Assurance Set v1 (Assessment
 * Composition v1, owner-approved methodology 2026-09-04).
 *
 * ── What this is ─────────────────────────────────────────────────────────────
 * Sixteen PRESUMPTIVELY applicable control objectives: the defensible baseline
 * SecureLogic starts every assessment from. "Presumptive" is load-bearing. An
 * objective is asked because nothing about the relationship shows it does not
 * apply — and each one carries a deterministic rule that says, from the
 * relationship's declared facts, whether it applies and why. Office catering
 * with no data, no access and no dependency legitimately ends with nothing to
 * ask; a payment processor with restricted data ends with all sixteen.
 *
 * ── How it fits the existing architecture (no second engine) ─────────────────
 *   - It is a FRAMEWORK TEMPLATE (`FRAMEWORK_TEMPLATES.securelogic_core_assurance`)
 *     with a canonical identity (`securelogic-core-assurance` / `1.0`), so its
 *     sixteen objectives are ordinary `requirements` rows, bridged to immutable
 *     question versions by the existing composition path, answered through the
 *     existing portal, and reviewed through the existing lifecycle.
 *   - Its tags are CURATED (`curatedFrameworkTags.ts`), so the domain each
 *     objective is asked under is a human decision, never a title heuristic.
 *   - It maps to CANONICAL CONTROLS (`coreAssuranceCrosswalk.ts`), so the
 *     existing S4 chain — SOC report → tested control → canonical control →
 *     candidate requirement → human sufficiency determination → counting
 *     predicate — reaches these objectives with no new evidence machinery.
 *   - Applicability is a rule family INSIDE `scopeResolver.ts` (S1.core.*),
 *     gated to scope-rule 1.2.0, so historical engagements re-resolve exactly
 *     as they did.
 *
 * ── The one rule about the rules ─────────────────────────────────────────────
 * Applicability reads FACTS, never Criticality, Inherent Risk or Tier. Those
 * decide HOW MUCH assurance (depth, tier); facts decide WHAT needs assurance.
 * The methodology forbids collapsing the two, and the tests assert that the
 * same facts produce the same applicable set at every tier.
 *
 * Pure module: no I/O.
 */

import type { AssessmentDomain } from "./requirementDomain.js";
import type { ScopeTag } from "./requirementScopeTags.js";
import type { FactSet } from "./factResolver.js";
import { factAtLeast, factBool, factList, factString } from "./factResolver.js";
import type { FactKey } from "./factRegistry.js";

/** Version of the SET (which objectives, which rules). Bump on any change. */
export const CORE_ASSURANCE_SET_VERSION = "1.0" as const;
/** `FRAMEWORK_TEMPLATES` key and `frameworks.framework_key`, respectively. */
export const CORE_ASSURANCE_TEMPLATE_KEY = "securelogic_core_assurance" as const;
export const CORE_ASSURANCE_FRAMEWORK_KEY = "securelogic-core-assurance" as const;
export const CORE_ASSURANCE_FRAMEWORK_VERSION = "1.0" as const;
export const CORE_ASSURANCE_DISPLAY_NAME = "SecureLogic Core Assurance Set" as const;

/** Rule ids are `S1.core.<ref>` so the applicability record's CHECK accepts them. */
export function coreAssuranceRuleId(reference: string): string {
  return `S1.core.${reference.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

/**
 * The exposure SIGNALS the rules read, derived once per resolve from the fact
 * surface. Each is a named, testable predicate over facts — the rules compose
 * them, so "why not applicable" can be explained in these terms.
 *
 * Absent facts read as `false` for every signal EXCEPT technology, where an
 * undeclared service type is PRESUMED to involve technology: presumption of
 * applicability is the baseline, and only a declared fact removes it.
 */
export type ExposureSignals = {
  /** Any customer or sensitive information is handled (internal+ or personal data). */
  handles_data: boolean;
  /** Confidential/restricted data, personal data, or special-category data. */
  sensitive_data: boolean;
  /** Any access to the customer's systems, network or production data. */
  system_access: boolean;
  /** The service matters to operations (moderate+ dependency, medium+ criticality). */
  operational_dependency: boolean;
  /** A critical service: high+ dependency or high+ business criticality. */
  critical_service: boolean;
  /** AI is embedded in or core to the service, or declared. */
  ai_involved: boolean;
  /** Technology is used to provide the service (presumed unless professional services). */
  technology: boolean;
  /** Material subcontractors / sub-processors / third-party models. */
  fourth_parties: boolean;
  /** Legal, regulatory, contractual or privacy obligations bear on the service. */
  regulatory: boolean;
  /** Any of data, access, dependency or AI. */
  any_exposure: boolean;
};

const ANY_EXPOSURE_FACT_KEYS: readonly FactKey[] = [
  "core.data_sensitivity",
  "data.personal_data",
  "core.access_level",
  "access.privileged",
  "access.network",
  "access.production_data",
  "core.operational_dependency",
  "core.business_criticality",
  "core.ai_involvement",
  "ai.uses_ai",
];

const SIGNAL_FACT_KEYS: Readonly<Record<keyof ExposureSignals, readonly FactKey[]>> = {
  handles_data: ["core.data_sensitivity", "data.personal_data"],
  sensitive_data: ["core.data_sensitivity", "data.personal_data", "data.sensitive_categories"],
  system_access: ["core.access_level", "access.privileged", "access.network", "access.production_data"],
  operational_dependency: ["core.operational_dependency", "core.business_criticality"],
  critical_service: ["core.operational_dependency", "core.business_criticality"],
  ai_involved: ["core.ai_involvement", "ai.uses_ai"],
  technology: ["service.type"],
  fourth_parties: ["core.fourth_party_exposure", "nth.subprocessors_declared", "ai.third_party_models"],
  regulatory: [
    "core.regulatory_exposure",
    "core.regulatory_breach_notification",
    "policy.privacy_obligations_active",
    "data.jurisdictions",
  ],
  any_exposure: ANY_EXPOSURE_FACT_KEYS,
};

export function deriveExposureSignals(facts: FactSet): ExposureSignals {
  const personal = factBool(facts, "data.personal_data") === true;
  const handles_data = factAtLeast(facts, "core.data_sensitivity", "internal") || personal;
  const sensitive_data =
    factAtLeast(facts, "core.data_sensitivity", "confidential") ||
    personal ||
    factList(facts, "data.sensitive_categories").length > 0;
  const system_access =
    factAtLeast(facts, "core.access_level", "read_only") ||
    factBool(facts, "access.privileged") === true ||
    factBool(facts, "access.network") === true ||
    factBool(facts, "access.production_data") === true;
  const operational_dependency =
    factAtLeast(facts, "core.operational_dependency", "moderate") ||
    factAtLeast(facts, "core.business_criticality", "medium");
  const critical_service =
    factAtLeast(facts, "core.operational_dependency", "high") ||
    factAtLeast(facts, "core.business_criticality", "high");
  const ai_involved =
    factAtLeast(facts, "core.ai_involvement", "embedded") || factBool(facts, "ai.uses_ai") === true;
  const serviceType = factString(facts, "service.type");
  const technology = serviceType === undefined ? true : serviceType !== "professional_services";
  const fourth_parties =
    factAtLeast(facts, "core.fourth_party_exposure", "low") ||
    factBool(facts, "nth.subprocessors_declared") === true ||
    factBool(facts, "ai.third_party_models") === true;
  const regulatory =
    factAtLeast(facts, "core.regulatory_exposure", "low") ||
    factBool(facts, "core.regulatory_breach_notification") === true ||
    factList(facts, "policy.privacy_obligations_active").length > 0 ||
    factList(facts, "data.jurisdictions").length > 0;
  const any_exposure = handles_data || system_access || operational_dependency || ai_involved;
  return {
    handles_data,
    sensitive_data,
    system_access,
    operational_dependency,
    critical_service,
    ai_involved,
    technology,
    fourth_parties,
    regulatory,
    any_exposure,
  };
}

export type CoreAssuranceObjective = {
  /** `requirements.reference_id`, stable forever. */
  readonly reference: string;
  /** The control objective — becomes the bridged question prompt. */
  readonly title: string;
  /** What would satisfy it — becomes the question guidance. */
  readonly description: string;
  /** Curated scope tags (closed vocabulary). */
  readonly tags: readonly ScopeTag[];
  /** The domain it is asked under. Test-asserted against the tags. */
  readonly domain: AssessmentDomain;
  /** Why these tags/domain — for the next curator. */
  readonly why: string;
  /** Canonical controls whose tested effectiveness can evidence this objective. */
  readonly canonical_control_slugs: readonly string[];
  /** The signals the applicability rule reads, in order of explanation. */
  readonly signals: readonly (keyof ExposureSignals)[];
  /** Deterministic applicability over the derived signals. */
  readonly applies: (s: ExposureSignals) => boolean;
  /** Customer-facing: why it applies. */
  readonly applicable_rationale: string;
  /** Customer-facing: why it does not apply. */
  readonly not_applicable_rationale: string;
};

const SIG = (...keys: (keyof ExposureSignals)[]) => keys;

export const CORE_ASSURANCE_OBJECTIVES: readonly CoreAssuranceObjective[] = [
  {
    reference: "CAS-01",
    title: "A documented information-security programme appropriate to the service and its risk",
    description:
      "The vendor maintains a written information-security programme — policies, standards and a governance cadence — proportionate to the service it provides and the information it handles. A current security policy set with an owner, a review date and evidence that it is communicated to staff would satisfy this.",
    tags: ["core"],
    domain: "security",
    why: "The baseline governance objective; security domain by definition.",
    canonical_control_slugs: ["security-policy-program"],
    signals: SIG("any_exposure"),
    applies: (s) => s.any_exposure,
    applicable_rationale:
      "The relationship involves your data, access to your systems, an operational dependency or AI, so the vendor's security programme is assessed.",
    not_applicable_rationale:
      "The relationship involves no customer or sensitive information, no access to your systems, no operational dependency and no AI, so a security programme is not assessed for it.",
  },
  {
    reference: "CAS-02",
    title: "Formally assigned security responsibilities",
    description:
      "Responsibility for information security is formally assigned to a named role or function with the authority to act. A named security owner (CISO, security lead or equivalent), documented in an org chart or role description, would satisfy this.",
    tags: ["core"],
    domain: "security",
    why: "Governance accountability; security domain.",
    canonical_control_slugs: ["security-roles-and-responsibilities"],
    signals: SIG("any_exposure"),
    applies: (s) => s.any_exposure,
    applicable_rationale:
      "Someone at the vendor must be accountable for the security of a service that touches your information, systems or operations.",
    not_applicable_rationale:
      "With no data, access, dependency or AI in the relationship there is no security accountability to establish for it.",
  },
  {
    reference: "CAS-03",
    title: "Personnel screening before access to sensitive information, systems, facilities or critical services, where legally permitted",
    description:
      "Staff and contractors are screened before being granted access to sensitive information, systems, facilities or the delivery of critical services, to the extent local law permits. A documented background-check policy, applied at hire and to contractors, with the checks performed listed, would satisfy this.",
    tags: ["core"],
    domain: "security",
    why: "People-security control; security domain. The vocabulary has no personnel tag, and none is invented for it.",
    canonical_control_slugs: ["identity-lifecycle-management"],
    signals: SIG("sensitive_data", "system_access", "critical_service"),
    applies: (s) => s.sensitive_data || s.system_access || s.critical_service,
    applicable_rationale:
      "Vendor personnel will handle sensitive information, access your systems or deliver a critical service, so pre-access screening is assessed.",
    not_applicable_rationale:
      "Vendor personnel handle no sensitive information, have no access to your systems and do not deliver a critical service, so personnel screening is not assessed.",
  },
  {
    reference: "CAS-04",
    title: "Security and privacy awareness training at onboarding and periodically thereafter",
    description:
      "All staff with access to customer information or systems complete security and privacy awareness training when they join and at least annually. Training records showing completion rates and the topics covered would satisfy this.",
    tags: ["core"],
    domain: "security",
    why: "People-security control; security domain.",
    canonical_control_slugs: ["security-awareness-training"],
    signals: SIG("handles_data", "system_access"),
    applies: (s) => s.handles_data || s.system_access,
    applicable_rationale:
      "Vendor staff will handle your information or access your systems, so their security and privacy awareness is assessed.",
    not_applicable_rationale:
      "Vendor staff neither handle your information nor access your systems, so awareness training is not assessed.",
  },
  {
    reference: "CAS-05",
    title: "Appropriate confidentiality obligations",
    description:
      "Staff, contractors and subcontractors who may access customer information are bound by confidentiality obligations. Signed confidentiality or non-disclosure terms in employment and contractor agreements, and confidentiality clauses flowing down to subcontractors, would satisfy this.",
    tags: ["core"],
    domain: "security",
    why: "Protects information through people and contracts. Deliberately NOT tagged data-protection: that tag would move it into the privacy question set, and it is a security objective that applies to non-personal data too.",
    canonical_control_slugs: ["security-policy-program"],
    signals: SIG("handles_data"),
    applies: (s) => s.handles_data,
    applicable_rationale:
      "The vendor handles your information, so confidentiality obligations on the people who can see it are assessed.",
    not_applicable_rationale:
      "The vendor handles no customer or sensitive information, so confidentiality obligations are not assessed.",
  },
  {
    reference: "CAS-06",
    title: "Access authorised on business need and least privilege",
    description:
      "Access to customer information and to the systems that provide the service is granted only on documented business need, at the least privilege required, and reviewed periodically. An access-request procedure with approval records and evidence of periodic access reviews would satisfy this.",
    tags: ["core", "access-control", "iam"],
    domain: "security",
    why: "Access-control objective; security domain.",
    canonical_control_slugs: ["access-authorization-and-review"],
    signals: SIG("handles_data", "system_access"),
    applies: (s) => s.handles_data || s.system_access,
    applicable_rationale:
      "The vendor holds your information or reaches your systems, so how access to it is authorised is assessed.",
    not_applicable_rationale:
      "The vendor holds none of your information and reaches none of your systems, so access authorisation is not assessed.",
  },
  {
    reference: "CAS-07",
    title: "Timely access modification or revocation on termination or role change",
    description:
      "Access is changed or removed promptly when a person leaves or changes role. A documented leaver/mover process with a target removal time (for example, within 24 hours of termination) and evidence it is followed would satisfy this.",
    tags: ["core", "access-control", "iam"],
    domain: "security",
    why: "Access-lifecycle objective; security domain.",
    canonical_control_slugs: ["identity-lifecycle-management"],
    signals: SIG("handles_data", "system_access"),
    applies: (s) => s.handles_data || s.system_access,
    applicable_rationale:
      "The vendor holds your information or reaches your systems, so how access is removed when people leave or move is assessed.",
    not_applicable_rationale:
      "The vendor holds none of your information and reaches none of your systems, so access revocation is not assessed.",
  },
  {
    reference: "CAS-08",
    title: "A documented security-incident identification, escalation, response and recovery process",
    description:
      "The vendor can detect, escalate, respond to and recover from security incidents affecting the service. A documented incident-response plan with severity definitions, escalation paths, roles and evidence of exercise or use would satisfy this.",
    tags: ["core", "incident-response"],
    domain: "security",
    why: "Incident-response objective; security domain.",
    canonical_control_slugs: ["incident-response-plan"],
    signals: SIG("any_exposure"),
    applies: (s) => s.any_exposure,
    applicable_rationale:
      "An incident at the vendor could affect your information, systems or operations, so its incident-response capability is assessed.",
    not_applicable_rationale:
      "An incident at the vendor could not reach your information, systems or operations, so incident response is not assessed.",
  },
  {
    reference: "CAS-09",
    title: "A defined customer-notification process for relevant security and privacy incidents",
    description:
      "The vendor commits to notifying customers of security and privacy incidents that affect them, within a defined time. A contractual notification commitment with a timeframe (for example, without undue delay and within 72 hours) and the channel used would satisfy this.",
    tags: ["core", "incident-response"],
    domain: "security",
    why: "Customer-facing incident communication; security domain.",
    canonical_control_slugs: ["incident-reporting-and-escalation"],
    signals: SIG("handles_data", "system_access", "operational_dependency"),
    applies: (s) => s.handles_data || s.system_access || s.operational_dependency,
    applicable_rationale:
      "You would need to know about an incident affecting your information, systems or a service you depend on, so the vendor's notification commitment is assessed.",
    not_applicable_rationale:
      "No incident at the vendor would affect your information, systems or a service you depend on, so customer notification is not assessed.",
  },
  {
    reference: "CAS-10",
    title: "Business-continuity and recovery capabilities appropriate to the service",
    description:
      "The vendor can continue or recover the service after a disruption, to targets proportionate to how the customer depends on it. A business-continuity or disaster-recovery plan with recovery objectives (RTO/RPO), backup arrangements and evidence of a recent test would satisfy this.",
    tags: ["core", "resilience", "business-continuity"],
    domain: "resilience",
    why: "Continuity objective; resilience domain.",
    canonical_control_slugs: ["business-continuity-plan", "backup-and-restore"],
    signals: SIG("operational_dependency"),
    applies: (s) => s.operational_dependency,
    applicable_rationale:
      "Your operations depend on this service, so the vendor's ability to continue or recover it is assessed.",
    not_applicable_rationale:
      "Your operations do not materially depend on this service, so continuity and recovery are not assessed.",
  },
  {
    reference: "CAS-11",
    title: "Identification and management of material subcontractors, sub-processors and fourth parties",
    description:
      "The vendor identifies the third parties material to delivering the service, assesses them and flows down relevant security and privacy obligations. A maintained sub-processor list, a third-party risk process and contractual flow-down terms would satisfy this.",
    tags: ["core", "supply-chain", "subprocessor"],
    domain: "nth_party",
    why: "Supply-chain objective; nth-party domain.",
    canonical_control_slugs: ["third-party-risk-management"],
    signals: SIG("fourth_parties"),
    applies: (s) => s.fourth_parties,
    applicable_rationale:
      "The vendor relies on subcontractors, sub-processors or third-party models to deliver the service, so how it manages them is assessed.",
    not_applicable_rationale:
      "No material subcontractors, sub-processors or third-party models are declared for this service, so fourth-party management is not assessed.",
  },
  {
    reference: "CAS-12",
    title: "Vulnerability management for the technology used to provide the service",
    description:
      "Vulnerabilities in the systems and software that provide the service are identified and remediated on a risk basis. Regular vulnerability scanning, a remediation SLA by severity and evidence of recent results would satisfy this.",
    tags: ["core", "vulnerability-management"],
    domain: "security",
    why: "Technical-security objective; security domain.",
    canonical_control_slugs: ["vulnerability-identification"],
    signals: SIG("technology", "handles_data", "system_access", "operational_dependency"),
    applies: (s) => s.technology && (s.handles_data || s.system_access || s.operational_dependency),
    applicable_rationale:
      "Technology delivers this service and it touches your information, systems or operations, so how vulnerabilities in it are managed is assessed.",
    not_applicable_rationale:
      "Either no technology delivers this service, or it touches none of your information, systems or operations, so vulnerability management is not assessed.",
  },
  {
    reference: "CAS-13",
    title: "Risk-based patch management",
    description:
      "Security patches are applied to the systems that provide the service within timeframes set by risk. A patch-management standard with severity-based deadlines and evidence of patch compliance would satisfy this.",
    tags: ["core", "vulnerability-management"],
    domain: "security",
    why: "Technical-security objective; security domain.",
    canonical_control_slugs: ["secure-baseline-configuration", "change-management"],
    signals: SIG("technology", "handles_data", "system_access", "operational_dependency"),
    applies: (s) => s.technology && (s.handles_data || s.system_access || s.operational_dependency),
    applicable_rationale:
      "Technology delivers this service and it touches your information, systems or operations, so how it is patched is assessed.",
    not_applicable_rationale:
      "Either no technology delivers this service, or it touches none of your information, systems or operations, so patch management is not assessed.",
  },
  {
    reference: "CAS-14",
    title: "Protection of customer and sensitive information in transit and at rest",
    description:
      "Customer and sensitive information is encrypted in transit and at rest using current, industry-accepted methods. A statement of the protocols and algorithms used (for example, TLS 1.2+ in transit, AES-256 at rest) and how keys are managed would satisfy this.",
    tags: ["core", "encryption"],
    domain: "security",
    why: "Encryption objective; security domain. Not tagged data-protection for the same reason as CAS-05: the tag would move it under privacy, and it protects all customer information, personal or not.",
    canonical_control_slugs: ["encryption-in-transit", "encryption-at-rest"],
    signals: SIG("handles_data"),
    applies: (s) => s.handles_data,
    applicable_rationale:
      "The vendor handles your information, so how it is protected in transit and at rest is assessed.",
    not_applicable_rationale:
      "The vendor handles no customer or sensitive information, so protection in transit and at rest is not assessed.",
  },
  {
    reference: "CAS-15",
    title: "Data retention and secure disposal of customer information",
    description:
      "Customer information is retained only as long as needed and securely destroyed afterwards, including on termination of the service. A retention schedule, a secure-disposal standard and a commitment to return or destroy customer data on exit would satisfy this.",
    tags: ["core"],
    domain: "security",
    why: "Data-lifecycle objective; security domain. The retention/data-protection tags map to the privacy set, and this objective applies to all customer information, so it stays a security question.",
    canonical_control_slugs: ["media-sanitisation-and-disposal"],
    signals: SIG("handles_data"),
    applies: (s) => s.handles_data,
    applicable_rationale:
      "The vendor handles your information, so how long it is kept and how it is destroyed is assessed.",
    not_applicable_rationale:
      "The vendor handles no customer or sensitive information, so retention and disposal are not assessed.",
  },
  {
    reference: "CAS-16",
    title: "Processes for applicable legal, regulatory, contractual and privacy obligations",
    description:
      "The vendor identifies and meets the legal, regulatory, contractual and privacy obligations that apply to the service. A register of applicable obligations, an owner for compliance and evidence of how obligations are met (for example, a privacy programme or regulatory attestations) would satisfy this.",
    tags: ["core", "privacy"],
    domain: "privacy",
    why: "Obligation-management objective; asked under privacy because privacy and regulatory duties are what trigger it.",
    canonical_control_slugs: ["legal-and-regulatory-obligation-register"],
    signals: SIG("regulatory", "sensitive_data"),
    applies: (s) => s.regulatory || s.sensitive_data,
    applicable_rationale:
      "Regulatory, contractual or privacy obligations bear on this service, or it handles personal or sensitive data, so how the vendor meets those obligations is assessed.",
    not_applicable_rationale:
      "No regulatory, contractual or privacy obligation bears on this service and it handles no personal or sensitive data, so obligation management is not assessed.",
  },
] as const;

export const CORE_ASSURANCE_REFERENCES: readonly string[] = CORE_ASSURANCE_OBJECTIVES.map(
  (o) => o.reference
);

const BY_REFERENCE = new Map(CORE_ASSURANCE_OBJECTIVES.map((o) => [o.reference, o]));

export function coreAssuranceObjective(reference: string): CoreAssuranceObjective | null {
  return BY_REFERENCE.get(reference) ?? null;
}

export type CoreApplicabilityDecision = {
  reference: string;
  rule_id: string;
  applicable: boolean;
  rationale: string;
  /** The signal VALUES read and the fact VALUES behind them — a by-value basis. */
  basis: {
    core_assurance_version: string;
    signals: Partial<ExposureSignals>;
    facts: Record<string, unknown>;
  };
};

/**
 * Decide one objective from the fact surface. Deterministic: the same facts
 * always produce the same decision and the same basis.
 */
export function decideCoreApplicability(
  objective: CoreAssuranceObjective,
  facts: FactSet,
  signals: ExposureSignals = deriveExposureSignals(facts)
): CoreApplicabilityDecision {
  const applicable = objective.applies(signals);
  const readSignals: Partial<ExposureSignals> = {};
  const readFacts: Record<string, unknown> = {};
  for (const name of objective.signals) {
    readSignals[name] = signals[name];
    for (const key of SIGNAL_FACT_KEYS[name]) {
      const f = facts[key];
      if (f !== undefined) readFacts[key] = f.value;
    }
  }
  return {
    reference: objective.reference,
    rule_id: coreAssuranceRuleId(objective.reference),
    applicable,
    rationale: applicable ? objective.applicable_rationale : objective.not_applicable_rationale,
    basis: {
      core_assurance_version: CORE_ASSURANCE_SET_VERSION,
      signals: readSignals,
      facts: readFacts,
    },
  };
}
