"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ControlRegistryValidator = void 0;
var ControlRegistry_1 = require("../registry/ControlRegistry");
var ControlStateFactory_1 = require("../factories/ControlStateFactory");
var extractControlPaths_1 = require("../utils/extractControlPaths");
var ControlRegistryValidator = /** @class */ (function () {
    function ControlRegistryValidator() {
    }
    ControlRegistryValidator.validate = function () {
        var state = ControlStateFactory_1.ControlStateFactory.create();
        var statePaths = (0, extractControlPaths_1.extractControlPaths)(state);
        var registryPaths = Object.keys(ControlRegistry_1.ControlRegistry.controls);
        var missingInRegistry = statePaths.filter(function (p) { return !registryPaths.includes(p); });
        var extraInRegistry = registryPaths.filter(function (p) { return !statePaths.includes(p); });
        if (missingInRegistry.length || extraInRegistry.length) {
            throw new Error([
                missingInRegistry.length
                    ? "Missing in registry:\n".concat(missingInRegistry.join("\n"))
                    : "",
                extraInRegistry.length
                    ? "Extra in registry:\n".concat(extraInRegistry.join("\n"))
                    : ""
            ].filter(Boolean).join("\n\n"));
        }
    };
    return ControlRegistryValidator;
}());
exports.ControlRegistryValidator = ControlRegistryValidator;
