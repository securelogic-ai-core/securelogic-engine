"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ControlsArraySchema = exports.ControlSchema = void 0;
var zod_1 = require("zod");
exports.ControlSchema = zod_1.z.object({
    id: zod_1.z.string(),
    impact: zod_1.z.number().min(1).max(5).default(1),
    likelihood: zod_1.z.number().min(1).max(5).default(1),
    domain: zod_1.z.string().optional(),
    title: zod_1.z.string().optional(),
    description: zod_1.z.string().optional()
});
exports.ControlsArraySchema = zod_1.z.array(exports.ControlSchema);
