"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.grantAuditSprint = grantAuditSprint;
exports.hasAuditSprint = hasAuditSprint;
exports.consumeAuditSprint = consumeAuditSprint;
console.log("🧠 ENTITLEMENT STORE LOADED");
var entitlements = new Map();
function grantAuditSprint(email, source, sourceRef) {
    entitlements.set(email, {
        email: email,
        product: "AUDIT_SPRINT",
        remaining: 1,
        source: source,
        sourceRef: sourceRef,
        issuedAt: new Date().toISOString()
    });
}
function hasAuditSprint(email) {
    var ent = entitlements.get(email);
    return !!ent && ent.remaining > 0;
}
function consumeAuditSprint(email) {
    var ent = entitlements.get(email);
    if (!ent || ent.remaining <= 0) {
        throw new Error("ENTITLEMENT_EXHAUSTED");
    }
    ent.remaining -= 1;
}
