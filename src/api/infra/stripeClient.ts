import Stripe from "stripe";

let _stripe: Stripe | null = null;

/**
 * Returns the Stripe SDK instance.
 * Fails at call time if STRIPE_SECRET_KEY is not set — never crashes on boot.
 */
export function getStripe(): Stripe {
  if (_stripe) return _stripe;

  const key = process.env.STRIPE_SECRET_KEY?.trim();

  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }

  _stripe = new Stripe(key, {
    apiVersion: "2025-03-31.basil"
  });

  return _stripe;
}
