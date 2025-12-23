"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveAuditResult = saveAuditResult;
exports.getAuditResult = getAuditResult;
var store = new Map();
function saveAuditResult(auditId, email, result) {
    store.set(auditId, { email: email, result: result });
}
function getAuditResult(auditId, email) {
    var record = store.get(auditId);
    if (!record)
        return null;
    if (record.email !== email)
        return null;
    return record.result;
}
