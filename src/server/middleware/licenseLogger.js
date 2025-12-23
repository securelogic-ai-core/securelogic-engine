"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.licenseLogger = licenseLogger;
var resolveLicense_1 = require("../auth/resolveLicense");
function licenseLogger(req, _res, next) {
    var license = (0, resolveLicense_1.resolveLicense)(req);
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        path: req.path,
        method: req.method,
        license: license,
    }));
    next();
}
