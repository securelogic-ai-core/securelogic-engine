"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireApiKey = requireApiKey;
function requireApiKey(req, res, next) {
    const key = req.headers["x-api-key"];
    if (!key || key !== "test123") {
        return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    next();
}
