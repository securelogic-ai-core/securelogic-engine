"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiRateLimiter = void 0;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const usage_1 = require("../telemetry/usage");
const API_KEY_TIERS = {
    test123: 5,
    pro123: 60,
    ent123: 1000
};
exports.apiRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: (req) => {
        const key = req.apiKey ?? "anonymous";
        return API_KEY_TIERS[key] ?? 5;
    },
    keyGenerator: (req) => {
        return req.apiKey ?? "anonymous";
    },
    handler: (req, res) => {
        const key = req.apiKey ?? "anonymous";
        (0, usage_1.recordBlocked)(key);
        res.status(429).send("Too many requests, please try again later.");
    },
    standardHeaders: true,
    legacyHeaders: false
});
