"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateAuditSprintInput = validateAuditSprintInput;
function validateAuditSprintInput(body) {
    var _a;
    console.log("VALIDATOR HIT — BODY KEYS:", Object.keys(body || {}));
    if (!body || typeof body !== "object") {
        return "Request body is required";
    }
    var payload = (_a = body.data) !== null && _a !== void 0 ? _a : body;
    var keys = Object.keys(payload).filter(function (k) { return k !== "license"; });
    if (keys.length === 0) {
        return "At least one control response is required";
    }
    return null;
}
