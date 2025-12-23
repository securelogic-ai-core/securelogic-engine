"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractControlPaths = extractControlPaths;
// src/engine/utils/extractControlPaths.ts
function extractControlPaths(obj, prefix) {
    if (prefix === void 0) { prefix = ""; }
    var paths = [];
    for (var _i = 0, _a = Object.keys(obj); _i < _a.length; _i++) {
        var key = _a[_i];
        var value = obj[key];
        var path = prefix ? "".concat(prefix, ".").concat(key) : key;
        if (typeof value === "boolean") {
            paths.push(path);
        }
        else if (typeof value === "object" && value !== null) {
            paths.push.apply(paths, extractControlPaths(value, path));
        }
    }
    return paths;
}
