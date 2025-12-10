"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireApiKey = requireApiKey;
function requireApiKey(req, res, next) {
    const apiKey = req.header("x-api-key");
    if (!apiKey || apiKey !== process.env.ENGINE_API_KEY) {
        return res.status(401).json({
            ok: false,
            error: "Unauthorized: invalid or missing API key"
        });
    }
    next();
}
