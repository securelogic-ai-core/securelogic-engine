"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateURO = validateURO;
var zod_1 = require("zod");
// Document schema
var documentSchema = zod_1.z.object({
    name: zod_1.z.string(),
    type: zod_1.z.string(),
    content: zod_1.z.string(),
    extractedText: zod_1.z.string().nullable().optional()
});
// Overrides schema
var overridesSchema = zod_1.z.object({
    enableControls: zod_1.z.array(zod_1.z.string()).optional(),
    disableControls: zod_1.z.array(zod_1.z.string()).optional(),
    adjustLikelihood: zod_1.z.record(zod_1.z.string(), zod_1.z.number()).optional(),
    adjustImpact: zod_1.z.record(zod_1.z.string(), zod_1.z.number()).optional()
});
// Unified Risk Object v1.0 Schema
var UROSchema = zod_1.z.object({
    size: zod_1.z.enum(["small", "medium", "large"]),
    triggers: zod_1.z.array(zod_1.z.string()),
    _version: zod_1.z.literal("1.0.0"),
    system: zod_1.z.object({
        name: zod_1.z.string(),
        description: zod_1.z.string(),
        owner: zod_1.z.string(),
        criticality: zod_1.z.enum(["low", "medium", "high", "mission_critical"]),
        lifecycleStage: zod_1.z.enum(["design", "development", "deployment", "monitoring"])
    }),
    metadata: zod_1.z.object({
        industry: zod_1.z.string(),
        jurisdiction: zod_1.z.array(zod_1.z.string()),
        vendorTier: zod_1.z.enum(["tier1", "tier2", "tier3", "internal"]),
        dataTypes: zod_1.z.array(zod_1.z.string()),
        deploymentModel: zod_1.z.enum(["saas", "onprem", "hybrid", "unknown"])
    }),
    structuredAnswers: zod_1.z.record(zod_1.z.string(), zod_1.z.union([zod_1.z.string(), zod_1.z.number(), zod_1.z.boolean()])),
    documents: zod_1.z.array(documentSchema).optional(),
    signals: zod_1.z.object({
        missingPolicies: zod_1.z.array(zod_1.z.string()).optional(),
        foundControls: zod_1.z.array(zod_1.z.string()).optional(),
        gapsDetected: zod_1.z.array(zod_1.z.string()).optional(),
        riskIndicators: zod_1.z.array(zod_1.z.string()).optional()
    }).optional(),
    overrides: overridesSchema.optional(),
    engineVersion: zod_1.z.string(),
    ingestionNotes: zod_1.z.array(zod_1.z.string()).optional()
});
function validateURO(input) {
    var parsed = UROSchema.safeParse(input);
    if (!parsed.success) {
        console.error("❌ URO VALIDATION FAILED:", parsed.error.format());
        throw new Error("Invalid Unified Risk Object payload.");
    }
    return parsed.data;
}
