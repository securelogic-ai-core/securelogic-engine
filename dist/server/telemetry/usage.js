"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordUsage = recordUsage;
exports.recordBlocked = recordBlocked;
exports.getUsage = getUsage;
const usage = {};
function recordUsage(apiKey, endpoint) {
    if (!usage[apiKey]) {
        usage[apiKey] = { total: 0, blocked: 0, endpoints: {} };
    }
    usage[apiKey].total += 1;
    usage[apiKey].endpoints[endpoint] =
        (usage[apiKey].endpoints[endpoint] ?? 0) + 1;
}
function recordBlocked(apiKey) {
    if (!usage[apiKey]) {
        usage[apiKey] = { total: 0, blocked: 0, endpoints: {} };
    }
    usage[apiKey].blocked += 1;
}
function getUsage() {
    return usage;
}
