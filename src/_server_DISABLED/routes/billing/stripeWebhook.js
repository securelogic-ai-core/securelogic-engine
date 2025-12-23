"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var express_1 = require("express");
var stripe_1 = require("../../lib/stripe");
var store_1 = require("../../entitlements/store");
var router = (0, express_1.Router)();
/**
 * Stripe Webhook Handler
 * NOTE: RAW body is required (configured in index.ts)
 */
router.post("/webhook", function (req, res) {
    var _a;
    var signature = req.headers["stripe-signature"];
    if (!signature) {
        return res.status(400).send("Missing Stripe signature");
    }
    var event;
    try {
        event = stripe_1.stripe.webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
    }
    catch (err) {
        console.error("❌ Stripe webhook verification failed:", err);
        return res.status(400).send("Webhook verification failed");
    }
    /**
     * Payment completed successfully
     */
    if (event.type === "checkout.session.completed") {
        var session = event.data.object;
        var email = (_a = session.customer_details) === null || _a === void 0 ? void 0 : _a.email;
        if (!email) {
            console.error("❌ No customer email on checkout session");
            return res.status(400).send("Missing customer email");
        }
        console.log("✅ Payment confirmed for:", email);
        // 🔑 Grant exactly ONE Audit Sprint
        (0, store_1.grantAuditSprint)(email, "STRIPE", session.id);
    }
    // Stripe requires a 200 response
    res.json({ received: true });
});
exports.default = router;
