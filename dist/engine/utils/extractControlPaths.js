"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractControlPaths = extractControlPaths;
// src/engine/utils/extractControlPaths.ts
function extractControlPaths(obj, prefix = "") {
    const paths = [];
    for (const key of Object.keys(obj)) {
        const value = obj[key];
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof value === "boolean") {
            paths.push(path);
        }
        else if (typeof value === "object" && value !== null) {
            paths.push(...extractControlPaths(value, path));
        }
    }
    return paths;
}
