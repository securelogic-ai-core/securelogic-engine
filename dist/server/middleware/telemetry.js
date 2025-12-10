"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.telemetry = telemetry;
const usage_1 = require("../telemetry/usage");
function telemetry(req, res, next) {
    const start = Date.now();
    const apiKey = req.header("x-api-key") || "anonymous";
    res.on("finish", () => {
        (0, usage_1.recordUsage)({
            apiKey,
            path: req.path,
            status: res.statusCode,
            durationMs: Date.now() - start,
            timestamp: new Date().toISOString()
        });
    });
    next();
}
