"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.licenseRateLimiter = void 0;
var express_rate_limit_1 = require("express-rate-limit");
var resolveLicense_1 = require("../auth/resolveLicense");
exports.licenseRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000, // 1 minute
    standardHeaders: true,
    legacyHeaders: false,
    max: function (req) {
        var license = (0, resolveLicense_1.resolveLicense)(req);
        switch (license) {
            case "ENTERPRISE":
                return 300;
            case "PRO":
                return 60;
            case "FREE":
            default:
                return 10;
        }
    },
});
