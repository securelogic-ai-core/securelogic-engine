import type { Request, Response } from "express";
import type Stripe from "stripe";

import { getStripe } from "../infra/stripeClient.js";
import { logger } from "../infra/logger.js";
import { pg } from "../infra/postgres.js";
import {
  setEntitlementInRedis,
  type EntitlementRecord
} from "../infra/entitlementStore.js";
import { claimWebhookEvent } from "./webhookIdempotency.js";
import { applyBriefToPlatformCredit } from "../lib/briefPlatformCredit.js";
import { sendEmail } from "../infra/email.js";
import { graceState, graceEndsAt } from "../lib/graceWindow.js";
import {
  openDunningCycle,
  claimDunningStage,
  markCyclesRecovered,
} from "../lib/billingDunningCycle.js";

/* =========================================================
   CONSTANTS
   ========================================================= */

const MAX_SIG_LENGTH = 512;

/**
 * Events that grant premium access.
 */
const GRANT_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated"
]);

/**
 * Events that revoke access.
 */
const REVOKE_EVENTS = new Set([
  "customer.subscription.deleted"
]);

/**
 * Events that flag a payment failure.
 * Access is NOT revoked — payment_failed_at is stamped on the api_key row
 * for observability and dunning UX. Stripe will handle eventual cancellation
 * via customer.subscription.updated (past_due → canceled) after its retry cycle.
 *
 * Register in Stripe Dashboard: invoice.payment_failed
 */
const PAYMENT_FAILED_EVENTS = new Set([
  "invoice.payment_failed"
]);

/**
 * Events that signal a payment SUCCEEDED on a subscription invoice — the
 * recovery half of the dunning lifecycle.
 *
 * Before these were handled, entitlement was restored only by a
 * customer.subscription.updated(active) whose tier resolveTier could resolve.
 * When it could not, classifySubscriptionEvent returned null, the handler
 * responded {ignored: true}, and NO write happened anywhere — leaving an org
 * at 'starter' with payment_failed_at set while holding a live, fully paid
 * Stripe subscription, with no second chance and no self-service recovery.
 *
 * Both events are registered because they are not the same event: Stripe
 * sends invoice.payment_succeeded when a charge succeeds and invoice.paid
 * when the invoice reaches the paid state (including out-of-band payment).
 * Handling both is deliberate and safe — the restore is a converging write,
 * and the second event simply observes the state the first one reached.
 *
 * Register in Stripe Dashboard: invoice.paid, invoice.payment_succeeded
 */
const RECOVERY_EVENTS = new Set([
  "invoice.paid",
  "invoice.payment_succeeded"
]);

/* =========================================================
   HELPERS
   ========================================================= */

/* ---------------------------------------------------------
   BILLING-EVENT ORDERING (SL-BILL-1 PR-D, defect D5)
   --------------------------------------------------------- */

/**
 * The identity of the Stripe event authorising a billing-state write.
 *
 * `createdAt` is event.created — STRIPE's clock in whole seconds, never ours.
 * Our receipt time is exactly what must not decide ordering: receipt order IS
 * the thing that goes wrong.
 */
type EventOrdering = {
  createdAt: number;
  eventId: string;
};

/** What a guarded billing-state write actually did. */
type SyncOutcome = "applied" | "stale" | "duplicate" | "not_found" | "error";

function orderingOf(event: Stripe.Event): EventOrdering {
  return { createdAt: event.created, eventId: event.id };
}

/**
 * THE ORDERING RULE, as a SQL predicate.
 *
 * Every billing-state UPDATE carries `AND ${ORDERING_PREDICATE}` and advances
 * the watermark in the same statement, so the compare and the write are one
 * atomic operation. There is no read-then-write window for two concurrent
 * deliveries to race through, and no lock is required.
 *
 * Given the incoming event.created ($created) and event.id ($eventId):
 *
 *   watermark IS NULL          → APPLY. No billing event has ever been applied
 *                                to this org; the first one wins by definition.
 *                                Every pre-existing row starts here.
 *   created > watermark        → APPLY. Strictly newer.
 *   created = watermark, and
 *     id = stored id           → SUPPRESS as a duplicate. Belt to
 *                                claimWebhookEvent's braces: that gate already
 *                                stops a re-delivery, but this makes the write
 *                                itself idempotent even if the gate is ever
 *                                bypassed, reordered or removed.
 *     id ≠ stored id           → APPLY. Two DIFFERENT events sharing one
 *                                second are genuinely concurrent as far as
 *                                event.created can tell, and Stripe exposes no
 *                                finer ordering signal. Suppressing here would
 *                                risk dropping a legitimate recovery — the
 *                                exact failure this package exists to prevent —
 *                                so the tie applies and the later writer wins.
 *                                See the same-second caveat in the PR.
 *   created < watermark        → SUPPRESS as stale. THIS IS D5: a delayed
 *                                past_due landing after the recovery active
 *                                must not downgrade a customer who has paid.
 *
 * The rule is deliberately symmetric — it guards revocations exactly as it
 * guards grants. Exempting revocations would preserve the "access can always be
 * withdrawn" instinct but would re-open D5 outright, because D5 IS a stale
 * revocation. A genuinely-older revocation that arrives late is therefore
 * suppressed too; it is logged at warn level so it is visible rather than
 * silent, and the terminal Stripe events that matter (subscription.deleted) are
 * both rare and followed by further events.
 */
function orderingPredicate(createdParam: number, idParam: number): string {
  return `(
           stripe_billing_event_at IS NULL
        OR stripe_billing_event_at < to_timestamp($${createdParam})
        OR (
             stripe_billing_event_at = to_timestamp($${createdParam})
             AND stripe_billing_event_id IS DISTINCT FROM $${idParam}
           )
      )`;
}

/**
 * Why a guarded UPDATE matched no row: the org does not exist, or the ordering
 * predicate rejected the event. Only called on rowCount 0, so it costs nothing
 * on the normal path.
 */
async function classifySuppression(
  orgId: string,
  ordering: EventOrdering
): Promise<"stale" | "duplicate" | "not_found"> {
  try {
    const { rows } = await pg.query<{
      stripe_billing_event_at: Date | null;
      stripe_billing_event_id: string | null;
    }>(
      `SELECT stripe_billing_event_at, stripe_billing_event_id
         FROM organizations WHERE id = $1 LIMIT 1`,
      [orgId]
    );
    const row = rows[0];
    if (!row) return "not_found";
    if (row.stripe_billing_event_id === ordering.eventId) return "duplicate";
    return "stale";
  } catch {
    // Classification is for the log line only. It must never change the
    // outcome of the event, so an error here degrades to the general case.
    return "stale";
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidApiKeyId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return UUID_RE.test(value.trim());
}

/**
 * Raw tier strings that are known to the billing system. Values fall into
 * three buckets:
 *   - Current checkout tiers:  professional, teams, platform, platform_annual
 *   - Legacy (pre-overhaul):   team, paid, admin
 *
 * Anything outside this set is logged as stripe_unresolved_tier and resolves
 * to null — NO entitlement is granted. It used to default to "paid" (full
 * platform) so that webhook delivery was never blocked by a bad metadata
 * value; that traded a delivery concern for an over-entitlement, since the
 * least trustworthy input produced the most privileged output. Delivery is
 * still never blocked — the event is acknowledged and ignored — but access is
 * no longer invented. Drift between the product catalog and this whitelist is
 * now an error-level log, not a warning.
 */
const KNOWN_TIERS = new Set([
  "professional", "teams", "platform", "platform_annual",
  "team", "paid", "admin"
]);

/**
 * Map of Stripe price IDs → raw tier labels, built at module load from
 * STRIPE_PRICE_ID_PROFESSIONAL / _TEAMS / _PLATFORM / _PLATFORM_ANNUAL.
 *
 * Used by resolveTier and extractRawSubscriptionTier so subscription events
 * derive the tier directly from the current price, which is the only
 * reliable source for portal-driven upgrades and downgrades — Stripe leaves
 * a subscription's metadata untouched when a customer changes plans through
 * the Stripe Customer Portal. Entries are only added for env vars that are
 * set, so missing config gracefully degrades to metadata-based resolution.
 */
const PRICE_ID_TO_TIER: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  const envPairs: Array<[string, string]> = [
    ["STRIPE_PRICE_ID_PROFESSIONAL",    "professional"],
    ["STRIPE_PRICE_ID_TEAMS",           "teams"],
    ["STRIPE_PRICE_ID_PLATFORM",        "platform"],
    ["STRIPE_PRICE_ID_PLATFORM_ANNUAL", "platform_annual"]
  ];
  for (const [envVar, tier] of envPairs) {
    const id = process.env[envVar]?.trim();
    if (id) map[id] = tier;
  }
  return map;
})();

/**
 * Returns the raw tier label for a subscription's first price item, or null
 * if the price ID is not in the env-configured map. SecureLogic plans are
 * single-item, so the first item is authoritative for the current catalog.
 */
function resolveTierFromPriceId(subscription: Stripe.Subscription): string | null {
  const priceId = subscription.items?.data?.[0]?.price?.id;
  if (!priceId) return null;
  return PRICE_ID_TO_TIER[priceId] ?? null;
}

/**
 * Resolves the SecureLogic entitlement tier for a Stripe event.
 *
 * Returns a value from the Redis Tier union ("professional" | "paid"):
 *   - "professional" → Brief tier (entitlement_level="professional")
 *       raw: "professional", "teams"
 *   - "paid"         → full platform tier (entitlement_level="premium")
 *       raw: "platform", "platform_annual", legacy "team"/"paid"/"admin"
 *
 * For customer.subscription.* events, the subscription's current price ID
 * is the source of truth — portal-driven upgrades/downgrades change the
 * price without rewriting metadata, so metadata can be stale. If price-ID
 * resolution fails (env var missing, unknown price), falls back to metadata.
 * Non-subscription events (checkout.session.completed, etc.) read metadata
 * directly, preserving prior behavior.
 *
 * RETURNS null WHEN THE TIER CANNOT BE DETERMINED — it does NOT guess.
 * ---------------------------------------------------------------------
 * This previously defaulted to "paid" — the FULL PLATFORM tier — whenever the
 * price was unmapped and metadata was absent or unrecognised, justified as
 * "forward compatibility with legacy events". The effect was that the least
 * trustworthy input produced the most privileged output: any subscription
 * created outside our own Checkout (Stripe Dashboard, comped, migrated,
 * internal) carries no tier metadata, and so was granted premium access on the
 * strength of being unrecognised.
 *
 * Returning null instead lets the caller decline to act. Note what that is NOT:
 * it is not a downgrade. An unresolvable GRANT is ignored, so an existing
 * entitlement is left exactly as it was rather than being lowered on a guess —
 * important because the same unresolvable input could belong to a legitimate
 * customer whose metadata we simply cannot read. Revocation is unaffected and
 * must stay that way: cancellations and past_due transitions do not consult the
 * tier at all, so a subscription can always still LOSE access.
 *
 * The unresolved case is logged at error level with the price ID, because it
 * now means a real event was not applied and someone has to look at it.
 */
function resolveTier(event: Stripe.Event): "professional" | "paid" | null {
  if (event.type.startsWith("customer.subscription.")) {
    const subscription = event.data.object as Stripe.Subscription;
    const priceTier = resolveTierFromPriceId(subscription);
    if (priceTier === "professional" || priceTier === "teams") {
      return "professional";
    }
    if (priceTier === "platform" || priceTier === "platform_annual") {
      return "paid";
    }
    // priceTier === null → fall through to metadata
  }

  const obj = event.data.object as any;
  const rawTier =
    obj?.metadata?.tier ??
    obj?.subscription_details?.metadata?.tier ??
    null;

  if (typeof rawTier !== "string" || !KNOWN_TIERS.has(rawTier)) {
    const priceId =
      event.type.startsWith("customer.subscription.")
        ? (event.data.object as Stripe.Subscription).items?.data?.[0]?.price?.id ?? null
        : null;
    logger.error(
      {
        event: "stripe_unresolved_tier",
        // `typeof` as well as the value: distinguishes absent from a non-string
        // (object/array) metadata value, which is what "malformed" looks like.
        rawTier: typeof rawTier === "string" ? rawTier : null,
        rawTierType: typeof rawTier,
        priceId,
        stripeEventType: event.type
      },
      "stripeWebhook: tier could not be resolved from price ID or metadata — " +
        "NO entitlement granted (previously defaulted to 'paid')"
    );
    return null;
  }

  if (rawTier === "professional" || rawTier === "teams") {
    return "professional";
  }

  // platform, platform_annual, team (legacy), paid (legacy), admin (legacy)
  return "paid";
}

/**
 * Determines whether a subscription event should grant or revoke entitlement.
 * For `customer.subscription.updated`, the subscription status is the deciding factor.
 */
function classifySubscriptionEvent(
  eventType: string,
  subscription: Stripe.Subscription | null,
  /**
   * null means "the tier could not be determined". Only the GRANT branches
   * consult it; revocation deliberately does not, so access can always be
   * withdrawn even when the tier is unresolvable.
   */
  metadataTier: "professional" | "paid" | null
): EntitlementRecord | null {
  if (REVOKE_EVENTS.has(eventType)) {
    return { tier: "free", activeSubscription: false };
  }

  if (eventType === "customer.subscription.updated" && subscription) {
    const status = subscription.status;
    if (status === "active" || status === "trialing") {
      // Decline rather than guess. Returning null leaves the existing
      // entitlement untouched — it neither grants premium to an unrecognised
      // subscription nor downgrades a legitimate one.
      if (metadataTier === null) return null;
      return { tier: metadataTier, activeSubscription: true };
    }
    if (
      status === "canceled" ||
      status === "past_due" ||
      status === "unpaid" ||
      status === "incomplete_expired"
    ) {
      return { tier: "free", activeSubscription: false };
    }
    // incomplete / paused — ignore
    return null;
  }

  if (GRANT_EVENTS.has(eventType)) {
    if (metadataTier === null) return null;
    return { tier: metadataTier, activeSubscription: true };
  }

  return null;
}

/**
 * Extract the SecureLogic api_keys.id (UUID) from Stripe event metadata.
 * The id is stored in session.metadata.api_key_id or subscription.metadata.api_key_id.
 */
function extractApiKeyId(event: Stripe.Event): string | null {
  const obj = event.data.object as any;

  return (
    obj?.metadata?.api_key_id ??
    obj?.subscription_details?.metadata?.api_key_id ??
    // Invoice payloads rendered under the Basil API version move the
    // subscription block to invoice.parent.subscription_details. Which shape
    // arrives is decided by the API VERSION CONFIGURED ON THE WEBHOOK ENDPOINT
    // in the Stripe Dashboard, not by the apiVersion pinned in stripeClient.ts
    // — so both are read rather than assuming either. This is a resolution
    // fallback only; organizations.stripe_customer_id remains the primary.
    obj?.parent?.subscription_details?.metadata?.api_key_id ??
    null
  );
}

/**
 * The subscription a paid/failed INVOICE belongs to, read version-agnostically.
 *
 * Pre-Basil payloads carry invoice.subscription; Basil payloads carry
 * invoice.parent.subscription_details.subscription. Both are read because the
 * rendering version is a Dashboard setting on the webhook endpoint, which is
 * not represented anywhere in this repo and has not been verified.
 *
 * Returns null for a one-off invoice — which is the point: a paid invoice with
 * no subscription behind it must never move entitlement.
 */
function extractInvoiceSubscriptionId(obj: any): string | null {
  const candidates = [
    obj?.subscription,
    obj?.parent?.subscription_details?.subscription,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
    if (c && typeof c === "object" && typeof c.id === "string" && c.id.length > 0) {
      return c.id;
    }
  }
  return null;
}

/**
 * The price ID on an invoice's first line, read version-agnostically.
 *
 * Pre-Basil: line.price.id. Basil: line.pricing.price_details.price.
 * SecureLogic plans are single-item, so the first line is authoritative for
 * what was just paid. Returns null when no line carries a resolvable price.
 */
function extractInvoicePriceId(obj: any): string | null {
  const lines: any[] = Array.isArray(obj?.lines?.data) ? obj.lines.data : [];
  for (const line of lines) {
    const id =
      (typeof line?.price?.id === "string" ? line.price.id : null) ??
      (typeof line?.pricing?.price_details?.price === "string"
        ? line.pricing.price_details.price
        : null) ??
      (typeof line?.plan?.id === "string" ? line.plan.id : null);
    if (id) return id;
  }
  return null;
}

/**
 * Maps a RAW tier label (the catalog vocabulary stored in
 * organizations.stripe_subscription_tier and keyed by PRICE_ID_TO_TIER) to the
 * entitlement tier the rest of the billing system speaks.
 *
 * Deliberately strict, and deliberately NOT defaulting: an unrecognised label
 * returns null so the caller declines to act, exactly as resolveTier does. The
 * least trustworthy input must never produce the most privileged output.
 */
function rawTierToEntitlementTier(raw: string | null): "professional" | "paid" | null {
  if (raw === "professional" || raw === "teams") return "professional";
  if (raw === "platform" || raw === "platform_annual" || raw === "team" || raw === "paid") {
    return "paid";
  }
  return null;
}

/**
 * Extract the Stripe customer ID from a Stripe event object.
 * Present on subscriptions and checkout sessions.
 */
function extractCustomerId(event: Stripe.Event): string | null {
  const obj = event.data.object as any;
  const id = obj?.customer;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Extracts the raw subscription tier string for storage in
 * api_keys.stripe_subscription_tier. Returns 'professional', 'teams',
 * 'platform', 'platform_annual', or legacy 'team' when known; null otherwise.
 *
 * For customer.subscription.* events, the subscription's price ID is the
 * source of truth (portal-driven plan changes don't rewrite metadata).
 * Falls back to checkout/subscription metadata for non-subscription events
 * or when no env-configured price matches.
 *
 * This is distinct from resolveTier(): that function normalises 'team' →
 * 'paid' for Redis/entitlement purposes. This function preserves the
 * original value so it can be stored for future feature gating.
 */
function extractRawSubscriptionTier(event: Stripe.Event): string | null {
  if (event.type.startsWith("customer.subscription.")) {
    const subscription = event.data.object as Stripe.Subscription;
    const priceTier = resolveTierFromPriceId(subscription);
    if (priceTier) return priceTier;
  }

  const obj = event.data.object as any;
  const raw =
    obj?.metadata?.tier ??
    obj?.subscription_details?.metadata?.tier ??
    null;
  if (
    raw === "professional" ||
    raw === "teams" ||
    raw === "platform" ||
    raw === "platform_annual" ||
    raw === "team"
  ) {
    return raw;
  }
  return null;
}

/**
 * Maps a tier string to the Postgres entitlement_level value.
 *
 * Accepts both Redis EntitlementRecord tiers ("free"|"professional"|"paid"|"admin")
 * and raw Stripe metadata tiers ("teams"|"platform"|"platform_annual"), so the
 * function is safe against either source of truth.
 *
 *   professional, teams                  → "professional"  (Brief access)
 *   platform, platform_annual, paid, admin → "premium"      (full platform)
 *   free (or anything else)              → "starter"
 */
function tierToDbLevel(tier: string): string {
  if (tier === "professional" || tier === "teams") {
    return "professional";
  }
  if (
    tier === "platform" ||
    tier === "platform_annual" ||
    tier === "paid" ||
    tier === "admin"
  ) {
    return "premium";
  }
  return "starter";
}

/**
 * customer.subscription.trial_will_end → heads-up email to the org's admins
 * (#692 A7). Stripe fires this once, ~3 days before the trial converts and the
 * card is charged; before this email existed the webhook logged and the
 * conversion charge (up to $7,200 for Platform Annual) landed unannounced.
 *
 * Recipients: verified admin users of the org resolved via stripe_customer_id.
 * Content is built only from the event (plan via price ID, amount from the
 * subscription item, end date from trial_end) — no extra Stripe API calls.
 */
async function sendTrialWillEndEmails(
  sub: Stripe.Subscription,
  customerId: string
): Promise<void> {
  const orgResult = await pg.query<{ id: string; name: string }>(
    `SELECT id, name FROM organizations WHERE stripe_customer_id = $1 LIMIT 1`,
    [customerId]
  );
  const org = orgResult.rows[0];
  if (!org) {
    logger.warn(
      { event: "stripe_trial_will_end_org_missing", customerId },
      "stripeWebhook: trial_will_end — no org for customer, skipping email"
    );
    return;
  }

  const admins = await pg.query<{ email: string; name: string | null }>(
    `SELECT email, name FROM users
      WHERE organization_id = $1 AND role = 'admin' AND email_verified = TRUE
      ORDER BY created_at ASC`,
    [org.id]
  );
  if (admins.rows.length === 0) {
    logger.warn(
      { event: "stripe_trial_will_end_no_admins", orgId: org.id },
      "stripeWebhook: trial_will_end — org has no verified admins, skipping email"
    );
    return;
  }

  // Display labels mirror the canonical app map (app/src/lib/api.ts
  // planDisplayName). Trial tiers are Platform-only by construction
  // (PLATFORM_TRIAL_TIERS in billing.ts).
  const tier = resolveTierFromPriceId(sub);
  const planLabel =
    tier === "platform_annual" ? "Platform Annual" : "Platform Professional";

  const endDate = sub.trial_end
    ? new Date(sub.trial_end * 1000).toLocaleDateString("en-US", {
        month: "long", day: "numeric", year: "numeric",
      })
    : null;

  const item = sub.items?.data?.[0];
  const unitAmount = item?.price?.unit_amount ?? null;
  const currency = (item?.price?.currency ?? "usd").toUpperCase();
  const interval = item?.price?.recurring?.interval ?? null;
  const amountLabel =
    unitAmount !== null
      ? `${currency === "USD" ? "$" : `${currency} `}${(unitAmount / 100).toLocaleString("en-US")}${interval ? ` / ${interval}` : ""}`
      : null;

  const appBase = (process.env.APP_BASE_URL ?? "https://app.securelogicai.com").replace(/\/$/, "");
  const whenLine = endDate ? ` on <strong>${endDate}</strong>` : " in about 3 days";
  const chargeLine = amountLabel
    ? `Your subscription will start at <strong>${amountLabel}</strong> using the card on file.`
    : "Your subscription will start using the card on file.";

  const subject = `Your SecureLogic ${planLabel} trial ends soon`;
  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 560px; margin: 0 auto; color: #0f172a;">
      <h2 style="margin-bottom: 8px;">Your ${planLabel} trial ends${endDate ? ` ${endDate}` : " soon"}</h2>
      <p style="color: #334155; line-height: 1.6;">
        The free trial for <strong>${org.name}</strong> converts${whenLine}.
        ${chargeLine}
      </p>
      <p style="color: #334155; line-height: 1.6;">
        To review your plan, update the payment method, or cancel before
        conversion, open your billing settings:
      </p>
      <p>
        <a href="${appBase}/account"
           style="display: inline-block; background: #0d9488; color: #ffffff; text-decoration: none; font-weight: 600; padding: 10px 24px; border-radius: 8px;">
          Manage Billing
        </a>
      </p>
      <p style="color: #64748b; font-size: 13px;">
        Nothing to do if you want to keep ${planLabel} — access continues uninterrupted.
      </p>
    </div>`;

  for (const admin of admins.rows) {
    const result = await sendEmail({ to: admin.email, subject, html });
    logger.info(
      {
        event: "stripe_trial_will_end_email",
        orgId: org.id,
        to: admin.email,
        ok: result.ok,
        reason: result.ok ? null : result.reason,
      },
      "stripeWebhook: trial_will_end heads-up email attempted"
    );
  }
}

/**
 * Resolve the SecureLogic organization_id for a Stripe event.
 *
 * Two paths, tried in order:
 *  1. Customer-id lookup against organizations.stripe_customer_id — the
 *     durable path. Survives api_key rotation: every webhook event for a
 *     given customer always lands on the same org row.
 *  2. api_key_id lookup, used only when path 1 misses. This is the
 *     first-checkout case: the customer was just created, the metadata
 *     carries the api_key_id from billing.ts, but organizations.stripe_customer_id
 *     hasn't been backfilled yet (the webhook write itself is the backfill).
 *
 * Returns null when both paths miss; the caller logs and ignores the event.
 */
async function resolveOrgIdForEvent(
  customerId: string | null,
  apiKeyId: string | null
): Promise<{ orgId: string | null; resolvedBy: "stripe_customer_id" | "api_key_id" | "none" }> {
  if (customerId) {
    const result = await pg.query<{ id: string }>(
      `SELECT id FROM organizations WHERE stripe_customer_id = $1 LIMIT 1`,
      [customerId]
    );
    if (result.rows[0]?.id) {
      return { orgId: result.rows[0].id, resolvedBy: "stripe_customer_id" };
    }
  }

  if (apiKeyId) {
    const result = await pg.query<{ organization_id: string }>(
      `SELECT organization_id FROM api_keys WHERE id = $1 LIMIT 1`,
      [apiKeyId]
    );
    if (result.rows[0]?.organization_id) {
      return { orgId: result.rows[0].organization_id, resolvedBy: "api_key_id" };
    }
  }

  return { orgId: null, resolvedBy: "none" };
}

/**
 * Sync entitlement state to the organizations row. Errors are logged but
 * never thrown — the webhook must always return 200 to Stripe.
 *
 * organizations.entitlement_level is the source of truth for entitlement.
 * organizations.plan is kept in lock-step (same value) to support legacy
 * reads (e.g. /api/me); both columns should be retired into one in a
 * follow-up cleanup PR.
 *
 * Subscription identifiers (stripe_subscription_id, stripe_subscription_tier)
 * are stored to support the stale-revoke guard in the main handler: a
 * customer.subscription.deleted event whose sub.id no longer matches the
 * org's current sub.id is a superseded subscription and must not downgrade.
 */
async function syncOrgEntitlement(
  orgId: string,
  entitlement: EntitlementRecord,
  customerId: string | null,
  subscriptionId: string | null,
  rawSubscriptionTier: string | null,
  subscriptionStatus: string | null,
  apiKeyId: string | null,
  ordering: EventOrdering
): Promise<SyncOutcome> {
  const level = tierToDbLevel(entitlement.tier);

  // On a successful grant, clear any stale payment_failed_at stamp.
  const clearPaymentFailed = entitlement.activeSubscription;

  const client = await pg.connect();
  try {
    await client.query("BEGIN");

    const updateResult = await client.query(
      `
      UPDATE organizations
         SET entitlement_level          = $1,
             plan                       = $1,
             -- Monitored-entity cap. The webhook only ever RAISES a paid org to
             -- at least the 50 default (GREATEST sees the OLD column value) and
             -- NEVER lowers it. This preserves an admin-elevated ("Platform
             -- Scale") cap across renewals AND across a past_due dip: status
             -- past_due/canceled transiently writes entitlement_level='starter'
             -- (the ELSE branch leaves the cap untouched), and the recovery back
             -- to premium keeps the elevated cap instead of resetting it. A
             -- genuine Scale→base downgrade is an operator action (the same
             -- admin path that raised the cap), not a webhook side effect. The
             -- cap is moot while downgraded — those orgs are premium-gated out
             -- of entity creation.
             max_monitored_entities     = CASE
                                            WHEN $1 IN ('premium','professional') THEN GREATEST(max_monitored_entities, 50)
                                            ELSE max_monitored_entities
                                          END,
             -- Seat cap (#692 A8): both pricing surfaces sell Platform as
             -- "Up to 10 seats"; the DB default is 6. A platform-tier grant
             -- ('premium' comes only from platform/platform_annual/legacy)
             -- raises the cap to the advertised 10 — GREATEST + same
             -- never-lower/downgrade-dip semantics as the entity cap above.
             -- Brief tiers ('professional', incl. Brief Team) stay at the
             -- default 6, matching their advertised seats.
             max_members                = CASE
                                            WHEN $1 = 'premium' THEN GREATEST(COALESCE(max_members, 6), 10)
                                            ELSE max_members
                                          END,
             stripe_customer_id         = COALESCE(stripe_customer_id, $3),
             stripe_subscription_id     = COALESCE($4, stripe_subscription_id),
             stripe_subscription_tier   = COALESCE($5, stripe_subscription_tier),
             stripe_subscription_status = COALESCE($6, stripe_subscription_status),
             payment_failed_at          = CASE WHEN $7 THEN NULL ELSE payment_failed_at END,
             -- The watermark advances with the write it authorises, in the
             -- same statement as the WHERE clause that checks it (D5).
             stripe_billing_event_at    = to_timestamp($8),
             stripe_billing_event_id    = $9
       WHERE id = $2
         AND ${orderingPredicate(8, 9)}
      `,
      [
        level,
        orgId,
        customerId,
        subscriptionId,
        rawSubscriptionTier,
        subscriptionStatus,
        clearPaymentFailed,
        ordering.createdAt,
        ordering.eventId,
      ]
    );

    await client.query("COMMIT");

    const rows = updateResult.rowCount ?? 0;

    if (rows === 0) {
      // rowCount 0 is now ambiguous: the row may not exist, or the ordering
      // predicate may have suppressed a stale/duplicate event. Classify it, so
      // "we deliberately ignored an out-of-order event" never reads in the logs
      // as "the org is missing".
      const outcome = await classifySuppression(orgId, ordering);
      logger.warn(
        {
          event:
            outcome === "not_found"
              ? "stripe_webhook_db_sync_no_match"
              : "stripe_webhook_event_suppressed",
          reason: outcome,
          orgId,
          apiKeyId,
          level,
          eventId: ordering.eventId,
          eventCreated: ordering.createdAt,
        },
        outcome === "not_found"
          ? "stripeWebhook: organizations row not found — entitlement not updated"
          : "stripeWebhook: out-of-order or duplicate billing event — entitlement NOT changed"
      );
      return outcome;
    }

    logger.info(
      { event: "stripe_webhook_db_sync_ok", orgId, apiKeyId, level, customerId },
      "stripeWebhook: organizations.entitlement_level updated"
    );

    // Paid-tier upgrade: auto-subscribe the org's primary (oldest) user to the
    // Intelligence Brief if the org has no active subscriber yet. Best-effort —
    // failures are logged but never bubble up to the webhook handler.
    if (level === "professional" || level === "premium") {
      try {
        const subscribeResult = await pg.query(
          `
          INSERT INTO intelligence_brief_subscribers (organization_id, email, name, active)
          SELECT u.organization_id,
                 LOWER(TRIM(u.email)),
                 NULLIF(u.name, ''),
                 TRUE
          FROM users u
          WHERE u.organization_id = $1
            AND NOT EXISTS (
              SELECT 1 FROM intelligence_brief_subscribers ibs
              WHERE ibs.organization_id = u.organization_id
                AND ibs.active = TRUE
            )
          ORDER BY u.created_at ASC
          LIMIT 1
          ON CONFLICT (organization_id, email) DO UPDATE
            SET active          = TRUE,
                unsubscribed_at = NULL,
                updated_at      = NOW()
          RETURNING id
          `,
          [orgId]
        );

        if ((subscribeResult.rowCount ?? 0) > 0) {
          logger.info(
            { event: "stripe_webhook_brief_auto_subscribed", orgId, level },
            "stripeWebhook: auto-subscribed org primary user to Intelligence Brief"
          );
        }
      } catch (subscribeErr) {
        logger.error(
          { event: "stripe_webhook_brief_auto_subscribe_failed", orgId, err: subscribeErr },
          "stripeWebhook: failed to auto-subscribe org to Intelligence Brief (non-fatal)"
        );
      }
    }
    return "applied";
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      logger.error(
        { event: "stripe_webhook_db_rollback_failed", rollbackErr },
        "stripeWebhook: ROLLBACK failed after sync error (non-fatal)"
      );
    }
    logger.error(
      { event: "stripe_webhook_db_sync_failed", err },
      "stripeWebhook: failed to sync entitlement to DB (non-fatal)"
    );
    // The watermark did NOT advance — the whole statement rolled back — so the
    // event stays replayable. Stripe still gets its 200 (a non-200 here would
    // have it retry the entire event, including the outbound Stripe calls
    // elsewhere in this handler), but nothing is recorded as applied.
    return "error";
  } finally {
    client.release();
  }
}

/**
 * When a customer upgrades to a Platform plan (platform or platform_annual),
 * cancel any other active subscriptions on the same Stripe customer. This
 * prevents a subscriber who previously paid for a Brief plan from being
 * double-charged once they move onto a full-platform subscription.
 *
 * The newly-created platform subscription (identified by newSubscriptionId)
 * is excluded from cancellation so we never cancel the very subscription
 * that just granted access.
 *
 * Non-fatal: any failure is logged and swallowed so webhook delivery is
 * never blocked by a housekeeping cancel step.
 */
async function cancelPriorBriefSubscriptions(
  customerId: string,
  newSubscriptionId: string | null
): Promise<void> {
  try {
    const subs = await getStripe().subscriptions.list({
      customer: customerId,
      status: "active"
    });

    for (const sub of subs.data) {
      if (sub.id === newSubscriptionId) continue;

      try {
        await getStripe().subscriptions.cancel(sub.id, { prorate: true });
        logger.info(
          {
            event: "stripe_brief_sub_cancelled_on_platform_upgrade",
            cancelledSubId: sub.id,
            newSubId: newSubscriptionId,
            customerId
          },
          "stripeWebhook: cancelled prior Brief subscription on platform upgrade"
        );
      } catch (err) {
        logger.error(
          {
            event: "stripe_brief_sub_cancel_failed",
            cancelledSubId: sub.id,
            customerId,
            err
          },
          "stripeWebhook: failed to cancel prior Brief subscription (non-fatal)"
        );
      }
    }
  } catch (err) {
    logger.error(
      { event: "stripe_brief_sub_cancel_failed", customerId, err },
      "stripeWebhook: failed to list prior subscriptions for platform upgrade (non-fatal)"
    );
  }
}

/**
 * The org's verified admins — the people who lose the product when billing
 * lapses. Mirrors sendTrialWillEndEmails' recipient rule deliberately: Stripe's
 * own emails go to the BILLING contact, who is often finance and often not the
 * person who will hit a 403 tomorrow. The two audiences are complementary, not
 * duplicative.
 */
async function orgAdminRecipients(
  orgId: string
): Promise<{ orgName: string; admins: Array<{ email: string; name: string | null }> } | null> {
  const orgResult = await pg.query<{ name: string }>(
    `SELECT name FROM organizations WHERE id = $1 LIMIT 1`,
    [orgId]
  );
  const orgName = orgResult.rows[0]?.name;
  if (!orgName) return null;

  const admins = await pg.query<{ email: string; name: string | null }>(
    `SELECT email, name FROM users
      WHERE organization_id = $1 AND role = 'admin' AND email_verified = TRUE
      ORDER BY created_at ASC`,
    [orgId]
  );
  if (admins.rows.length === 0) return null;

  return { orgName, admins: admins.rows };
}

function emailShell(heading: string, body: string, cta: string, footnote: string): string {
  const appBase = (process.env.APP_BASE_URL ?? "https://app.securelogicai.com").replace(/\/$/, "");
  return `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 560px; margin: 0 auto; color: #0f172a;">
      <h2 style="margin-bottom: 8px;">${heading}</h2>
      ${body}
      <p>
        <a href="${appBase}/account"
           style="display: inline-block; background: #0d9488; color: #ffffff; text-decoration: none; font-weight: 600; padding: 10px 24px; border-radius: 8px;">
          ${cta}
        </a>
      </p>
      <p style="color: #64748b; font-size: 13px;">${footnote}</p>
    </div>`;
}

/**
 * The dunning notice.
 *
 * THE COPY IS DERIVED, NOT WRITTEN. Whether this email may say "your access
 * continues until DATE" is decided by graceState() — the same function that
 * enforces grace at request time — rather than by the template author. That is
 * structural, not stylistic: if the grace mechanism (PR-F) is not deployed or
 * its flag is off, graceState returns `lapsed` and the wording switches to
 * "access has been suspended" automatically. **The promise cannot outrun the
 * mechanism**, and no future edit to this file can make it.
 */
async function sendDunningEmails(args: {
  orgId: string;
  cycleStartedAt: Date | string;
  subscriptionStatus: string | null;
  stage: 0 | 7 | 14;
}): Promise<void> {
  const recipients = await orgAdminRecipients(args.orgId);
  if (!recipients) {
    logger.warn(
      { event: "stripe_dunning_email_no_recipients", orgId: args.orgId, stage: args.stage },
      "dunning email: org missing or has no verified admins — skipping"
    );
    return;
  }

  const inputs = {
    paymentFailedAt: args.cycleStartedAt,
    subscriptionStatus: args.subscriptionStatus,
  };
  const state = graceState(inputs);
  const endsAt = state === "in_grace" ? graceEndsAt(inputs) : null;
  const endsLabel = endsAt
    ? endsAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null;

  const { orgName, admins } = recipients;

  // Two vocabularies, one per grace state. Nothing here interpolates a date
  // unless graceState says the access it describes is real.
  const subject =
    state === "in_grace"
      ? args.stage === 0
        ? `Payment failed for ${orgName} — action needed`
        : args.stage === 7
          ? `Still unpaid: ${orgName} access ends ${endsLabel ?? "soon"}`
          : `Final notice: ${orgName} access ends ${endsLabel ?? "tomorrow"}`
      : `Payment failed for ${orgName} — access suspended`;

  const heading =
    state === "in_grace" ? "We couldn't process your payment" : "Your SecureLogic access is suspended";

  const accessLine =
    state === "in_grace" && endsLabel
      ? `<p style="color: #334155; line-height: 1.6;">Your access to SecureLogic continues until <strong>${endsLabel}</strong>. Update your payment method before then and nothing will be interrupted.</p>`
      : `<p style="color: #334155; line-height: 1.6;">Access for <strong>${orgName}</strong> has been suspended until payment is resolved. Your data is intact and returns as soon as the payment goes through.</p>`;

  const urgency =
    args.stage === 14
      ? `<p style="color: #b91c1c; line-height: 1.6; font-weight: 600;">This is the last reminder before access ends.</p>`
      : "";

  const html = emailShell(
    heading,
    `<p style="color: #334155; line-height: 1.6;">The most recent payment for <strong>${orgName}</strong> could not be processed. This is usually an expired or replaced card.</p>${accessLine}${urgency}`,
    "Update Payment Method",
    "Your data is never deleted for a failed payment. If you have already updated your card, you can ignore this."
  );

  for (const admin of admins) {
    const result = await sendEmail({ to: admin.email, subject, html });
    logger.info(
      {
        event: "stripe_dunning_email",
        orgId: args.orgId,
        stage: args.stage,
        graceState: state,
        to: admin.email,
        ok: result.ok,
        reason: result.ok ? null : result.reason,
      },
      "dunning email attempted"
    );
  }
}

/**
 * The recovery confirmation. Without it, a customer who fixed their card has no
 * signal that access is back — they are left guessing whether the last email
 * they received still applies.
 */
async function sendPaymentRecoveredEmails(orgId: string): Promise<void> {
  const recipients = await orgAdminRecipients(orgId);
  if (!recipients) return;

  const { orgName, admins } = recipients;
  const html = emailShell(
    "You're all set",
    `<p style="color: #334155; line-height: 1.6;">We received the payment for <strong>${orgName}</strong> and full access has been restored. No further action is needed.</p>`,
    "Open SecureLogic",
    "This confirms the earlier payment-failure notice is resolved."
  );

  for (const admin of admins) {
    const result = await sendEmail({
      to: admin.email,
      subject: `Payment received — ${orgName} access restored`,
      html,
    });
    logger.info(
      {
        event: "stripe_payment_recovered_email",
        orgId,
        to: admin.email,
        ok: result.ok,
        reason: result.ok ? null : result.reason,
      },
      "payment recovered email attempted"
    );
  }
}

/**
 * Handles invoice.payment_failed: stamps payment_failed_at on the
 * organizations row so the billing UI can surface a dunning state. Does
 * NOT revoke access — Stripe will send customer.subscription.updated
 * (past_due) and eventually customer.subscription.deleted after its retry
 * cycle, which will revoke.
 */
async function handlePaymentFailed(event: Stripe.Event): Promise<void> {
  const obj = event.data.object as any;
  const customerId = typeof obj?.customer === "string" ? obj.customer : null;

  if (!customerId) {
    logger.warn(
      { event: "stripe_invoice_payment_failed_no_customer" },
      "invoice.payment_failed: no customer ID in event — skipping"
    );
    return;
  }

  const ordering = orderingOf(event);
  const invoiceSubId = extractInvoiceSubscriptionId(obj);

  try {
    // Two guards, both in the WHERE clause so the check and the write stay one
    // atomic statement:
    //
    //   D6 — SUBSCRIPTION GUARD. This used to match on stripe_customer_id
    //   alone, so ANY failed invoice for the customer stamped the org as
    //   delinquent, including one belonging to a superseded subscription left
    //   behind by a tier change. The guard is written to bite only when both
    //   sides are known: an org with no stored subscription id, or an invoice
    //   with no subscription on it, still stamps exactly as before.
    //
    //   D5 — ORDERING. A stale payment failure must not re-stamp an org that
    //   has already recovered under a newer event.
    const result = await pg.query<{
      id: string;
      payment_failed_at: Date | string;
      stripe_subscription_status: string | null;
    }>(
      `
      UPDATE organizations
         -- RULING R1. payment_failed_at is the START of the delinquency cycle,
         -- not the latest failure, and it is stamped from STRIPE's clock.
         --
         -- COALESCE, because Stripe retries up to 8 times across a 2-week
         -- window and every retry lands here. Writing NOW() each time made the
         -- stamp track the LATEST failure, so its age never exceeded the gap
         -- between retries (~2-3 days) — which means a grace clock derived from
         -- it would reset on every retry and a day-15 backstop could never
         -- fire. Write-once-per-cycle makes the column mean "this delinquency
         -- began at T", which is the only question anything asks of it.
         --
         -- to_timestamp(event.created), because our processing time is not the
         -- customer's clock: a delayed delivery would silently extend grace
         -- past the date we put in writing in the dunning email. This also
         -- matches the ordering watermark below, so BOTH timestamps in the
         -- billing projection come from Stripe.
         --
         -- The cycle ends when a successful payment clears this column
         -- (syncOrgEntitlement), so the next delinquency stamps fresh and gets
         -- a full new window.
         SET payment_failed_at       = COALESCE(payment_failed_at, to_timestamp($2)),
             stripe_billing_event_at = to_timestamp($2),
             stripe_billing_event_id = $3
       WHERE stripe_customer_id = $1
         AND ($4::text IS NULL
              OR stripe_subscription_id IS NULL
              OR stripe_subscription_id = $4)
         AND ${orderingPredicate(2, 3)}
      RETURNING id, payment_failed_at, stripe_subscription_status
      `,
      [customerId, ordering.createdAt, ordering.eventId, invoiceSubId]
    );

    const rowsUpdated = result.rowCount ?? 0;

    if (rowsUpdated === 0) {
      // No row matched. Either the customer is unknown to us, the invoice is
      // for a superseded subscription, or the event lost the ordering check.
      // Whichever it is, NOT stamping is the correct outcome — but it must be
      // visible, because "we ignored a payment failure" is not a quiet fact.
      logger.warn(
        {
          event: "stripe_payment_failed_not_stamped",
          customerId,
          invoiceId: obj?.id ?? null,
          invoiceSubId,
          eventId: ordering.eventId,
          eventCreated: ordering.createdAt
        },
        "invoice.payment_failed: no row stamped — unknown customer, superseded subscription, or out-of-order event"
      );
      return;
    }

    const org = result.rows[0]!;

    logger.warn(
      {
        event: "stripe_payment_failed",
        orgId: org.id,
        customerId,
        rowsUpdated,
        invoiceId: obj?.id ?? null,
        invoiceSubId,
        cycleStartedAt: org.payment_failed_at,
        amountDue: obj?.amount_due ?? null
      },
      "invoice.payment_failed: payment_failed_at stamped — access NOT revoked"
    );

    // Open the cycle. `isNew` is the ONLY reliable way to tell the opening
    // failure from its retries — under R1 every retry carries the same
    // cycle_started_at, so the UNIQUE constraint is what separates them.
    // Without this the customer would get one email per retry attempt.
    const { cycleId, isNew } = await openDunningCycle({
      organizationId: org.id,
      cycleStartedAt: org.payment_failed_at,
      subscriptionId: invoiceSubId,
      eventId: ordering.eventId,
    });

    if (cycleId && isNew && (await claimDunningStage(cycleId, 0))) {
      try {
        await sendDunningEmails({
          orgId: org.id,
          cycleStartedAt: org.payment_failed_at,
          subscriptionStatus: org.stripe_subscription_status,
          stage: 0,
        });
      } catch (err) {
        // Never fatal. A non-2xx would make Stripe retry the WHOLE event,
        // re-running the entitlement writes above to fix a mail problem.
        logger.warn(
          { event: "stripe_dunning_email_failed", orgId: org.id, cycleId, err },
          "invoice.payment_failed: dunning email failed (non-fatal)"
        );
      }
    }
  } catch (err) {
    logger.error(
      { event: "stripe_payment_failed_db_error", customerId, err },
      "invoice.payment_failed: failed to stamp payment_failed_at (non-fatal)"
    );
  }
}

/**
 * Handles invoice.paid / invoice.payment_succeeded: the recovery path.
 *
 * WHY THIS EXISTS (SL-BILL-1 D4). Entitlement used to be restored ONLY by a
 * customer.subscription.updated(active) whose tier resolveTier could resolve.
 * If it could not — a subscription created outside our Checkout (Dashboard,
 * comped, migrated) carries no tier metadata, and an unmapped price ID resolves
 * to null — the handler responded {ignored: true} and nothing was written. The
 * org stayed at 'starter' with payment_failed_at set while holding a live,
 * fully paid subscription. There was no second chance: these invoice events
 * were not handled at all, and payment_failed_at only ever cleared as a side
 * effect of a successful grant. A paying customer could be locked out
 * permanently with no self-service route back.
 *
 * The tier is resolved from the invoice's own price first (authoritative for
 * what was just paid), then from organizations.stripe_subscription_tier (the
 * last tier a successful grant stored — always present for an org that has
 * ever been provisioned, which every dunning-recovery org has). A live
 * subscriptions.retrieve() was considered as a third source and deliberately
 * declined: it adds a network failure mode inside the webhook path for
 * coverage the first two sources already provide.
 *
 * STALENESS GUARDS. A paid invoice must not resurrect entitlement for a
 * subscription that is no longer the org's:
 *   - the invoice must reference a subscription at all (one-off invoices and
 *     $0 non-subscription invoices never move entitlement);
 *   - if the org has a stored subscription id, the invoice's must match it —
 *     the same superseded-subscription reasoning as the stale-revoke guard on
 *     customer.subscription.deleted, inverted;
 *   - an org whose stored status is terminal (canceled / incomplete_expired)
 *     is not restored by a late invoice from the dead subscription.
 * Full ordering safety (an event.created watermark) is PR-D and is not
 * attempted here.
 *
 * IDEMPOTENCY. The restore is a converging write: it sets entitlement to what
 * the paid invoice says it should be and clears payment_failed_at. Running it
 * twice — which happens by design, since invoice.paid and
 * invoice.payment_succeeded are distinct events for the same payment — reaches
 * the same state. `wasDelinquent` is read BEFORE the write so the recovery is
 * counted once: the second event observes an already-healthy org and logs
 * wasDelinquent=false.
 */
async function handlePaymentRecovered(
  event: Stripe.Event
): Promise<{ restored: boolean; reason?: string }> {
  const obj = event.data.object as any;
  const customerId = typeof obj?.customer === "string" ? obj.customer : null;
  const invoiceId = typeof obj?.id === "string" ? obj.id : null;
  const invoiceSubId = extractInvoiceSubscriptionId(obj);

  if (!invoiceSubId) {
    logger.info(
      { event: "stripe_payment_recovered_skipped", reason: "not_subscription_invoice", invoiceId },
      "invoice paid: no subscription on the invoice — entitlement untouched"
    );
    return { restored: false, reason: "not_subscription_invoice" };
  }

  const rawApiKeyId = extractApiKeyId(event);
  const apiKeyId = isValidApiKeyId(rawApiKeyId) ? rawApiKeyId : null;

  const { orgId, resolvedBy } = await resolveOrgIdForEvent(customerId, apiKeyId);

  if (!orgId) {
    logger.warn(
      { event: "stripe_payment_recovered_org_not_resolved", customerId, invoiceId },
      "invoice paid: could not resolve organization_id — entitlement untouched"
    );
    return { restored: false, reason: "org_not_resolved" };
  }

  const { rows } = await pg.query<{
    entitlement_level: string | null;
    payment_failed_at: string | null;
    stripe_subscription_id: string | null;
    stripe_subscription_status: string | null;
    stripe_subscription_tier: string | null;
  }>(
    `SELECT entitlement_level, payment_failed_at, stripe_subscription_id,
            stripe_subscription_status, stripe_subscription_tier
       FROM organizations WHERE id = $1 LIMIT 1`,
    [orgId]
  );

  const org = rows[0];

  if (!org) {
    logger.warn(
      { event: "stripe_payment_recovered_org_missing", orgId, invoiceId },
      "invoice paid: organizations row not found — entitlement untouched"
    );
    return { restored: false, reason: "org_missing" };
  }

  if (org.stripe_subscription_id && org.stripe_subscription_id !== invoiceSubId) {
    logger.info(
      {
        event: "stripe_payment_recovered_skipped",
        reason: "superseded_subscription",
        orgId,
        currentSubId: org.stripe_subscription_id,
        invoiceSubId,
        invoiceId
      },
      "invoice paid: invoice belongs to a superseded subscription — entitlement untouched"
    );
    return { restored: false, reason: "superseded" };
  }

  if (
    org.stripe_subscription_status === "canceled" ||
    org.stripe_subscription_status === "incomplete_expired"
  ) {
    logger.info(
      {
        event: "stripe_payment_recovered_skipped",
        reason: "terminal_subscription_status",
        orgId,
        status: org.stripe_subscription_status,
        invoiceId
      },
      "invoice paid: subscription already terminal — entitlement untouched"
    );
    return { restored: false, reason: "terminal_status" };
  }

  const invoicePriceId = extractInvoicePriceId(obj);
  const priceRawTier = invoicePriceId ? PRICE_ID_TO_TIER[invoicePriceId] ?? null : null;
  const rawTier = priceRawTier ?? org.stripe_subscription_tier ?? null;
  const tier = rawTierToEntitlementTier(rawTier);

  if (!tier) {
    // Fail VISIBLE, not silent, and do NOT clear payment_failed_at. Clearing it
    // would remove the banner — the customer's only in-product signal — while
    // leaving them downgraded and unable to explain why. Leaving the stamp keeps
    // them pointed at the billing portal while this alert is investigated.
    logger.error(
      {
        event: "stripe_recovery_tier_unresolved",
        orgId,
        invoiceId,
        invoiceSubId,
        invoicePriceId,
        storedTier: org.stripe_subscription_tier,
        entitlementLevel: org.entitlement_level
      },
      "invoice paid: tier unresolvable from invoice price or stored tier — entitlement NOT restored, manual action required"
    );
    return { restored: false, reason: "tier_unresolved" };
  }

  // Read BEFORE the write so a recovery is counted exactly once across the
  // invoice.paid / invoice.payment_succeeded pair.
  const wasDelinquent =
    Boolean(org.payment_failed_at) || org.entitlement_level === "starter";

  const entitlement: EntitlementRecord = { tier, activeSubscription: true };

  // subscriptionStatus is passed as null on purpose: a paid invoice does not
  // carry subscription status, and syncOrgEntitlement COALESCEs, so the stored
  // status is left for the accompanying customer.subscription.updated to set.
  const outcome = await syncOrgEntitlement(
    orgId,
    entitlement,
    customerId,
    invoiceSubId,
    priceRawTier,
    null,
    apiKeyId,
    orderingOf(event)
  );

  if (outcome !== "applied") {
    // A recovery that loses the ordering check is NOT silently swallowed: the
    // customer is still delinquent as far as our state is concerned, and that
    // has to be visible. The stamp is deliberately left in place.
    logger.warn(
      { event: "stripe_payment_recovered_not_applied", orgId, invoiceId, outcome },
      "invoice paid: restore was not applied — see stripe_webhook_event_suppressed"
    );
    return { restored: false, reason: outcome };
  }

  // Mirror to Redis only after the authoritative write survived the ordering
  // check — same reasoning as the grant path.
  if (apiKeyId) {
    await setEntitlementInRedis(apiKeyId, entitlement);
  }

  // Close the dunning cycle. The returned ids ARE the claim for the
  // confirmation email: recovery can be observed more than once (this event and
  // a following subscription.updated(active) both restore entitlement), and
  // only the caller that actually flipped recovered_at sends mail.
  const recoveredCycles = await markCyclesRecovered(orgId);
  if (recoveredCycles.length > 0) {
    try {
      await sendPaymentRecoveredEmails(orgId);
    } catch (err) {
      logger.warn(
        { event: "stripe_payment_recovered_email_failed", orgId, err },
        "invoice paid: recovery confirmation email failed (non-fatal)"
      );
    }
  }

  logger.info(
    {
      event: "stripe_payment_recovered",
      orgId,
      apiKeyId,
      customerId,
      invoiceId,
      invoiceSubId,
      resolvedBy,
      tier,
      rawTier,
      tierSource: priceRawTier ? "invoice_price" : "stored_subscription_tier",
      wasDelinquent,
      stripeEventType: event.type
    },
    "invoice paid: entitlement restored and payment_failed_at cleared"
  );

  return { restored: true };
}

/* =========================================================
   MAIN HANDLER
   ========================================================= */

export async function stripeWebhook(
  req: Request,
  res: Response
): Promise<void> {
  // Always return 200 — Stripe retries on non-200 and can DDoS the server.
  const respond = (body: object) => res.status(200).json(body);

  try {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();

    if (!webhookSecret) {
      logger.error(
        { event: "stripe_webhook_misconfigured" },
        "stripeWebhook: STRIPE_WEBHOOK_SECRET not set"
      );
      respond({ received: true, updated: false });
      return;
    }

    const sig = req.get("stripe-signature");

    if (!sig || sig.length > MAX_SIG_LENGTH) {
      logger.warn(
        { event: "stripe_webhook_missing_signature" },
        "stripeWebhook: missing or oversized stripe-signature header"
      );
      respond({ received: true, ignored: true });
      return;
    }

    const raw = (req as any).rawBody as unknown;

    if (!Buffer.isBuffer(raw)) {
      logger.error(
        { event: "stripe_webhook_no_raw_body" },
        "stripeWebhook: rawBody missing or not Buffer"
      );
      respond({ received: true, ignored: true });
      return;
    }

    let event: Stripe.Event;

    try {
      event = getStripe().webhooks.constructEvent(raw, sig, webhookSecret);
    } catch (err) {
      logger.warn(
        { event: "stripe_webhook_signature_invalid", err },
        "stripeWebhook: signature verification failed"
      );
      respond({ received: true, ignored: true });
      return;
    }

    const eventType = event.type;

    logger.info(
      { event: "stripe_webhook_received", stripeEventType: eventType },
      "stripe webhook received"
    );

    // Idempotency gate (C3). Placed immediately after constructEvent so that
    // payment_failed writes, entitlement writes, and outbound Stripe cancel
    // calls in cancelPriorBriefSubscriptions all sit behind it. Fail-closed
    // on claim INSERT failure: return 500 so Stripe retries — silently
    // re-processing during a Postgres-unhealthy window is worse than letting
    // the provider's retry mechanism handle it.
    try {
      const { firstSeen } = await claimWebhookEvent("stripe", event.id, eventType);
      if (!firstSeen) {
        logger.info(
          {
            event: "stripe_webhook_idempotent_replay",
            stripeEventType: eventType,
            stripeEventId: event.id
          },
          "stripeWebhook: duplicate event_id — short-circuiting before downstream writes"
        );
        respond({ received: true, idempotent_replay: true });
        return;
      }
    } catch (err) {
      logger.error(
        {
          event: "stripe_webhook_idempotency_claim_failed",
          stripeEventType: eventType,
          stripeEventId: event.id,
          err
        },
        "stripeWebhook: idempotency claim INSERT failed — failing closed, Stripe will retry"
      );
      res.status(500).json({ error: "idempotency_check_failed" });
      return;
    }

    // Handle payment failure first — separate action from grant/revoke flow
    if (PAYMENT_FAILED_EVENTS.has(eventType)) {
      await handlePaymentFailed(event);
      respond({ received: true, updated: true });
      return;
    }

    // Handle payment recovery next, for the same reason: it is a distinct
    // action from the grant/revoke classification below, and it must run even
    // when classifySubscriptionEvent would decline. This is the branch that
    // guarantees a customer who has paid gets their product back (D4).
    if (RECOVERY_EVENTS.has(eventType)) {
      const result = await handlePaymentRecovered(event);
      respond({ received: true, ...result });
      return;
    }

    // Trial ending soon (fires ~3 days before a trial converts). No
    // entitlement change — access continues through conversion. Emails the
    // org's admins so the conversion charge never lands unannounced; email
    // failure is non-fatal (never block the 200 — Stripe would retry the
    // whole event and we'd re-email on an unrelated failure).
    if (eventType === "customer.subscription.trial_will_end") {
      const sub = event.data.object as Stripe.Subscription;
      const trialCustomerId =
        typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
      logger.info(
        {
          event: "stripe_trial_will_end",
          subscriptionId: sub.id,
          trialEnd: sub.trial_end,
          customerId: trialCustomerId,
        },
        "stripeWebhook: Platform trial ending soon — notifying org admins, no entitlement change"
      );
      if (trialCustomerId) {
        try {
          await sendTrialWillEndEmails(sub, trialCustomerId);
        } catch (err) {
          logger.warn(
            { event: "stripe_trial_will_end_email_failed", customerId: trialCustomerId, err },
            "stripeWebhook: trial_will_end email failed (non-fatal)"
          );
        }
      }
      respond({ received: true, trial_will_end: true });
      return;
    }

    // Determine what entitlement action to take
    const subscription =
      eventType.startsWith("customer.subscription.")
        ? (event.data.object as Stripe.Subscription)
        : null;

    const metadataTier = resolveTier(event);
    const entitlement = classifySubscriptionEvent(eventType, subscription, metadataTier);

    if (!entitlement) {
      respond({ received: true, ignored: true });
      return;
    }

    // Extract the SecureLogic api_keys.id from metadata. This is a resolution
    // FALLBACK, never a gate. Checkout-originated events carry it, but Stripe
    // lifecycle events (renewals, portal plan changes, cancellations, dunning)
    // frequently do not — and any subscription created outside the app's own
    // Checkout (dashboard, comped, migrated, internal) never carries it. The
    // durable resolver is organizations.stripe_customer_id (backfilled on first
    // grant), so an absent or malformed api_key_id must fall through to
    // customer-id resolution below, not short-circuit the event. Bailing here
    // was the PR-D1 defect: it made the documented-primary customer-id resolver
    // unreachable, so cancellations/downgrades on metadata-less subscriptions
    // silently failed to sync (entitlement never revoked/adjusted).
    const rawApiKeyId = extractApiKeyId(event);
    const apiKeyId = isValidApiKeyId(rawApiKeyId) ? rawApiKeyId : null;

    if (rawApiKeyId !== null && apiKeyId === null) {
      // Present but malformed — worth a warning, but NOT fatal. Resolution
      // continues via stripe_customer_id below.
      logger.warn(
        {
          event: "stripe_webhook_invalid_api_key_id",
          stripeEventType: eventType
        },
        "stripeWebhook: api_key_id present in metadata but malformed — falling back to customer-id resolution"
      );
    }

    // Extract customer ID, sub ID, raw tier, and status for DB sync
    const customerId = extractCustomerId(event);
    const rawSubscriptionTier = extractRawSubscriptionTier(event);
    const subscriptionId = subscription?.id ?? null;
    const subscriptionStatus = subscription?.status ?? null;

    // Resolve org. Primary path: organizations.stripe_customer_id. Fallback:
    // api_keys.id → organization_id (used for first-checkout events where
    // the customer hasn't been backfilled onto the org yet).
    const { orgId, resolvedBy } = await resolveOrgIdForEvent(customerId, apiKeyId);

    if (!orgId) {
      logger.warn(
        {
          event: "stripe_webhook_org_not_resolved",
          stripeEventType: eventType,
          customerId,
          apiKeyId
        },
        "stripeWebhook: could not resolve organization_id from event — ignoring"
      );
      respond({ received: true, ignored: true, reason: "org_not_resolved" });
      return;
    }

    logger.info(
      { event: "stripe_webhook_org_resolved", orgId, resolvedBy, apiKeyId, customerId },
      "stripeWebhook: resolved organization for event"
    );

    // Stale-revoke guard. Only applies to customer.subscription.deleted: when
    // upgrading tiers, Stripe cancels the old subscription after creating the
    // new one, and the resulting delete event would otherwise downgrade
    // entitlement back to 'starter'. If the deleted sub.id no longer matches
    // the org's current stripe_subscription_id, the cancellation is for a
    // superseded subscription and must be ignored.
    //
    // The guard only fires on .deleted events. customer.subscription.updated
    // events that legitimately change sub state (past_due, canceled status
    // on the live sub) flow through normally.
    if (eventType === "customer.subscription.deleted" && subscriptionId) {
      const { rows } = await pg.query<{ stripe_subscription_id: string | null }>(
        `SELECT stripe_subscription_id FROM organizations WHERE id = $1 LIMIT 1`,
        [orgId]
      );
      const currentSubId = rows[0]?.stripe_subscription_id ?? null;

      if (currentSubId && currentSubId !== subscriptionId) {
        logger.info(
          {
            event: "stripe_webhook_revoke_skipped_stale",
            stripeEventType: eventType,
            orgId,
            currentSubId,
            canceledSubId: subscriptionId
          },
          "stripeWebhook: skipping revoke — canceled sub.id differs from current (superseded subscription)"
        );
        respond({ received: true, ignored: true, reason: "superseded" });
        return;
      }
    }

    // Write to Redis (supplementary cache) then sync to Postgres (primary).
    // The Redis entry is keyed per api_key and is read ONLY by the admin
    // entitlements route — request-time enforcement reads
    // organizations.entitlement_level from Postgres (attachOrganizationContext).
    // When the event carried no valid api_key_id (resolved via customer-id),
    // there is no key to write; skip the cache and let the authoritative
    // Postgres sync below stand.
    const syncOutcome = await syncOrgEntitlement(
      orgId,
      entitlement,
      customerId,
      subscriptionId,
      rawSubscriptionTier,
      subscriptionStatus,
      apiKeyId,
      orderingOf(event)
    );

    if (syncOutcome === "stale" || syncOutcome === "duplicate") {
      respond({ received: true, updated: false, suppressed: syncOutcome });
      return;
    }

    // The Redis mirror is written only AFTER the authoritative Postgres write
    // succeeds. It used to be written first, which meant a suppressed or failed
    // sync still left a stale tier in the cache — the cache disagreeing with
    // the source of truth in exactly the situations where ordering was already
    // in doubt.
    if (apiKeyId) {
      await setEntitlementInRedis(apiKeyId, entitlement);
    }

    // Record the org's one-time Platform trial the moment it actually begins.
    // Set at trial START (not at checkout creation) so an abandoned checkout
    // never burns the org's single trial. Guarded WHERE trial_started_at IS
    // NULL → idempotent across the trialing 'created' + 'updated' events. The
    // checkout handler reads this column to reject a second trial (one per org).
    if (
      subscriptionStatus === "trialing" &&
      (rawSubscriptionTier === "platform" || rawSubscriptionTier === "platform_annual")
    ) {
      const claimed = await pg.query(
        `UPDATE organizations SET trial_started_at = NOW()
          WHERE id = $1 AND trial_started_at IS NULL
          RETURNING id`,
        [orgId]
      );
      if ((claimed.rowCount ?? 0) > 0) {
        logger.info(
          { event: "stripe_platform_trial_started", orgId, subscriptionId },
          "stripeWebhook: Platform trial started — recorded one-time trial claim on organization"
        );
      }
    }

    // Platform upgrade: cancel any prior Brief subscriptions on the same
    // customer so they don't pay twice. Only fires for checkout.session.completed
    // (so we have session.subscription to exclude) with raw tier
    // "platform" or "platform_annual", and only after a successful grant.
    if (
      eventType === "checkout.session.completed" &&
      entitlement.activeSubscription &&
      customerId &&
      (rawSubscriptionTier === "platform" || rawSubscriptionTier === "platform_annual")
    ) {
      const session = event.data.object as Stripe.Checkout.Session;
      const newSubscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id ?? null;

      // Brief → Platform upgrade credit (#9). Compute the prior Brief sub IDs
      // (active subs other than the new Platform one) and credit BEFORE the
      // cancel, while those subs are still active and their paid invoices are
      // listable. Gated/idempotent/non-fatal — a no-op unless
      // SECURELOGIC_BRIEF_PLATFORM_CREDIT_ENABLED=true.
      try {
        const active = await getStripe().subscriptions.list({ customer: customerId, status: "active" });
        const priorBriefSubscriptionIds = active.data
          .map((s) => s.id)
          .filter((id) => id !== newSubscriptionId);
        await applyBriefToPlatformCredit({
          customerId,
          newSubscriptionId,
          priorBriefSubscriptionIds,
          organizationId: orgId,
        });
      } catch (err) {
        logger.error(
          { event: "brief_platform_credit_wiring_failed", orgId, customerId, err },
          "stripeWebhook: brief→platform credit step failed (non-fatal)"
        );
      }

      await cancelPriorBriefSubscriptions(customerId, newSubscriptionId);
    }

    // NOTE: Stripe no longer auto-enrolls payers into the `subscribers` list.
    // That list fed the legacy Newsletter / Daily Digest sends, which are now
    // disabled (the Intelligence Brief is the single weekly email; findings stay
    // in-app). Brief subscription is handled separately via
    // intelligence_brief_subscribers above. The `subscribers` table remains
    // admin-managed (routes/adminSubscribers.ts) for any manual use.

    logger.info(
      {
        event: "stripe_webhook_entitlement_written",
        stripeEventType: eventType,
        orgId,
        apiKeyId,
        redisTier: entitlement.tier,
        dbLevel: tierToDbLevel(entitlement.tier)
      },
      "stripe webhook processed: entitlement updated"
    );

    respond({ received: true, updated: true });
  } catch (err) {
    logger.error(
      { event: "stripe_webhook_failed", err },
      "stripeWebhook: unhandled error (fail-open)"
    );
    respond({ received: true, updated: false });
  }
}
