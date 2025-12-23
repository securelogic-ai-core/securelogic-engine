"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.freeTierAuditLimit = freeTierAuditLimit;
exports.resetFreeTier = resetFreeTier;
var FREE_TIER_LIMIT = 1;
/**
 * In-memory counter keyed by email
 * (dev-safe, resets on server restart)
 */
var freeTierUsage = new Map();
function freeTierAuditLimit(req, res, next) {
    var _a, _b;
    var email = (_a = req.body) === null || _a === void 0 ? void 0 : _a.email;
    if (!email) {
        return res.status(400).json({ error: "EMAIL_REQUIRED" });
    }
    var used = (_b = freeTierUsage.get(email)) !== null && _b !== void 0 ? _b : 0;
    if (used >= FREE_TIER_LIMIT) {
        return res.status(403).json({
            error: "FreeTierLimitReached",
            message: "Free tier is limited to 1 AI Audit Sprint"
        });
    }
    freeTierUsage.set(email, used + 1);
    next();
}
/**
 * DEV ONLY — resets all free-tier usage
 */
function resetFreeTier() {
    freeTierUsage.clear();
}
