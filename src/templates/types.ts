/**
 * Industry starter template types.
 *
 * Static, code-shipped curation. Each industry file (healthcare-saas.ts,
 * fintech.ts, b2b-ai.ts) populates the Template structure verbatim from
 * the curation appendix. The loader (src/api/lib/templateLoader.ts) reads
 * these files at request time.
 *
 * Field mapping to existing schema:
 *
 *   TemplateVendor.name        → vendors.name
 *   TemplateVendor.criticality → vendors.criticality (CHECK enum)
 *   TemplateVendor.category    → vendors.category
 *   TemplateVendor.description → vendors.service_description (column name
 *                                differs from the curation field name; the
 *                                loader maps description → service_description)
 *   TemplateVendor.flags       → vendors.template_metadata.flags (JSONB)
 *
 *   TemplateObligation.regulation_name → obligations.title (column is
 *                                        called `title`, dedup is on
 *                                        (organization_id, title)) AND
 *                                        obligations.source_regulation (the
 *                                        column the signal→obligation matcher
 *                                        keys regulation-family identity off —
 *                                        see signalTargetMatching.ts). The same
 *                                        clean family-style string feeds both.
 *   TemplateObligation.jurisdiction    → obligations.jurisdiction
 *   TemplateObligation.priority        → obligations.priority (CHECK enum)
 *   TemplateObligation.description     → obligations.description
 *
 *   TemplateControl.name          → controls.name
 *   TemplateControl.description   → controls.description
 *   TemplateControl.framework_ref → loader resolves to a per-org
 *                                   frameworks(id) and creates a synthetic
 *                                   requirement + control_mapping. There
 *                                   is no framework_id column on controls
 *                                   directly; the linkage is via
 *                                   control_mappings → requirements →
 *                                   frameworks.
 *
 * needs_review semantics
 *   Set to true on entries the curation flagged as uncertain (regulatory
 *   flux, draft-rule references, jurisdictional ambiguity, historical
 *   reference retained for due-diligence purposes). A template containing
 *   ANY needs_review:true entry is gated to non-production environments
 *   via SECURELOGIC_INDUSTRY_TEMPLATES_ENABLED until domain expert review
 *   clears the entries — at which point either the flag is removed (entry
 *   confirmed correct) or the entry is updated (curation revised).
 *
 *   The flag is INSPECTED by the loader/route gate, not LOADED into the
 *   destination tables — there is no needs_review column on vendors /
 *   obligations / controls. Once a row lands in the customer's inventory
 *   it is indistinguishable from a manually-entered row except for the
 *   analytics-only template_source column.
 *
 * version + last_reviewed_at
 *   version is semver, bumped on any content change in the file. Bump
 *   policy lives in data/templates/README.md.
 *   last_reviewed_at is the ISO date the curation was last walked
 *   end-to-end against current regulation. Independent of version: a
 *   review pass that finds zero changes still bumps last_reviewed_at.
 */

export type IndustryId = "healthcare-saas" | "fintech" | "b2b-ai";

/**
 * Frameworks the curated controls reference. Slugs are stable identifiers
 * used in TemplateControl.framework_ref; the loader maps each slug to the
 * (name, version) pair upserted into the per-org frameworks table.
 *
 * If a template references a slug not in this map, the loader fails the
 * whole transaction — better than silently dropping framework linkage.
 */
export type FrameworkRef =
  | "nist-csf-2.0"
  | "nist-csf-1.1"
  | "nist-ai-rmf"
  | "nist-sp-800-53"
  | "iso-27001"
  | "iso-42001"
  | "soc2"
  | "hipaa-security-rule"
  | "pci-dss-4.0.1"
  | "ny-dfs-23-nycrr-500"
  | "eu-ai-act"
  | "gdpr"
  | "hitrust";

export type VendorCriticality = "critical" | "high" | "medium" | "low";

export type ObligationPriority = "immediate" | "near_term" | "planned" | "watch";

/**
 * Per-vendor flags landed into vendors.template_metadata under
 * { flags: { ... } }. None of these correspond to first-class columns on
 * vendors today; encoded in JSONB to preserve curation intent without
 * five new boolean columns. If a flag becomes a hot-path query (e.g.
 * "list all PHI-processing vendors"), promote it to a column at that
 * point with a one-shot backfill.
 */
export type TemplateVendorFlags = {
  processes_pii?: boolean;
  processes_phi?: boolean;
  processes_payment_data?: boolean;
  processes_ai_inference?: boolean;
  baa_required?: boolean;
};

export type TemplateVendor = {
  /**
   * Stable identifier for the row, used by the preview UI to address
   * checkbox state in URL params. Format: `{industry}:vendor:{slug}`.
   * The slug is a kebab-case form of the vendor name.
   */
  id: string;
  name: string;
  criticality: VendorCriticality;
  category: string;
  description: string;
  flags?: TemplateVendorFlags;
  needs_review?: boolean;
};

export type TemplateObligation = {
  /** `{industry}:obligation:{slug}` */
  id: string;
  /** Maps to obligations.title (column name differs). */
  regulation_name: string;
  jurisdiction: string;
  priority: ObligationPriority;
  description: string;
  needs_review?: boolean;
};

export type TemplateControl = {
  /** `{industry}:control:{slug}` */
  id: string;
  name: string;
  description: string;
  framework_ref: FrameworkRef;
  needs_review?: boolean;
};

export type TemplateAiSystem = {
  /** `{industry}:ai_system:{slug}` */
  id: string;
  name: string;
  use_case: string;
  criticality: VendorCriticality;
  data_classification?: string;
  needs_review?: boolean;
};

export type Template = {
  id: IndustryId;
  name: string;
  /**
   * Rendered description. Implementations use a getter that calls
   * `composeTemplateDescription` so counts derive from the arrays at
   * access time and cannot drift from actual content. Curators author
   * two qualitative strings (`intro` + `frameworksFocus`) as
   * module-local consts in each template file; the helper composes
   * the final sentence.
   *
   * Type stays `string` because consumers (engine route, /templates
   * page) read it as a plain string — getters serialize over JSON and
   * survive object spread.
   */
  description: string;
  /**
   * Semver. Bump on any content change. The loader does not read this at
   * load time, but the analytics layer pivots on it (e.g. "what
   * percentage of healthcare-saas:1.2.0 loads include the EU GDPR
   * obligation?"). Templates from before the version field landed will
   * have version='0.0.0' — do not gate on a minimum version.
   */
  version: string;
  /** ISO date YYYY-MM-DD. */
  last_reviewed_at: string;
  vendors: TemplateVendor[];
  /**
   * Always empty in v1. The TS type is in place so a future package can
   * populate without a type change. v1 design decision: foundation model
   * providers (OpenAI, Anthropic, etc.) are vendors, not ai_systems —
   * the latter represent the customer's own AI features, which the
   * customer enters manually after template load.
   */
  ai_systems: TemplateAiSystem[];
  obligations: TemplateObligation[];
  controls: TemplateControl[];
};

/**
 * Helper for the loader. True if any entry in any section carries
 * needs_review:true. The /templates page and the dashboard banner
 * inspect this to decide whether to expose the template at all in a
 * given environment (gated by SECURELOGIC_INDUSTRY_TEMPLATES_ENABLED).
 */
export function templateHasUnreviewedEntries(template: Template): boolean {
  if (template.vendors.some((v) => v.needs_review === true)) return true;
  if (template.obligations.some((o) => o.needs_review === true)) return true;
  if (template.controls.some((c) => c.needs_review === true)) return true;
  if (template.ai_systems.some((a) => a.needs_review === true)) return true;
  return false;
}

/**
 * Single source of truth for the rendered description format.
 *
 * Curators do NOT write counts. They author two qualitative strings:
 *   - `intro`           : "For X — sub-domain bullets..." (no counts)
 *   - `frameworksFocus` : "aligned to NIST CSF 2.0 with HIPAA cross-mapping"
 *
 * Each template's description property is implemented as a getter that
 * calls this helper with `this.vendors.length`, `this.obligations.length`,
 * and `this.controls.length`. That guarantees the rendered counts match
 * the actual arrays at access time — no opportunity for the description
 * to drift from the content.
 *
 * Format changes here apply across all three v1 templates uniformly. If
 * you change the format string, bump the version on every template
 * whose surface text changes.
 */
export function composeTemplateDescription(parts: {
  intro: string;
  vendorCount: number;
  obligationCount: number;
  controlCount: number;
  frameworksFocus: string;
}): string {
  return (
    `${parts.intro} ` +
    `Loads ${parts.vendorCount} vendors, ` +
    `${parts.obligationCount} obligations, ` +
    `and ${parts.controlCount} controls ${parts.frameworksFocus}.`
  );
}
