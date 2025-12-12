"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SystemInvariantValidator = void 0;
const ControlRegistry_1 = require("../registry/ControlRegistry");
const ControlStateFactory_1 = require("../factories/ControlStateFactory");
function extractPaths(obj, prefix = "") {
    return Object.entries(obj).flatMap(([k, v]) => typeof v === "object"
        ? extractPaths(v, prefix ? `${prefix}.${k}` : k)
        : [`${prefix}.${k}`]);
}
class SystemInvariantValidator {
    static validate() {
        const state = ControlStateFactory_1.ControlStateFactory.create();
        const statePaths = extractPaths(state);
        const registryPaths = Object.keys(ControlRegistry_1.ControlRegistry.controls);
        const missing = registryPaths.filter(p => !statePaths.includes(p));
        const extra = statePaths.filter(p => !registryPaths.includes(p));
        if (missing.length || extra.length) {
            throw new Error([
                "SYSTEM INVARIANT VIOLATION",
                missing.length ? `Missing:\n${missing.join("\n")}` : "",
                extra.length ? `Extra:\n${extra.join("\n")}` : ""
            ].filter(Boolean).join("\n\n"));
        }
    }
}
exports.SystemInvariantValidator = SystemInvariantValidator;
