"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordUsage = recordUsage;
exports.getUsage = getUsage;
const MAX_RECORDS = 1000;
const usageLog = [];
function recordUsage(entry) {
    usageLog.push(entry);
    if (usageLog.length > MAX_RECORDS) {
        usageLog.shift();
    }
}
function getUsage() {
    return usageLog;
}
