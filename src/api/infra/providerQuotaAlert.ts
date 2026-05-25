/**
 * Provider quota / credit / rate-limit error detection + once-per-process
 * alert via the shared ALERT_WEBHOOK_URL channel (sendSecurityAlert).
 *
 * Inert until ALERT_WEBHOOK_URL is configured (same dependency as
 * A04-G4/A09-G2 auth-anomaly alerting).
 *
 * Preserves swallow/propagate behavior at every existing LLM call site:
 * factory-wrap intercepts on throw, fires the alert (best-effort), then
 * RE-THROWS the original error unchanged. Catch blocks at call sites
 * still see the same error they always did.
 */

import { logger } from "./logger.js";
import { sendSecurityAlert } from "./alerting.js";

export interface ProviderQuotaError {
  provider: "anthropic" | "openai";
  kind: "rate_limit" | "credit_balance" | "insufficient_quota";
}

// Module-level dedupe. Fires once per process; resets on next deploy/restart.
// Matches the operator-set "loud once, not noisy" intent — repeated quota
// errors during an exhaustion event produce one alert, not N.
let alertedThisProcess = false;

/**
 * Classify an unknown thrown value as a provider quota/credit/rate-limit
 * error, or return null if it's anything else.
 *
 * Matches on SDK error class names and structured error fields, NOT on
 * bare `status === 429` — Anthropic empty-balance is a 400 BadRequestError
 * with a credit-balance message, not a 429.
 */
export function isProviderQuotaError(err: unknown): ProviderQuotaError | null {
  if (!err || typeof err !== "object") return null;

  const e = err as {
    constructor?: { name?: string };
    status?: number;
    message?: string;
    code?: string;
    error?: { code?: string; type?: string; message?: string };
  };

  const name = e.constructor?.name;
  const message = typeof e.message === "string" ? e.message : "";
  const status = typeof e.status === "number" ? e.status : undefined;

  // Anthropic: RateLimitError (HTTP 429). SDK error class.
  if (name === "RateLimitError") {
    return { provider: "anthropic", kind: "rate_limit" };
  }

  // Anthropic: BadRequestError (HTTP 400) carrying a credit-balance message.
  // Empty-balance surfaces here, NOT as 429.
  // Example message: "Your credit balance is too low to access the Anthropic API…"
  if (name === "BadRequestError" && /credit\s*balance/i.test(message)) {
    return { provider: "anthropic", kind: "credit_balance" };
  }

  // OpenAI: insufficient_quota. Surfaces as either `err.code` (newer SDK)
  // or `err.error.code` (older shape).
  const openaiCode = e.code ?? e.error?.code;
  if (openaiCode === "insufficient_quota") {
    return { provider: "openai", kind: "insufficient_quota" };
  }

  // Defensive fallback: any 429 with a credit-balance message string.
  // Covers SDK class-name drift on future Anthropic SDK majors.
  if (status === 429 && /credit\s*balance/i.test(message)) {
    return { provider: "anthropic", kind: "credit_balance" };
  }

  return null;
}

/**
 * If `err` classifies as a provider quota error AND no alert has fired this
 * process, fire ONE sendSecurityAlert and set the dedupe flag.
 *
 * Best-effort: a failing webhook is logged and swallowed — must not mask
 * the original error the caller is about to handle.
 *
 * Inert when ALERT_WEBHOOK_URL is unset (sendSecurityAlert no-ops).
 */
export async function maybeAlertProviderQuotaError(err: unknown): Promise<void> {
  const classified = isProviderQuotaError(err);
  if (!classified) return;
  if (alertedThisProcess) return;
  alertedThisProcess = true;

  const message =
    err && typeof err === "object" && "message" in err
      ? String((err as { message: unknown }).message)
      : undefined;

  try {
    await sendSecurityAlert({
      kind: "provider_quota_exhausted",
      summary: `${classified.provider} quota exhausted (${classified.kind})`,
      detail: {
        provider: classified.provider,
        kind: classified.kind,
        message
      }
    });
  } catch (alertErr) {
    logger.error(
      { event: "provider_quota_alert_send_failed", alertErr },
      "Provider quota alert send failed"
    );
  }
}

/** Test-only: reset the once-per-process dedupe flag. Do not call in production code. */
export function resetProviderQuotaAlertStateForTest(): void {
  alertedThisProcess = false;
}

// ---------------------------------------------------------------------------
// SDK client instrumentation
// ---------------------------------------------------------------------------
//
// Each factory `getClient()` in the engine / worker returns a fresh Anthropic
// (or OpenAI) instance. We monkey-patch the single method we use on that
// instance (`messages.create` for Anthropic; `audio.transcriptions.create`
// for OpenAI) so a thrown error gets classified-and-alerted ON THE WAY PAST
// before being re-thrown unchanged. Existing catch blocks at call sites see
// the original error and apply their original swallow/return-null/re-throw
// behavior — this wrap does NOT change which errors propagate vs. swallow.

interface AnthropicLike {
  messages: { create: (...args: any[]) => Promise<any> };
}

interface OpenAILike {
  audio: { transcriptions: { create: (...args: any[]) => Promise<any> } };
}

export function instrumentAnthropicClient<T extends AnthropicLike>(client: T): T {
  const original = client.messages.create.bind(client.messages);
  client.messages.create = async (...args: any[]) => {
    try {
      return await original(...args);
    } catch (err) {
      await maybeAlertProviderQuotaError(err);
      throw err;
    }
  };
  return client;
}

export function instrumentOpenAIClient<T extends OpenAILike>(client: T): T {
  const original = client.audio.transcriptions.create.bind(client.audio.transcriptions);
  client.audio.transcriptions.create = async (...args: any[]) => {
    try {
      return await original(...args);
    } catch (err) {
      await maybeAlertProviderQuotaError(err);
      throw err;
    }
  };
  return client;
}
