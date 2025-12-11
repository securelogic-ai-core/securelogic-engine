"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuestionnaireSchema = void 0;
const zod_1 = require("zod");
exports.QuestionnaireSchema = zod_1.z.object({
    orgProfile: zod_1.z.object({
        industry: zod_1.z.string(),
        size: zod_1.z.enum(["SMB", "Mid-Market", "Enterprise"]),
        aiUsage: zod_1.z.array(zod_1.z.string()),
        modelTypes: zod_1.z.array(zod_1.z.string())
    }),
    governance: zod_1.z.object({
        aiGovernanceDocumented: zod_1.z.boolean(),
        riskOwnerAssigned: zod_1.z.boolean()
    }),
    controls: zod_1.z.object({
        modelMonitoring: zod_1.z.boolean(),
        biasTesting: zod_1.z.boolean(),
        incidentResponseForAI: zod_1.z.boolean(),
        inventoryMaintained: zod_1.z.boolean()
    })
});
