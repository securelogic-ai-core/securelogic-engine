"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var express_1 = require("express");
var auditSprint_1 = require("./routes/auditSprint");
var auditSprintPdf_1 = require("./routes/auditSprintPdf");
var licenseRateLimit_1 = require("./middleware/licenseRateLimit");
var app = (0, express_1.default)();
// --------------------
// Core middleware
// --------------------
app.use(express_1.default.json());
// --------------------
// Health check
// --------------------
app.get("/health", function (_req, res) {
    res.status(200).json({ status: "ok" });
});
// --------------------
// Rate-limited API routes
// --------------------
app.use("/api", licenseRateLimit_1.licenseRateLimiter);
app.use("/api/audit-sprint", auditSprint_1.default);
app.use("/api/audit-sprint/pdf", auditSprintPdf_1.default);
// --------------------
// Server startup
// --------------------
var PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, function () {
    console.log("SecureLogic Engine listening on port ".concat(PORT));
});
exports.default = app;
