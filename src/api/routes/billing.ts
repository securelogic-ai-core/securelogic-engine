import { Router } from "express";
import { logger } from "../infra/logger.js";
import { getStripe } from "../infra/stripeClient.js";
import { requireApiKey } from "../middleware/requireApiKey.js";

const router = Router();

/* =========================================================
   CREATE CHECKOUT SESSION
   POST /api/billing/checkout

   Creates a Stripe subscription checkout session for the
   calling API key. The key is embedded in session + subscription
   metadata so the stripe webhook can identify who paid.
   ========================================================= */

router.post("/billing/checkout", requireApiKey, async (req, res) => {
  try {
    const priceId = process.env.STRIPE_PRICE_ID?.trim();
    const successUrl = process.env.STRIPE_SUCCESS_URL?.trim();
    const cancelUrl = process.env.STRIPE_CANCEL_URL?.trim();

    if (!priceId || !successUrl || !cancelUrl) {
      logger.error(
        { event: "billing_checkout_misconfigured" },
        "POST /api/billing/checkout: Stripe env vars not fully configured"
      );
      res.status(503).json({ error: "billing_not_configured" });
      return;
    }

    const apiKey = (req as any).apiKey as Record<string, unknown>;
    const apiKeyId =
      typeof apiKey.id === "string" ? apiKey.id : null;

    if (!apiKeyId) {
      res.status(400).json({ error: "api_key_identity_missing" });
      return;
    }

    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      // api_key_id flows into checkout.session.completed
      metadata: { api_key_id: apiKeyId },
      // api_key_id also flows into all subscription lifecycle events
      subscription_data: { metadata: { api_key_id: apiKeyId } },
      success_url: successUrl,
      cancel_url: cancelUrl
    });

    if (!session.url) {
      logger.error(
        { event: "billing_checkout_no_url" },
        "POST /api/billing/checkout: Stripe returned no checkout URL"
      );
      res.status(500).json({ error: "checkout_url_missing" });
      return;
    }

    logger.info(
      {
        event: "billing_checkout_created",
        apiKeyId,
        sessionId: session.id
      },
      "Stripe checkout session created"
    );

    res.status(200).json({ checkoutUrl: session.url });
  } catch (err) {
    logger.error(
      { event: "billing_checkout_failed", err },
      "POST /api/billing/checkout failed"
    );
    res.status(500).json({ error: "billing_checkout_failed" });
  }
});

export default router;
