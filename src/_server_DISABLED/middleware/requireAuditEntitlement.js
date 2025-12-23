"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuditEntitlement = requireAuditEntitlement;
var entitlementStore_1 = require("../services/entitlementStore");
function requireAuditEntitlement(req, res, next) {
    var _a;
    var email = (_a = req.body) === null || _a === void 0 ? void 0 : _a.email;
    if (!email) {
        return res.status(400).json({
            error: "Email required for entitlement check",
        });
    }
    var entitlement = entitlementStore_1.entitlementStore.get(email);
    if (!entitlement || entitlement.remainingRuns <= 0) {
        return res.status(402).json({
            error: "Payment required",
        });
    }
    entitlement.remainingRuns -= 1;
    entitlementStore_1.entitlementStore.set(email, entitlement);
    next();
}
