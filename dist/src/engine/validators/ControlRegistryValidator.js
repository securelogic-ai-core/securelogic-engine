"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ControlRegistryValidator = void 0;
const ControlRegistry_1 = require("../registry/ControlRegistry");
const ControlStateFactory_1 = require("../factories/ControlStateFactory");
const extractControlPaths_1 = require("../utils/extractControlPaths");
class ControlRegistryValidator {
    static validate() {
        const state = ControlStateFactory_1.ControlStateFactory.create();
        const statePaths = (0, extractControlPaths_1.extractControlPaths)(state);
        const registryPaths = Object.keys(ControlRegistry_1.ControlRegistry.controls);
        const missingInRegistry = statePaths.filter(p => !registryPaths.includes(p));
        const extraInRegistry = registryPaths.filter(p => !statePaths.includes(p));
        if (missingInRegistry.length || extraInRegistry.length) {
            throw new Error([
                missingInRegistry.length
                    ? `Missing in registry:\n${missingInRegistry.join("\n")}`
                    : "",
                extraInRegistry.length
                    ? `Extra in registry:\n${extraInRegistry.join("\n")}`
                    : ""
            ].filter(Boolean).join("\n\n"));
        }
    }
}
exports.ControlRegistryValidator = ControlRegistryValidator;
