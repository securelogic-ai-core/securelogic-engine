import { z } from "zod";
import type { UnifiedRiskObject } from "../types/URO";

// Document schema
const documentSchema = z.object({
  name: z.string(),
  type: z.string(),
  content: z.string(),
  extractedText: z.string().nullable().optional()
});

// Overrides schema
const overridesSchema = z.object({
  enableControls: z.array(z.string()).optional(),
  disableControls: z.array(z.string()).optional(),
  adjustLikelihood: z.record(z.string(), z.number()).optional(),
  adjustImpact: z.record(z.string(), z.number()).optional()
});

// Unified Risk Object v1.0 Schema
const UROSchema = z.object({
  size: z.enum(["small", "medium", "large"]),
  triggers: z.array(z.string()),
  _version: z.literal("1.0.0"),

  system: z.object({
    name: z.string(),
    description: z.string(),
    owner: z.string(),
    criticality: z.enum(["low", "medium", "high", "mission_critical"]),
    lifecycleStage: z.enum(["design", "development", "deployment", "monitoring"])
  }),

  metadata: z.object({
    industry: z.string(),
    jurisdiction: z.array(z.string()),
    vendorTier: z.enum(["tier1", "tier2", "tier3", "internal"]),
    dataTypes: z.array(z.string()),
    deploymentModel: z.enum(["saas", "onprem", "hybrid", "unknown"])
  }),

  structuredAnswers: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean()])
  ),

  documents: z.array(documentSchema).optional(),

  signals: z.object({
    missingPolicies: z.array(z.string()).optional(),
    foundControls: z.array(z.string()).optional(),
    gapsDetected: z.array(z.string()).optional(),
    riskIndicators: z.array(z.string()).optional()
  }).optional(),

  overrides: overridesSchema.optional(),
  engineVersion: z.string(),
  ingestionNotes: z.array(z.string()).optional()
});

export function validateURO(input: unknown): UnifiedRiskObject {
  const parsed = UROSchema.safeParse(input);
  if (!parsed.success) {
    console.error("❌ URO VALIDATION FAILED:", parsed.error.format());
    throw new Error("Invalid Unified Risk Object payload.");
  }
  return parsed.data;
}
