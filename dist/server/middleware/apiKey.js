"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireApiKey = requireApiKey;
const apiKeys_1 = require("../config/apiKeys");
function requireApiKey(req, res, next) {
    const apiKey = req.header("x-api-key");
    if (!apiKey || !apiKeys_1.API_KEYS[apiKey]) {
        return res.status(401).json({
            ok: false,
            error: "Unauthorized: invalid or missing API key"
        });
    }
    req.apiKey = apiKey;
    req.apiTier = apiKeys_1.API_KEYS[apiKey].tier;
    next();
}
