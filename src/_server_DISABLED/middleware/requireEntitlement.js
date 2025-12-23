"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireEntitlement = requireEntitlement;
var store_1 = require("../entitlements/store");
function requireEntitlement(product) {
    return function (req, res, next) {
        var _a;
        var email = (_a = req.body) === null || _a === void 0 ? void 0 : _a.email;
        if (!email) {
            return res.status(400).json({ error: "EMAIL_REQUIRED" });
        }
        var entitled = product === "AUDIT_SPRINT" && (0, store_1.hasAuditSprint)(email);
        if (!entitled) {
            return res.status(403).json({
                error: "ENTITLEMENT_REQUIRED",
                message: "Audit Sprint not purchased"
            });
        }
        next();
    };
}
