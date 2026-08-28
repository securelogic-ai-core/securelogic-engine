/**
 * emailTransport.ts — THE single choke point for every outbound email.
 *
 * EMAIL-OBS-1. Before this module, production emitted ZERO structured log
 * lines from any of the eleven send sites, so "the Brief was delivered" was an
 * unfalsifiable claim. Eight sites also read the Resend SDK's return value
 * without checking `error` — the SDK RESOLVES with `{ data: null, error }` on
 * an API rejection and only throws on transport failure — so a refused send
 * looked identical to an accepted one.
 *
 * Every send site now calls `sendViaProvider()` and nothing else touches the
 * provider. The transport:
 *
 *   1. logs `email_send_attempt` BEFORE the provider call and
 *      `email_send_result` AFTER it, with an outcome;
 *   2. checks the SDK's `{ error }` — a rejection is `provider_rejected`,
 *      never "sent";
 *   3. applies the environment tag (P1-2) so no site can forget it;
 *   4. persists the provider message id → (purpose, org, correlation id,
 *      sent_at) in `email_sends` so the provider's webhook events can be
 *      joined back to the send that caused them.
 *
 * PRIVACY CONTRACT — the part that must not regress
 * --------------------------------------------------
 * No log line produced here carries a recipient address, a subject, a body, a
 * token, or a link. The recipient is described by its DOMAIN and, when a
 * per-recipient join across lines is needed, by a keyed HMAC of the lowercased
 * address (`EMAIL_RECIPIENT_HASH_KEY`, falling back to `RESEND_WEBHOOK_SECRET`;
 * with neither present the hash is omitted — an unkeyed digest of an email
 * address is a dictionary lookup away from the address, so it is never used).
 * Provider error text is passed through `sanitizeProviderText()`, which
 * redacts anything shaped like an email address and truncates.
 *
 * `emailTransport.test.ts` serialises every emitted line and asserts
 * the raw address, subject and body are absent. Keep it that way.
 *
 * WHY THIS LIVES IN infra/
 * ------------------------
 * The intelligence worker's tsconfig compiles `src/api/infra` and nothing else
 * from the engine; the newsletter sender is the highest-volume path and must
 * go through the same choke point, so the module can import only from infra.
 */

import { createHmac, randomUUID } from "node:crypto";
import { Resend } from "resend";
import { logger } from "./logger.js";
import { pgElevated } from "./postgres.js";
import { currentEmailEnvironment, withEnvironmentTag } from "./emailEnvironment.js";

export const EMAIL_PROVIDER = "resend";

/** What happened to one send, as reported on `email_send_result`. */
export type EmailSendOutcome =
  /** Provider accepted the message; `providerMessageId` is set. */
  | "accepted"
  /** Provider answered with an error (SDK `{ error }` or non-2xx). */
  | "provider_rejected"
  /** Skipped by a suppression check before any provider call. */
  | "suppressed"
  /**
   * Reserved for environment-isolation ENFORCEMENT (a sender whose identity is
   * `unknown` refusing to send). Isolation is dark today, so this is never
   * emitted; it exists so the vocabulary is stable when enforcement lands.
   */
  | "skipped_dark_mode"
  /** No provider credential configured on this service. */
  | "skipped_unconfigured"
  /** Transport-level failure (SDK threw, network, timeout). */
  | "error"
  /**
   * Refused because the process is a TEST RUNNER. The Resend account holds 51
   * real password-reset emails to `*@tokens.test` addresses (since 2026-08-17,
   * all bounced, tagged `environment=unknown`) — isolation tests that exercise
   * the live auth routes reach the live provider whenever a developer's shell
   * carries RESEND_API_KEY. See `isTestRunnerSendBlocked()`.
   */
  | "blocked_test_env";

/** The identity of a send: why it exists and what it belongs to. */
export type EmailSendContext = {
  /**
   * Stable template/purpose key, e.g. `brief.weekly`, `newsletter.issue`,
   * `auth.verification`. Grep-able; never free text.
   */
  purpose: string;
  /** Tenant the send belongs to; null for platform-level mail. */
  orgId?: string | null;
  /**
   * Domain correlation id: the Brief id, newsletter issue id, finding id…
   * The value an operator already has in hand when asking "did it go out?".
   */
  correlationId?: string | null;
};

export type Tag = { name: string; value: string };

type ResendSendPayload = Parameters<Resend["emails"]["send"]>[0];

/**
 * The slice of the Resend client the transport needs. Sites that own a
 * client (alertPrimitives.getResend) pass it in; their tests keep mocking it.
 */
export type ResendLike = {
  emails: {
    send: (payload: ResendSendPayload) => Promise<{
      data?: { id: string } | null;
      error?: { message?: string; statusCode?: number | null; name?: string } | null;
    }>;
  };
};

export type ProviderSendArgs = EmailSendContext & {
  to: string;
  from: string;
  subject: string;
  html: string;
  text?: string;
  tags?: Tag[];
  /** Optional client; when absent one is built from RESEND_API_KEY. */
  client?: ResendLike;
};

export type ProviderSendResult =
  | {
      ok: true;
      outcome: "accepted";
      sendId: string;
      providerMessageId: string | null;
    }
  | {
      ok: false;
      outcome: "provider_rejected" | "error" | "skipped_unconfigured" | "blocked_test_env";
      sendId: string;
      providerMessageId: null;
      errorName: string | null;
      /** Sanitised — safe to log and to store. */
      errorMessage: string;
      statusCode: number | null;
    };

// ---------------------------------------------------------------------------
// Privacy helpers
// ---------------------------------------------------------------------------

const EMAIL_RE = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const MAX_TEXT = 200;

/** The domain part of an address, lowercased; null when it has none. */
export function recipientDomain(address: string | null | undefined): string | null {
  const at = (address ?? "").trim().lastIndexOf("@");
  if (at < 0) return null;
  const domain = (address ?? "").trim().slice(at + 1).toLowerCase();
  return domain || null;
}

function hashKey(): string | null {
  const k = process.env.EMAIL_RECIPIENT_HASH_KEY?.trim() || process.env.RESEND_WEBHOOK_SECRET?.trim();
  return k || null;
}

/**
 * Keyed, truncated HMAC of the lowercased address. Stable across services
 * that share the key (sender and webhook receiver do), so a webhook event can
 * be matched to a send even when the provider message id is missing. Null
 * when no key is configured — never an unkeyed digest.
 */
export function recipientHash(address: string | null | undefined): string | null {
  const key = hashKey();
  const normalized = (address ?? "").trim().toLowerCase();
  if (!key || !normalized) return null;
  return createHmac("sha256", key).update(normalized).digest("hex").slice(0, 16);
}

/** Redact anything shaped like an email address; bound the length. */
export function sanitizeProviderText(value: unknown): string {
  const s = typeof value === "string" ? value : value == null ? "" : String(value);
  return s.replace(EMAIL_RE, "[email]").slice(0, MAX_TEXT);
}

/** The privacy-safe description of a recipient used on every line. */
export function describeRecipient(address: string): { recipientDomain: string | null; recipientHash: string | null } {
  return { recipientDomain: recipientDomain(address), recipientHash: recipientHash(address) };
}

// ---------------------------------------------------------------------------
// Persistence — the join key for webhook events
// ---------------------------------------------------------------------------

const PERSIST_TIMEOUT_MS = 3000;

type SendRecord = {
  sendId: string;
  purpose: string;
  orgId: string | null;
  correlationId: string | null;
  environment: string;
  recipientDomain: string | null;
  recipientHash: string | null;
  outcome: EmailSendOutcome;
  providerMessageId: string | null;
  errorName: string | null;
  errorMessage: string | null;
};

/**
 * Best-effort, bounded write. A send that the provider already accepted must
 * never be reported as failed because OUR bookkeeping failed, and the send
 * path must never hang on the database — so this races a timeout and logs
 * `email_send_record_failed` instead of throwing. The elevated channel is
 * correct: `email_sends` is platform-level (no org column, owner-only), the
 * same disposition as `email_provider_events`.
 */
async function persistSend(rec: SendRecord): Promise<void> {
  try {
    const write = pgElevated.query(
      `INSERT INTO email_sends (
         id, provider, provider_message_id, purpose, organization_id, correlation_id,
         environment, recipient_domain, recipient_hash, outcome,
         provider_error_name, provider_error_message
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO NOTHING`,
      [
        rec.sendId,
        EMAIL_PROVIDER,
        rec.providerMessageId,
        rec.purpose,
        rec.orgId,
        rec.correlationId,
        rec.environment,
        rec.recipientDomain,
        rec.recipientHash,
        rec.outcome,
        rec.errorName,
        rec.errorMessage
      ]
    );
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("email_sends write timed out")), PERSIST_TIMEOUT_MS);
    });
    try {
      await Promise.race([write, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (err) {
    logger.warn(
      { event: "email_send_record_failed", sendId: rec.sendId, purpose: rec.purpose, err },
      "Could not record the send in email_sends — webhook events for this message will be unmatched"
    );
  }
}

// ---------------------------------------------------------------------------
// Test-runner guard
// ---------------------------------------------------------------------------

/** Set to exactly "true" to let a test process reach the live provider. */
export const EMAIL_ALLOW_TEST_SEND_ENV = "SECURELOGIC_EMAIL_ALLOW_TEST_SEND";

/**
 * Is this process a test runner that must NOT reach the provider?
 *
 * A vitest worker sets `VITEST`; a conventional test harness sets
 * `NODE_ENV=test`. Either means "no real mail leaves this process" unless the
 * operator opts out explicitly with `SECURELOGIC_EMAIL_ALLOW_TEST_SEND=true`
 * for a deliberate live test. Unit tests that drive a MOCKED provider set the
 * opt-out in their own `beforeEach` — per file, greppable — so the isolation
 * suite, which exercises the real auth routes, stays blocked by default.
 */
export function isTestRunnerSendBlocked(env: NodeJS.ProcessEnv = process.env): boolean {
  const isTestRunner = Boolean(env.VITEST) || env.NODE_ENV === "test";
  if (!isTestRunner) return false;
  return env[EMAIL_ALLOW_TEST_SEND_ENV]?.trim() !== "true";
}

// ---------------------------------------------------------------------------
// The choke point
// ---------------------------------------------------------------------------

function buildClient(): ResendLike | null {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return null;
  return new Resend(key) as unknown as ResendLike;
}

function baseFields(sendId: string, ctx: EmailSendContext, to: string) {
  return {
    sendId,
    provider: EMAIL_PROVIDER,
    purpose: ctx.purpose,
    orgId: ctx.orgId ?? null,
    correlationId: ctx.correlationId ?? null,
    environment: currentEmailEnvironment(),
    ...describeRecipient(to)
  };
}

/**
 * Send one email through the provider. Never throws.
 *
 * Emits `email_send_attempt` then `email_send_result`; persists accepted /
 * rejected / errored attempts to `email_sends`. Does NOT check suppressions —
 * that is deliberately left to the call site, because the sites disagree on
 * purpose (verification mail bypasses the local mirror by design). A site that
 * skips a send should call `logEmailSkipped()` so the outcome series is
 * complete.
 */
export async function sendViaProvider(args: ProviderSendArgs): Promise<ProviderSendResult> {
  const sendId = randomUUID();
  const to = args.to.trim();
  const ctx: EmailSendContext = { purpose: args.purpose, orgId: args.orgId ?? null, correlationId: args.correlationId ?? null };
  const base = baseFields(sendId, ctx, to);

  if (isTestRunnerSendBlocked()) {
    // Purpose / org / correlation only — deliberately not even the domain: a
    // test fixture address is exactly the kind of value that would sit in a
    // developer's terminal scrollback.
    logger.warn(
      {
        event: "email_send_blocked_test_env",
        sendId,
        provider: EMAIL_PROVIDER,
        purpose: ctx.purpose,
        orgId: ctx.orgId ?? null,
        correlationId: ctx.correlationId ?? null,
        optOut: EMAIL_ALLOW_TEST_SEND_ENV
      },
      "Email NOT sent — test runner detected; set SECURELOGIC_EMAIL_ALLOW_TEST_SEND=true for a deliberate live test"
    );
    return {
      ok: false,
      outcome: "blocked_test_env",
      sendId,
      providerMessageId: null,
      errorName: null,
      errorMessage: "blocked: test runner",
      statusCode: null
    };
  }

  const client = args.client ?? buildClient();
  if (!client) {
    logger.warn(
      { event: "email_send_result", ...base, outcome: "skipped_unconfigured" },
      "Email not sent — RESEND_API_KEY is not configured on this service"
    );
    return {
      ok: false,
      outcome: "skipped_unconfigured",
      sendId,
      providerMessageId: null,
      errorName: null,
      errorMessage: "RESEND_API_KEY not set",
      statusCode: null
    };
  }

  logger.info({ event: "email_send_attempt", ...base }, "Email send attempted");
  const started = Date.now();

  const payload = {
    from: args.from,
    to,
    subject: args.subject,
    html: args.html,
    ...(args.text ? { text: args.text } : {}),
    tags: withEnvironmentTag(args.tags)
  } as ResendSendPayload;

  let result: ProviderSendResult;
  try {
    const res = await client.emails.send(payload);
    const error = res?.error;
    if (error) {
      result = {
        ok: false,
        outcome: "provider_rejected",
        sendId,
        providerMessageId: null,
        errorName: error.name ?? null,
        errorMessage: sanitizeProviderText(error.message ?? "provider rejected the send"),
        statusCode: typeof error.statusCode === "number" ? error.statusCode : null
      };
    } else {
      result = { ok: true, outcome: "accepted", sendId, providerMessageId: res?.data?.id ?? null };
    }
  } catch (err) {
    result = {
      ok: false,
      outcome: "error",
      sendId,
      providerMessageId: null,
      errorName: err instanceof Error ? err.name : null,
      errorMessage: sanitizeProviderText(err instanceof Error ? err.message : String(err)),
      statusCode: null
    };
  }

  const durationMs = Date.now() - started;
  if (result.ok) {
    logger.info(
      { event: "email_send_result", ...base, outcome: result.outcome, providerMessageId: result.providerMessageId, durationMs },
      "Email accepted by provider"
    );
  } else {
    logger.warn(
      {
        event: "email_send_result",
        ...base,
        outcome: result.outcome,
        providerMessageId: null,
        providerErrorName: result.errorName,
        providerErrorMessage: result.errorMessage,
        providerStatusCode: result.statusCode,
        durationMs
      },
      result.outcome === "provider_rejected" ? "Email rejected by provider" : "Email send errored"
    );
  }

  await persistSend({
    sendId,
    purpose: ctx.purpose,
    orgId: ctx.orgId ?? null,
    correlationId: ctx.correlationId ?? null,
    environment: base.environment,
    recipientDomain: base.recipientDomain,
    recipientHash: base.recipientHash,
    outcome: result.outcome,
    providerMessageId: result.ok ? result.providerMessageId : null,
    errorName: result.ok ? null : result.errorName,
    errorMessage: result.ok ? null : result.errorMessage
  });

  return result;
}

/**
 * Record a send that a call site decided NOT to make (suppressed address,
 * no credential…). Log-only: skips never reach the provider so there is no
 * message id to join on and nothing to persist.
 */
export function logEmailSkipped(
  args: EmailSendContext & { to: string; outcome: "suppressed" | "skipped_dark_mode" | "skipped_unconfigured"; reason?: string }
): void {
  const base = baseFields(randomUUID(), args, args.to.trim());
  logger.info(
    { event: "email_send_result", ...base, outcome: args.outcome, providerMessageId: null, reason: args.reason ?? null },
    "Email skipped before the provider was called"
  );
}
