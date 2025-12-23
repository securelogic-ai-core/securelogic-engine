"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ControlStateFactory = void 0;
var ControlRegistry_1 = require("../registry/ControlRegistry");
function setPath(obj, path, value) {
    var _a;
    var _b;
    var parts = path.split(".");
    var current = obj;
    for (var i = 0; i < parts.length - 1; i++) {
        (_a = current[_b = parts[i]]) !== null && _a !== void 0 ? _a : (current[_b] = {});
        current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
}
var ControlStateFactory = /** @class */ (function () {
    function ControlStateFactory() {
    }
    ControlStateFactory.create = function (overrides) {
        if (overrides === void 0) { overrides = {}; }
        var base = {};
        for (var _i = 0, _a = Object.keys(ControlRegistry_1.ControlRegistry.controls); _i < _a.length; _i++) {
            var path = _a[_i];
            setPath(base, path, false);
        }
        return deepMerge(base, overrides);
    };
    return ControlStateFactory;
}());
exports.ControlStateFactory = ControlStateFactory;
function deepMerge(target, source) {
    var _a;
    for (var key in source) {
        var value = source[key];
        if (value && typeof value === "object") {
            target[key] = deepMerge((_a = target[key]) !== null && _a !== void 0 ? _a : {}, value);
        }
        else if (value !== undefined) {
            target[key] = value;
        }
    }
    return target;
}
