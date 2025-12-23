"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var express_1 = require("express");
var cors_1 = require("cors");
var auditSprint_1 = require("./routes/auditSprint");
var auditSprintResult_1 = require("./routes/auditSprintResult");
var app = (0, express_1.default)();
var PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// IMPORTANT: Mount result router FIRST so it can’t be shadowed by any generic audit-sprint middleware.
app.use("/api/audit-sprint/result", auditSprintResult_1.default);
// Keep audit-sprint router strictly scoped (POST /intake only).
app.use("/api/audit-sprint", auditSprint_1.default);
app.get("/health", function (_req, res) { return res.json({ ok: true }); });
app.listen(PORT, function () {
    console.log("\uD83D\uDE80 SecureLogic Engine listening on port ".concat(PORT));
});
