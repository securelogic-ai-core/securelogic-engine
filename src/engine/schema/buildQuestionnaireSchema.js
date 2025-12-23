"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuestionnaireSchema = void 0;
var zod_1 = require("zod");
var ControlRegistry_1 = require("../registry/ControlRegistry");
function buildControlsSchema() {
    var _a;
    var _b;
    var shape = {};
    for (var _i = 0, _c = Object.keys(ControlRegistry_1.ControlRegistry.controls); _i < _c.length; _i++) {
        var path = _c[_i];
        var parts = path.split(".");
        var current = shape;
        for (var i = 0; i < parts.length - 1; i++) {
            (_a = current[_b = parts[i]]) !== null && _a !== void 0 ? _a : (current[_b] = {});
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
