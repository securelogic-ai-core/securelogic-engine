"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiRateLimiter = void 0;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const tiers_1 = require("../config/tiers");
exports.apiRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: (req) => {
        const tier = req.apiTier ?? "free";
        return tiers_1.TIER_LIMITS[tier];
    },
    keyGenerator: (req) => {
        return req.apiKey ?? req.ip ?? "anonymous";
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
        res.status(429).json({
            ok: false,
            code: "RATE_LIMITED",
            message: "Tier rate limit exceeded"
        });
    }
});
