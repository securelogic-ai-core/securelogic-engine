"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SystemInvariantValidator = void 0;
var ControlRegistry_1 = require("../registry/ControlRegistry");
var ControlStateFactory_1 = require("../factories/ControlStateFactory");
function extractPaths(obj, prefix) {
    if (prefix === void 0) { prefix = ""; }
    return Object.entries(obj).flatMap(function (_a) {
        var k = _a[0], v = _a[1];
        return typeof v === "object"
            ? extractPaths(v, prefix ? "".concat(prefix, ".").concat(k) : k)
            : ["".concat(prefix, ".").concat(k)];
    });
}
var SystemInvariantValidator = /** @class */ (function () {
    function SystemInvariantValidator() {
    }
    SystemInvariantValidator.validate = function () {
        var state = ControlStateFactory_1.ControlStateFactory.create();
        var statePaths = extractPaths(state);
        var registryPaths = Object.keys(ControlRegistry_1.ControlRegistry.controls);
        var missing = registryPaths.filter(function (p) { return !statePaths.includes(p); });
        var extra = statePaths.filter(function (p) { return !registryPaths.includes(p); });
        if (missing.length || extra.length) {
            throw new Error([
                "SYSTEM INVARIANT VIOLATION",
                missing.length ? "Missing:\n".concat(missing.join("\n")) : "",
                extra.length ? "Extra:\n".concat(extra.join("\n")) : ""
            ].filter(Boolean).join("\n\n"));
        }
    };
    return SystemInvariantValidator;
}());
exports.SystemInvariantValidator = SystemInvariantValidator;
