/**
 * vendorEngagementIntake.ts — the intake form's field definitions.
 *
 * MIRRORS the engine's scoring enums (src/api/lib/vendorRisk/inherentRisk.ts).
 * The app cannot import engine source, so these are transcribed — the engine
 * remains the enforcer: a drifted value is rejected with a 400 whose `invalid`
 * entries carry the currently-allowed list, which the form surfaces verbatim.
 * If these lists ever drift, the form still cannot submit a value the engine
 * will score wrongly; it only shows a stale choice the engine then refuses.
 *
 * Every field is REQUIRED by the engine — a defaulted inherent-risk input would
 * produce a confident score from answers nobody gave, so the form offers no
 * defaults and submits nothing until every question is answered.
 */

export type IntakeFieldDef = {
  name: string;
  label: string;
  help: string;
  options: readonly { value: string; label: string }[];
};

export const INTAKE_FIELDS: readonly IntakeFieldDef[] = [
  {
    name: "data_sensitivity",
    label: "Data sensitivity",
    help: "The most sensitive class of data the vendor touches.",
    options: [
      { value: "none", label: "None" },
      { value: "internal", label: "Internal" },
      { value: "confidential", label: "Confidential" },
      { value: "restricted", label: "Restricted" },
    ],
  },
  {
    name: "data_volume",
    label: "Data volume",
    help: "How much of that data the vendor holds or processes.",
    options: [
      { value: "minimal", label: "Minimal" },
      { value: "moderate", label: "Moderate" },
      { value: "large", label: "Large" },
      { value: "mass", label: "Mass" },
    ],
  },
  {
    name: "access_level",
    label: "Access level",
    help: "The deepest access the vendor has into your environment.",
    options: [
      { value: "none", label: "None" },
      { value: "read_only", label: "Read-only" },
      { value: "read_write", label: "Read/write" },
      { value: "admin", label: "Admin" },
      { value: "network_access", label: "Network access" },
    ],
  },
  {
    name: "operational_dependency",
    label: "Operational dependency",
    help: "How much day-to-day operation depends on this vendor.",
    options: [
      { value: "low", label: "Low" },
      { value: "moderate", label: "Moderate" },
      { value: "high", label: "High" },
      { value: "critical", label: "Critical" },
    ],
  },
  {
    name: "recoverability",
    label: "Recoverability",
    help: "How quickly you could recover if the vendor failed.",
    options: [
      { value: "hours", label: "Hours" },
      { value: "days", label: "Days" },
      { value: "weeks", label: "Weeks" },
      { value: "none", label: "No practical recovery" },
    ],
  },
  {
    name: "business_criticality",
    label: "Business criticality",
    help: "Business impact of the service the vendor provides.",
    options: [
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
      { value: "critical", label: "Critical" },
    ],
  },
  {
    name: "regulatory_exposure",
    label: "Regulatory exposure",
    help: "Regulatory obligations the vendor relationship carries.",
    options: [
      { value: "none", label: "None" },
      { value: "low", label: "Low" },
      { value: "moderate", label: "Moderate" },
      { value: "high", label: "High" },
    ],
  },
  {
    name: "ai_involvement",
    label: "AI involvement",
    help: "Whether the vendor's service embeds AI, and how centrally.",
    options: [
      { value: "none", label: "None" },
      { value: "embedded", label: "Embedded" },
      { value: "core", label: "Core to the service" },
    ],
  },
  {
    name: "ai_autonomy",
    label: "AI autonomy",
    help: "How autonomously the vendor's AI acts (NIST AI RMF shape). 'None' when AI involvement is none.",
    options: [
      { value: "none", label: "None" },
      { value: "human_in_the_loop", label: "Human in the loop" },
      { value: "human_on_the_loop", label: "Human on the loop" },
      { value: "autonomous_consequential", label: "Autonomous, consequential decisions" },
    ],
  },
  {
    name: "hosting_model",
    label: "Hosting model",
    help: "Where the vendor's service runs.",
    options: [
      { value: "on_prem", label: "On-premises" },
      { value: "private_cloud", label: "Private cloud" },
      { value: "saas", label: "SaaS" },
      { value: "multi_tenant_saas", label: "Multi-tenant SaaS" },
    ],
  },
  {
    name: "fourth_party_exposure",
    label: "Fourth-party exposure",
    help: "How much the vendor itself depends on further subprocessors.",
    options: [
      { value: "none", label: "None" },
      { value: "low", label: "Low" },
      { value: "moderate", label: "Moderate" },
      { value: "high", label: "High" },
    ],
  },
  {
    name: "concentration",
    label: "Concentration",
    help: "Single-vendor concentration risk across your estate.",
    options: [
      { value: "none", label: "None" },
      { value: "low", label: "Low" },
      { value: "moderate", label: "Moderate" },
      { value: "single_point_of_failure", label: "Single point of failure" },
    ],
  },
] as const;

export const ENGAGEMENT_TYPES = [
  { value: "initial", label: "Initial" },
  { value: "periodic", label: "Periodic" },
  { value: "targeted", label: "Targeted" },
  { value: "event_driven", label: "Event-driven" },
] as const;
