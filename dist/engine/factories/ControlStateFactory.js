"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ControlStateFactory = void 0;
const ControlRegistry_1 = require("../registry/ControlRegistry");
function setPath(obj, path, value) {
    var _a;
    const parts = path.split(".");
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        current[_a = parts[i]] ?? (current[_a] = {});
        current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
}
class ControlStateFactory {
    static create(overrides = {}) {
        const base = {};
        for (const path of Object.keys(ControlRegistry_1.ControlRegistry.controls)) {
            setPath(base, path, false);
        }
        return deepMerge(base, overrides);
    }
}
exports.ControlStateFactory = ControlStateFactory;
function deepMerge(target, source) {
    for (const key in source) {
        const value = source[key];
        if (value && typeof value === "object") {
            target[key] = deepMerge(target[key] ?? {}, value);
        }
        else if (value !== undefined) {
            target[key] = value;
        }
    }
    return target;
}
