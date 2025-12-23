"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveLicense = resolveLicense;
var licenseToken_1 = require("./licenseToken");
/**
 * Resolves the caller's license tier from Authorization header.
 * Defaults to FREE if missing or invalid.
 */
function resolveLicense(req) {
    var auth = req.header("authorization");
    if (!auth || !auth.startsWith("Bearer ")) {
        return "FREE";
    }
    var token = auth.slice(7);
    try {
        var claims = (0, licenseToken_1.verifyLicenseToken)(token);
        return claims.tier;
    }
    catch (_a) {
        return "FREE";
    }
}
