"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateJsonObject = validateJsonObject;
function validateJsonObject(obj, file) {
    if (!obj || typeof obj !== "object") {
        throw new Error("Invalid JSON structure in " + file);
    }
    if (!Array.isArray(obj.controls)) {
        throw new Error("Catalog missing required 'controls' array in " + file);
    }
}
