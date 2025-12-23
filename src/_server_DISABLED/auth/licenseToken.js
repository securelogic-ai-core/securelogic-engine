"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.issueLicenseToken = issueLicenseToken;
exports.verifyLicenseToken = verifyLicenseToken;
var jsonwebtoken_1 = require("jsonwebtoken");
var LICENSE_SECRET = process.env.LICENSE_SECRET || "dev-secret-change-me";
function issueLicenseToken(tier, expiresIn) {
    if (expiresIn === void 0) { expiresIn = "30d"; }
    return jsonwebtoken_1.default.sign({ tier: tier }, LICENSE_SECRET, { expiresIn: expiresIn });
}
function verifyLicenseToken(token) {
    return jsonwebtoken_1.default.verify(token, LICENSE_SECRET);
}
