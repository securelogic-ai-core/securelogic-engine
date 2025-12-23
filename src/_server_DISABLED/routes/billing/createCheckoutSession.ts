import { Router, Request, Response } from "express";
import { stripe } from "../../lib/stripe";

const router = Router();

router.post("/checkout", async (_req: Request, res: Response) => {
  try {
    console.log("➡️ /checkout hit");

    if (!process.env.STRIPE_PRICE_ID) {
      throw new Error("STRIPE_PRICE_ID missing");
    }

    if (!process.env.FRONTEND_SUCCESS_URL || !process.env.FRONTEND_CANCEL_URL) {
      throw new Error("Frontend URLs missing");
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",

      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],

      success_url: process.env.FRONTEND_SUCCESS_URL,
      cancel_url: process.env.FRONTEND_CANCEL_URL,
    });

    console.log("✅ Stripe session created:", session.id);
    console.log("🌐 Checkout URL:", session.url);

    if (!session.url) {
      throw new Error("Stripe did not return a checkout URL");
    }

    return res.status(200).json({
      checkoutUrl: session.url,
    });
  } catch (err: any) {
    console.error("❌ STRIPE CHECKOUT ERROR");
    console.error(err);
    console.error("❌ END STRIPE ERROR");

    return res.status(500).json({
      error: "StripeCheckoutFailed",
      message: err?.message,
      type: err?.type,
      code: err?.code,
    });
  }
});

export default router;