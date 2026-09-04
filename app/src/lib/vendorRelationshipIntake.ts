/**
 * vendorRelationshipIntake.ts — Onboarding 2.0 relationship intake, field
 * definitions. MIRRORS the engine's level vocabularies (criticality.ts and
 * inherentRiskV2.ts); the app cannot import engine source, so these are
 * transcribed and the engine remains the enforcer — a drifted value is
 * refused with a 400 naming the field.
 *
 * Two groups, because they answer two different questions and feed two PEER
 * engines that never see each other's output:
 *
 *   DEPENDENCY — "how much does the business depend on this?"  -> Criticality
 *   EXPOSURE   — "what does this relationship expose us to?"    -> Inherent risk
 *
 * Nothing here is a classification. Every field is required.
 */
export type IntakeFieldDef = {
  name: string;
  label: string;
  help: string;
  options: readonly { value: string; label: string }[];
};

export const DEPENDENCY_FIELDS: readonly IntakeFieldDef[] = [
  { name: "max_tolerable_disruption", label: "Maximum tolerable disruption", help: "How long could the business operate acceptably without this service?",
    options: [ { value: "gt_1_month", label: "More than a month" }, { value: "1_week_to_1_month", label: "One week to a month" }, { value: "1_to_7_days", label: "One to seven days" }, { value: "lt_24_hours", label: "Less than 24 hours" } ] },
  { name: "operational_dependency", label: "Operational dependency", help: "How much of day-to-day operation depends on it?",
    options: [ { value: "incidental", label: "Incidental" }, { value: "supporting", label: "Supporting" }, { value: "significant", label: "Significant" }, { value: "essential", label: "Essential" } ] },
  { name: "business_reach", label: "Business reach", help: "How much of the organisation is affected if it degrades?",
    options: [ { value: "single_team", label: "A single team" }, { value: "single_function", label: "A single function" }, { value: "multi_function", label: "Several functions" }, { value: "enterprise_wide", label: "Enterprise-wide" } ] },
  { name: "process_coupling", label: "Process coupling", help: "Where does it sit in your business processes?",
    options: [ { value: "peripheral", label: "Peripheral" }, { value: "supports_critical_path", label: "Supports a critical path" }, { value: "in_critical_path", label: "In a critical path" }, { value: "embedded_no_manual_fallback", label: "Embedded, no manual fallback" } ] },
  { name: "substitutability", label: "Substitutability", help: "How replaceable is it, and how quickly?",
    options: [ { value: "interchangeable", label: "Interchangeable" }, { value: "replaceable_weeks", label: "Replaceable in weeks" }, { value: "replaceable_months", label: "Replaceable in months" }, { value: "no_viable_alternative", label: "No viable alternative" } ] },
  { name: "concentration", label: "Concentration", help: "How concentrated is your dependence on this one supplier?",
    options: [ { value: "none", label: "None" }, { value: "low", label: "Low" }, { value: "moderate", label: "Moderate" }, { value: "single_point_of_failure", label: "Single point of failure" } ] },
];

export const EXPOSURE_FIELDS: readonly IntakeFieldDef[] = [
  { name: "data_sensitivity", label: "Data sensitivity", help: "The most sensitive class of data the vendor touches.",
    options: [ { value: "none", label: "None" }, { value: "internal", label: "Internal" }, { value: "confidential", label: "Confidential" }, { value: "restricted", label: "Restricted" } ] },
  { name: "data_volume", label: "Data volume", help: "How much of that data the vendor holds or processes.",
    options: [ { value: "minimal", label: "Minimal" }, { value: "moderate", label: "Moderate" }, { value: "large", label: "Large" }, { value: "mass", label: "Mass" } ] },
  { name: "access_level", label: "Access level", help: "The deepest access the vendor has into your environment.",
    options: [ { value: "none", label: "None" }, { value: "read_only", label: "Read-only" }, { value: "read_write", label: "Read/write" }, { value: "admin", label: "Admin" }, { value: "network_access", label: "Network access" } ] },
  { name: "regulatory_exposure", label: "Regulatory exposure", help: "Regulatory obligations the relationship carries.",
    options: [ { value: "none", label: "None" }, { value: "low", label: "Low" }, { value: "moderate", label: "Moderate" }, { value: "high", label: "High" } ] },
  { name: "ai_involvement", label: "AI involvement", help: "Whether the service embeds AI, and how centrally.",
    options: [ { value: "none", label: "None" }, { value: "embedded", label: "Embedded" }, { value: "core", label: "Core to the service" } ] },
  { name: "ai_autonomy", label: "AI autonomy", help: "How autonomously that AI acts. 'None' when AI involvement is none.",
    options: [ { value: "none", label: "None" }, { value: "human_in_the_loop", label: "Human in the loop" }, { value: "human_on_the_loop", label: "Human on the loop" }, { value: "autonomous_consequential", label: "Autonomous, consequential decisions" } ] },
  { name: "hosting_model", label: "Hosting model", help: "Where the service runs.",
    options: [ { value: "on_prem", label: "On-premises" }, { value: "private_cloud", label: "Private cloud" }, { value: "saas", label: "SaaS" }, { value: "multi_tenant_saas", label: "Multi-tenant SaaS" } ] },
  { name: "fourth_party_exposure", label: "Fourth-party exposure", help: "How much the vendor itself depends on further subprocessors.",
    options: [ { value: "none", label: "None" }, { value: "low", label: "Low" }, { value: "moderate", label: "Moderate" }, { value: "high", label: "High" } ] },
];

export const TIER_LABELS: Record<string, string> = {
  tier_1_critical: "Tier 1 — Critical",
  tier_2_high: "Tier 2 — High",
  tier_3_moderate: "Tier 3 — Moderate",
  tier_4_low: "Tier 4 — Low",
};
