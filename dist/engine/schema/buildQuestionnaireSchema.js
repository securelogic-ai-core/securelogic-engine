"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuestionnaireSchema = void 0;
const zod_1 = require("zod");
const ControlRegistry_1 = require("../registry/ControlRegistry");
function buildControlsSchema() {
    var _a;
    const shape = {};
    for (const path of Object.keys(ControlRegistry_1.ControlRegistry.controls)) {
        const parts = path.split(".");
        let current = shape;
        for (let i = 0; i < parts.length - 1; i++) {
            current[_a = parts[i]] ?? (current[_a] = {});
            current = current[parts[i]];
        }
        current[parts[parts.length - 1]] = zod_1.z.boolean();
    }
    return zod_1.z.object(shape);
}
exports.QuestionnaireSchema = zod_1.z.object({
    orgProfile: zod_1.z.object({
        industry: zod_1.z.string(),
        size: zod_1.z.enum(["SMB", "Mid-Market", "Enterprise"]),
        aiUsage: zod_1.z.array(zod_1.z.string()),
        modelTypes: zod_1.z.array(zod_1.z.string())
    }),
    controls: buildControlsSchema()
});
