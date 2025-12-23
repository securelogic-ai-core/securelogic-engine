import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { stripe } from "../../lib/stripe";
import { grantAuditSprint } from "../../entitlements/store";

const router = Router();

/**
 * Stripe Webhook Handler
 * NOTE: RAW body is required (configured in index.ts)
 */
router.post("/webhook", (req: Request, res: Response) => {
  const signature = req.headers["stripe-signature"];

  if (!signature) {
    return res.status(400).send("Missing Stripe signature");
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error("❌ Stripe webhook verification failed:", err);
    return res.status(400).send("Webhook verification failed");
  }

  /**
   * Payment completed successfully
   */
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    const email = session.customer_details?.email;

    if (!email) {
      console.error("❌ No customer email on checkout session");
      return res.status(400).send("Missing customer email");
    }

    console.log("✅ Payment confirmed for:", email);

    // 🔑 Grant exactly ONE Audit Sprint
    grantAuditSprint(email, "STRIPE", session.id);
  }

  // Stripe requires a 200 response
  res.json({ received: true });
});

export default router;