/**
 * Industry-template registry. Single source of truth for which industries
 * exist, lookup by id, and the framework-slug → (name, version) mapping
 * the loader uses to upsert per-org frameworks rows.
 */

import type { FrameworkRef, IndustryId, Template } from "./types.js";
import { HEALTHCARE_SAAS_TEMPLATE } from "./healthcare-saas.js";
import { FINTECH_TEMPLATE } from "./fintech.js";
import { B2B_AI_TEMPLATE } from "./b2b-ai.js";

export const TEMPLATES: Record<IndustryId, Template> = {
  "healthcare-saas": HEALTHCARE_SAAS_TEMPLATE,
  "fintech":         FINTECH_TEMPLATE,
  "b2b-ai":          B2B_AI_TEMPLATE,
};

export const ALL_INDUSTRIES: readonly IndustryId[] = [
  "healthcare-saas",
  "fintech",
  "b2b-ai",
] as const;

export function getTemplate(id: IndustryId): Template {
  return TEMPLATES[id];
}

export function isIndustryId(value: unknown): value is IndustryId {
  return (
    typeof value === "string" &&
    (ALL_INDUSTRIES as readonly string[]).includes(value)
  );
}

/**
 * Framework slug → (name, version) for the per-org frameworks upsert.
 *
 * Versions are aligned to the curation references — note where they
 * differ from existing FRAMEWORK_TEMPLATES entries:
 *   - NIST CSF: curation says "2.0"; FRAMEWORK_TEMPLATES has "1.1".
 *     Loader creates a separate "NIST Cybersecurity Framework / 2.0"
 *     row alongside the existing "1.1" row (frameworks UNIQUE is on
 *     name+version+org, so they coexist).
 *   - PCI DSS: curation says "4.0.1"; FRAMEWORK_TEMPLATES has "4.0".
 *     Same coexist behavior.
 *   - ISO/IEC 42001, EU AI Act, NY DFS 23 NYCRR 500: not in
 *     FRAMEWORK_TEMPLATES at all; first-time creation per org.
 *
 * Adding a new FrameworkRef requires updating BOTH the type union in
 * types.ts AND this map. Compile fails otherwise (Record exhaustiveness).
 */
export const FRAMEWORK_REFS: Record<FrameworkRef, { name: string; version: string }> = {
  "nist-csf-2.0":         { name: "NIST Cybersecurity Framework", version: "2.0" },
  "nist-csf-1.1":         { name: "NIST Cybersecurity Framework", version: "1.1" },
  "nist-ai-rmf":          { name: "NIST AI RMF",                   version: "1.0" },
  "nist-sp-800-53":       { name: "NIST SP 800-53",                version: "Rev 5" },
  "iso-27001":            { name: "ISO/IEC 27001",                 version: "2022" },
  "iso-42001":            { name: "ISO/IEC 42001",                 version: "2023" },
  "soc2":                 { name: "SOC 2 Type II",                 version: "2017" },
  "hipaa-security-rule":  { name: "HIPAA Security Rule",           version: "2024" },
  "pci-dss-4.0.1":        { name: "PCI DSS",                       version: "4.0.1" },
  "ny-dfs-23-nycrr-500":  { name: "NY DFS 23 NYCRR 500",           version: "2024" },
  "eu-ai-act":            { name: "EU AI Act",                     version: "2024" },
  "gdpr":                 { name: "GDPR",                          version: "2018" },
  "hitrust":              { name: "HITRUST CSF",                   version: "11.0" },
};

export type { Template, IndustryId, FrameworkRef } from "./types.js";
export {
  templateHasUnreviewedEntries,
  type TemplateVendor,
  type TemplateObligation,
  type TemplateControl,
  type TemplateAiSystem,
  type TemplateVendorFlags,
} from "./types.js";
