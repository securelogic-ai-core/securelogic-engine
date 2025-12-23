"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.grantDevAuditSprint = grantDevAuditSprint;
var store_1 = require("./store");
function grantDevAuditSprint(email) {
    console.log("🧪 DEV GRANT issued for:", email);
    (0, store_1.grantAuditSprint)(email, "DEV", "manual-dev-grant");
}
