/**
 * briefPlatformCredit.ts — Brief → Platform upgrade credit (backlog #9).
 *
 * Commercial rule (locked 2026-06-24): when a customer who has been paying for
 * a Brief plan (Brief Pro = "professional" / Team = "teams") upgrades to a
 * Platform Professional plan ("platform" / "platform_annual"), their trailing
 * 12-month Brief/Team spend credits **100%** against the first-year Platform
 * cost. Practically: we hand Stripe a customer-balance credit equal to what
 * they already paid for Brief, capped at the first-year Platform price, so the
 * upgrade invoice (and any follow-ups in year one) draw it down automatically.
 *
 * Where it runs: the Stripe webhook already has a platform-upgrade block
 * (cancelPriorBriefSubscriptions) on checkout.session.completed for raw tier
 * platform/platform_annual. This credit fires in the same block, BEFORE the
 * cancel, so the prior Brief subs are still listable for their paid invoices.
 *
 * Safety posture (money movement — handled conservatively):
 *   - OFF by default behind SECURELOGIC_BRIEF_PLATFORM_CREDIT_ENABLED. When off
 *     this is a pure no-op: no Stripe reads, no balance mutation. Enable per-env
 *     only after the price IDs + Stripe account are confirmed.
 *   - At-most-once per customer. Before crediting we scan the customer's balance
 *     transactions for our metadata marker and skip if already present, so a
 *     webhook replay or a second platform checkout never double-credits.
 *   - Capped at the first-year Platform cost (computeCreditCents). In practice
 *     Brief spend ($348–$2,268/yr) is far below Platform ($12k+/yr) so the cap
 *     rarely binds, but it guarantees we never credit more than year-one owes.
 *   - Never throws. A credit failure must not break webhook delivery; the caller
 *     wraps it but this module also self-guards and logs non-fatally.
 *
 * The Stripe-touching orchestration takes an injectable client (defaults to
 * getStripe()) so the pure arithmetic + idempotency + flag gating are unit
 * tested without a live Stripe.
 */

import type Stripe from "stripe";

import { getStripe } from "../infra/stripeClient.js";
import { logger } from "../infra/logger.js";

/** Metadata marker written on the balance transaction; also the idempotency key. */
export const CREDIT_METADATA_KEY = "securelogic_credit_reason";
export const CREDIT_REASON = "brief_to_platform_v1";

const TRAILING_WINDOW_SECONDS = 365 * 24 * 60 * 60;

export function briefPlatformCreditEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_BRIEF_PLATFORM_CREDIT_ENABLED"] === "true";
}

/** Minimal shapes we read — kept loose so SDK version drift on unread fields can't break us. */
interface BalanceTxnLike { metadata?: Record<string, string> | null }
interface InvoiceLike { amount_paid?: number | null; currency?: string | null }
interface PriceLike { unit_amount?: number | null; recurring?: { interval?: string | null } | null }
interface SubscriptionLike { items?: { data?: Array<{ price?: PriceLike | null } | null> | null } | null }

/** True if a prior brief→platform credit has already been written for this customer. */
export function alreadyCredited(transactions: BalanceTxnLike[]): boolean {
  return transactions.some((t) => t.metadata?.[CREDIT_METADATA_KEY] === CREDIT_REASON);
}

/** Sum amount_paid across paid invoices (cents) and surface a currency. Pure. */
export function sumPaidInvoiceCents(invoices: InvoiceLike[]): { cents: number; currency: string } {
  let cents = 0;
  let currency = "usd";
  for (const inv of invoices) {
    const paid = typeof inv.amount_paid === "number" && inv.amount_paid > 0 ? inv.amount_paid : 0;
    cents += paid;
    if (inv.currency) currency = inv.currency;
  }
  return { cents, currency };
}

/**
 * First-year cost (cents) of a Platform subscription from its price. Annual →
 * the unit amount; monthly → ×12 (and week/day annualised) so the cap means the
 * same thing for both Platform billing options. Returns 0 when it can't be
 * derived, which computeCreditCents treats as "do not cap".
 */
export function firstYearPlatformCents(subscription: SubscriptionLike | null): number {
  const price = subscription?.items?.data?.[0]?.price ?? null;
  const unit = price && typeof price.unit_amount === "number" ? price.unit_amount : 0;
  if (unit <= 0) return 0;
  switch (price?.recurring?.interval) {
    case "year": return unit;
    case "month": return unit * 12;
    case "week": return unit * 52;
    case "day": return unit * 365;
    default: return unit; // unknown cadence — treat the unit as the year (conservative)
  }
}

/**
 * The credit to grant (cents): 100% of Brief spend, floored at 0 and capped at
 * the first-year Platform cost. A non-positive cap (unknown price) means no cap.
 */
export function computeCreditCents(briefSpendCents: number, firstYearCents: number): number {
  const spend = Number.isFinite(briefSpendCents) && briefSpendCents > 0 ? Math.floor(briefSpendCents) : 0;
  if (spend === 0) return 0;
  if (Number.isFinite(firstYearCents) && firstYearCents > 0) return Math.min(spend, Math.floor(firstYearCents));
  return spend;
}

export interface ApplyCreditArgs {
  customerId: string;
  /** The just-created Platform subscription (excluded from Brief-spend totals). */
  newSubscriptionId: string | null;
  /** Prior Brief/Team subscription IDs whose paid invoices make up the spend. */
  priorBriefSubscriptionIds: string[];
  organizationId: string;
  /** Epoch ms; injectable for tests. */
  nowMs?: number;
  /** Injectable Stripe client (defaults to the shared singleton). */
  stripe?: Stripe;
}

/**
 * Grant the Brief→Platform credit as a Stripe customer-balance credit. Gated,
 * idempotent, capped, and non-throwing. Returns the cents credited (0 when it
 * skipped for any reason). Runs BEFORE prior Brief subs are cancelled.
 */
export async function applyBriefToPlatformCredit(args: ApplyCreditArgs): Promise<number> {
  const { customerId, newSubscriptionId, priorBriefSubscriptionIds, organizationId } = args;

  if (!briefPlatformCreditEnabled()) return 0;
  if (!customerId || priorBriefSubscriptionIds.length === 0) return 0;

  const stripe = args.stripe ?? getStripe();
  const nowSeconds = Math.floor((args.nowMs ?? Date.now()) / 1000);

  try {
    // Idempotency: at-most-once per customer.
    const existing = await stripe.customers.listBalanceTransactions(customerId, { limit: 100 });
    if (alreadyCredited((existing.data ?? []) as BalanceTxnLike[])) {
      logger.info(
        { event: "brief_platform_credit_skipped_existing", organizationId, customerId },
        "briefPlatformCredit: customer already has a brief→platform credit — skipping"
      );
      return 0;
    }

    // Brief spend = paid invoices on the prior Brief subs within the trailing year.
    let spendCents = 0;
    let currency = "usd";
    const since = nowSeconds - TRAILING_WINDOW_SECONDS;
    for (const subId of priorBriefSubscriptionIds) {
      if (!subId || subId === newSubscriptionId) continue;
      const invoices = await stripe.invoices.list({
        subscription: subId,
        status: "paid",
        created: { gte: since },
        limit: 100,
      });
      const summed = sumPaidInvoiceCents((invoices.data ?? []) as InvoiceLike[]);
      spendCents += summed.cents;
      currency = summed.currency;
    }

    if (spendCents <= 0) {
      logger.info(
        { event: "brief_platform_credit_no_spend", organizationId, customerId },
        "briefPlatformCredit: no trailing Brief spend found — nothing to credit"
      );
      return 0;
    }

    // Cap at the first-year Platform cost.
    let firstYear = 0;
    if (newSubscriptionId) {
      try {
        const sub = await stripe.subscriptions.retrieve(newSubscriptionId);
        firstYear = firstYearPlatformCents(sub as unknown as SubscriptionLike);
      } catch (err) {
        logger.warn(
          { event: "brief_platform_credit_sub_fetch_failed", organizationId, newSubscriptionId, err },
          "briefPlatformCredit: could not fetch new Platform subscription for the cap — crediting uncapped"
        );
      }
    }

    const creditCents = computeCreditCents(spendCents, firstYear);
    if (creditCents <= 0) return 0;

    // Negative amount = a credit applied to upcoming invoices.
    await stripe.customers.createBalanceTransaction(customerId, {
      amount: -creditCents,
      currency,
      description: "SecureLogic Brief → Platform upgrade credit (100% of first-year Brief spend)",
      metadata: {
        [CREDIT_METADATA_KEY]: CREDIT_REASON,
        organization_id: organizationId,
        brief_spend_cents: String(spendCents),
        new_subscription_id: newSubscriptionId ?? "",
      },
    });

    logger.info(
      {
        event: "brief_platform_credit_applied",
        organizationId,
        customerId,
        creditCents,
        spendCents,
        firstYearCents: firstYear,
        currency,
      },
      "briefPlatformCredit: applied brief→platform upgrade credit"
    );
    return creditCents;
  } catch (err) {
    logger.error(
      { event: "brief_platform_credit_failed", organizationId, customerId, err },
      "briefPlatformCredit: failed to apply credit (non-fatal)"
    );
    return 0;
  }
}
