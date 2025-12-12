"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordUsage = recordUsage;
exports.recordBlocked = recordBlocked;
exports.getUsage = getUsage;
const usage = [];
function recordUsage(key, route) {
    usage.push({ key, route, timestamp: Date.now() });
}
function recordBlocked(_key) {
    // no-op
}
function getUsage() {
    return usage;
}
