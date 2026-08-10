/**
 * emailEnvironment.ts — which SecureLogic environment an email belongs to.
 *
 * WHY THIS EXISTS
 * ---------------
 * Staging, demo and production share ONE Resend account: an identical
 * RESEND_API_KEY and an identical RESEND_WEBHOOK_SECRET (verified per service,
 * not assumed). There is exactly one webhook endpoint registered on that
 * account and it points at the PRODUCTION engine.
 *
 * So every bounce and complaint — whoever generated it — is delivered to
 * production, passes signature verification because the secret matches, and is
 * written into production's `email_provider_events`, upserted into production's
 * `email_suppressions`, and used to flip `subscribers.status` to inactive.
 *
 * That is not hypothetical. A staging onboarding test bounced on 2026-08-10 and
 * suppressed the address in production; and the reverse hole is visible too —
 * an address suppressed at the provider since April has no row in staging's
 * mirror, because staging's webhook never fires at all.
 *
 * THE IDENTITY
 * ------------
 * `APP_ENV`, set explicitly per service (production / staging / demo). It is
 * deliberately explicit rather than inferred: no hostname sniffing, no
 * "not staging means production" default. An unset or unrecognised value
 * resolves to `unknown`, which is a state the receiver must be able to SEE
 * rather than silently absorb.
 *
 * Note `APP_ENV` was previously read in exactly one place — the logger's `base`
 * — as a labelling field with no behavioural branching. This module gives it a
 * second, load-bearing job, which is why the values are now set explicitly on
 * every sending and receiving service instead of relying on absence.
 */

/** The tag key carried on every outbound email and echoed in webhook events. */
export const ENVIRONMENT_TAG_NAME = "environment";

export type EmailEnvironment = "production" | "staging" | "demo" | "unknown";

const KNOWN: readonly string[] = ["production", "staging", "demo"];

/**
 * This service's environment identity.
 *
 * Read per call rather than cached at import: the test suite and any future
 * multi-tenant worker must be able to change it without re-importing, and the
 * cost is a single env read.
 */
export function currentEmailEnvironment(): EmailEnvironment {
  const raw = process.env.APP_ENV?.trim().toLowerCase();
  if (raw && KNOWN.includes(raw)) return raw as EmailEnvironment;
  return "unknown";
}

/**
 * The tag list to attach to an outbound send, merged with any tags the caller
 * already supplies.
 *
 * Resend tag values are restricted to ASCII letters, numbers, underscores and
 * dashes, which every value here satisfies. A caller-supplied `environment` tag
 * is overwritten rather than duplicated — there must be exactly one answer.
 */
export function withEnvironmentTag(
  existing?: Array<{ name: string; value: string }> | undefined
): Array<{ name: string; value: string }> {
  const kept = (existing ?? []).filter((t) => t?.name !== ENVIRONMENT_TAG_NAME);
  return [...kept, { name: ENVIRONMENT_TAG_NAME, value: currentEmailEnvironment() }];
}

/**
 * The environment an inbound webhook event claims to come from.
 *
 * Resend echoes send-time tags on the event as `data.tags`. The documented
 * shape is an OBJECT of key/value pairs (`{"environment":"staging"}`), but the
 * send API accepts an ARRAY of `{name,value}`, and providers have been known to
 * echo back what they were given — so both are accepted. Anything else, or an
 * absent tag, is `null`: "this event did not tell us", which is deliberately
 * distinct from "it told us something we don't recognise" (`unknown`).
 */
export function readEventEnvironment(payload: unknown): EmailEnvironment | null {
  const tags = (payload as { data?: { tags?: unknown } } | null)?.data?.tags;
  if (!tags) return null;

  let raw: unknown;

  if (Array.isArray(tags)) {
    const hit = tags.find(
      (t) => (t as { name?: string })?.name === ENVIRONMENT_TAG_NAME
    );
    raw = (hit as { value?: unknown })?.value;
  } else if (typeof tags === "object") {
    raw = (tags as Record<string, unknown>)[ENVIRONMENT_TAG_NAME];
  }

  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  return KNOWN.includes(value) ? (value as EmailEnvironment) : "unknown";
}

export type EnvironmentMatch =
  /** Sender and receiver agree — process normally, now and under enforcement. */
  | "match"
  /** The event names a DIFFERENT environment. Under enforcement: reject. */
  | "mismatch"
  /** The event carried no environment tag (pre-rollout mail, or a third party). */
  | "missing"
  /** We cannot classify — receiver identity unset, or an unrecognised tag. */
  | "indeterminate";

/**
 * Classify an inbound event against this service's identity.
 *
 * `indeterminate` exists so that a receiver whose own APP_ENV is unset can
 * never be reported as a clean `match`. Under enforcement it must be treated as
 * unsafe-to-drop rather than as agreement — the point of dark mode is to prove
 * this case does not occur before anything is rejected.
 */
export function classifyEventEnvironment(
  eventEnvironment: EmailEnvironment | null,
  receiver: EmailEnvironment = currentEmailEnvironment()
): EnvironmentMatch {
  if (eventEnvironment === null) return "missing";
  if (receiver === "unknown" || eventEnvironment === "unknown") return "indeterminate";
  return eventEnvironment === receiver ? "match" : "mismatch";
}
