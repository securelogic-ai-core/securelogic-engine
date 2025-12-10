"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScoreRequestSchema = exports.IntakeSchema = exports.ControlSchema = void 0;
const zod_1 = require("zod");
exports.ControlSchema = zod_1.z.object({
    id: zod_1.z.string(),
    category: zod_1.z.string(),
    severity: zod_1.z.number().min(0).max(10),
    implemented: zod_1.z.boolean()
});
exports.IntakeSchema = zod_1.z.object({
    organizationSize: zod_1.z.number().int().positive().optional(),
    industry: zod_1.z.string().optional(),
    dataSensitivity: zod_1.z.string().optional()
}).strict();
exports.ScoreRequestSchema = zod_1.z.object({
    controls: zod_1.z.array(exports.ControlSchema),
    intake: exports.IntakeSchema
}).strict();
