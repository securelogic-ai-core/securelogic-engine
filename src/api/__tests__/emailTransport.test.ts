/**
 * emailTransport.test.ts — EMAIL-OBS-1: the single outbound-email choke point.
 *
 * What is pinned:
 *   1. every send emits `email_send_attempt` then `email_send_result`, and the
 *      result outcome is TRUTHFUL — the SDK's resolved `{ error }` is a
 *      `provider_rejected`, never "sent";
 *   2. PRIVACY — no emitted line, serialised, contains the recipient address,
 *      the subject, the body, or a token-shaped value. Only the domain and a
 *      keyed hash describe the recipient;
 *   3. the provider message id is persisted to `email_sends` so webhook events
 *      can be joined back; a bookkeeping failure never changes the verdict;
 *   4. skips (`logEmailSkipped`) complete the outcome series without a send.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  send: vi.fn(),
  elevatedQuery: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}));

vi.mock("resend", () => ({ Resend: class { emails = { send: h.send }; } }));
vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn() },
  pgElevated: { query: h.elevatedQuery }
}));
vi.mock("../infra/logger.js", () => ({
  logger: { info: h.info, warn: h.warn, error: h.error, debug: h.debug }
}));

import {
  sendViaProvider,
  logEmailSkipped,
  recipientDomain,
  recipientHash,
  sanitizeProviderText
} from "../infra/emailTransport.js";

const TO = "alice.customer@acme-corp.example";
const SUBJECT = "Intelligence Brief: Jul 1 – Jul 7, 2026 SECRET-SUBJECT";
const HTML = "<p>BODY-MARKER https://app.example/verify?token=tok_abc123SECRET</p>";
const ORG = "22222222-2222-4222-8222-222222222222";
const BRIEF = "11111111-1111-4111-8111-111111111111";

/** Every line emitted so far, serialised the way a log shipper would see it. */
function allLines(): string[] {
  const calls = [...h.info.mock.calls, ...h.warn.mock.calls, ...h.error.mock.calls, ...h.debug.mock.calls];
  return calls.map((c) => JSON.stringify(c[0]) + " " + String(c[1] ?? ""));
}
function linesFor(event: string): Array<Record<string, unknown>> {
  return [...h.info.mock.calls, ...h.warn.mock.calls]
    .map((c) => c[0] as Record<string, unknown>)
    .filter((o) => o && o.event === event);
}
function assertPrivate(lines: string[]): void {
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    expect(line).not.toContain(TO);
    expect(line).not.toContain("alice.customer");
    expect(line).not.toContain("SECRET-SUBJECT");
    expect(line).not.toContain("BODY-MARKER");
    expect(line).not.toContain("tok_abc123SECRET");
    expect(line).not.toContain("Intelligence Brief:");
  }
}

const ORIGINAL = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  h.elevatedQuery.mockResolvedValue({ rows: [], rowCount: 1 });
  process.env.RESEND_API_KEY = "re_test";
  process.env.APP_ENV = "staging";
  process.env.RESEND_WEBHOOK_SECRET = "whsec_test_key";
});
afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("sendViaProvider — outcome truthfulness", () => {
  it("accepted: logs attempt + result with the provider message id and persists the join row", async () => {
    h.send.mockResolvedValueOnce({ data: { id: "msg-123" }, error: null });

    const r = await sendViaProvider({
      purpose: "brief.weekly", orgId: ORG, correlationId: BRIEF,
      to: TO, from: "SecureLogic AI <briefs@securelogicai.com>", subject: SUBJECT, html: HTML
    });

    expect(r).toMatchObject({ ok: true, outcome: "accepted", providerMessageId: "msg-123" });
    expect(h.send).toHaveBeenCalledTimes(1);
    // The environment tag is applied by the transport, not the call site.
    expect(h.send.mock.calls[0]![0]).toMatchObject({
      to: TO,
      tags: [{ name: "environment", value: "staging" }]
    });

    const attempt = linesFor("email_send_attempt");
    const result = linesFor("email_send_result");
    expect(attempt).toHaveLength(1);
    expect(result).toHaveLength(1);
    expect(attempt[0]).toMatchObject({
      purpose: "brief.weekly", orgId: ORG, correlationId: BRIEF, environment: "staging",
      recipientDomain: "acme-corp.example", provider: "resend"
    });
    expect(attempt[0]!.sendId).toBe(result[0]!.sendId);
    expect(result[0]).toMatchObject({ outcome: "accepted", providerMessageId: "msg-123" });
    expect(typeof result[0]!.durationMs).toBe("number");

    // Persisted: provider message id → (purpose, org, correlation, outcome).
    expect(h.elevatedQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = h.elevatedQuery.mock.calls[0]!;
    expect(sql).toContain("INSERT INTO email_sends");
    expect(params).toEqual(expect.arrayContaining([r.sendId, "resend", "msg-123", "brief.weekly", ORG, BRIEF, "staging", "acme-corp.example", "accepted"]));
    expect(params).not.toContain(TO);
  });

  it("provider_rejected: the SDK's resolved { error } is NOT reported as sent", async () => {
    h.send.mockResolvedValueOnce({
      data: null,
      error: { name: "validation_error", message: `The ${TO} address is not verified`, statusCode: 403 }
    });

    const r = await sendViaProvider({ purpose: "auth.verification", to: TO, from: "x@securelogicai.com", subject: SUBJECT, html: HTML });

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.outcome).toBe("provider_rejected");
    expect(r.errorName).toBe("validation_error");
    expect(r.statusCode).toBe(403);
    // The provider's free text had the address in it — it is redacted before
    // it reaches the result, the log, or the table.
    expect(r.errorMessage).not.toContain(TO);
    expect(r.errorMessage).toContain("[email]");

    const result = linesFor("email_send_result")[0]!;
    expect(result).toMatchObject({ outcome: "provider_rejected", providerErrorName: "validation_error", providerStatusCode: 403, providerMessageId: null });
    expect(h.warn).toHaveBeenCalled();

    const params = h.elevatedQuery.mock.calls[0]![1] as unknown[];
    expect(params).toContain("provider_rejected");
    expect(params).toContain("validation_error");
  });

  it("error: an SDK throw is an `error` outcome, never a throw out of the transport", async () => {
    h.send.mockRejectedValueOnce(new Error("ECONNRESET"));
    const r = await sendViaProvider({ purpose: "team.invite", to: TO, from: "x@securelogicai.com", subject: SUBJECT, html: HTML });
    expect(r).toMatchObject({ ok: false, outcome: "error", errorMessage: "ECONNRESET" });
    expect(linesFor("email_send_result")[0]).toMatchObject({ outcome: "error" });
  });

  it("skipped_unconfigured: no key → no provider call, one result line", async () => {
    delete process.env.RESEND_API_KEY;
    const r = await sendViaProvider({ purpose: "x", to: TO, from: "x@securelogicai.com", subject: SUBJECT, html: HTML });
    expect(r).toMatchObject({ ok: false, outcome: "skipped_unconfigured" });
    expect(h.send).not.toHaveBeenCalled();
    expect(linesFor("email_send_attempt")).toHaveLength(0);
    expect(linesFor("email_send_result")[0]).toMatchObject({ outcome: "skipped_unconfigured" });
    expect(h.elevatedQuery).not.toHaveBeenCalled();
  });

  it("a bookkeeping failure never changes an accepted verdict", async () => {
    h.send.mockResolvedValueOnce({ data: { id: "msg-9" }, error: null });
    h.elevatedQuery.mockRejectedValueOnce(new Error("relation email_sends does not exist"));
    const r = await sendViaProvider({ purpose: "x", to: TO, from: "x@securelogicai.com", subject: SUBJECT, html: HTML });
    expect(r).toMatchObject({ ok: true, outcome: "accepted", providerMessageId: "msg-9" });
    expect(linesFor("email_send_record_failed")).toHaveLength(1);
  });

  it("uses an injected client (sites that own one keep their mocks)", async () => {
    const injected = { emails: { send: vi.fn(async () => ({ data: { id: "inj-1" }, error: null })) } };
    const r = await sendViaProvider({ client: injected, purpose: "alert.daily_digest", to: TO, from: "x@securelogicai.com", subject: SUBJECT, html: HTML });
    expect(r).toMatchObject({ ok: true, providerMessageId: "inj-1" });
    expect(injected.emails.send).toHaveBeenCalledTimes(1);
    expect(h.send).not.toHaveBeenCalled();
  });
});

describe("logEmailSkipped", () => {
  it("suppressed: emits a result line with outcome=suppressed and no provider call", () => {
    logEmailSkipped({ purpose: "brief.weekly", orgId: ORG, correlationId: BRIEF, to: TO, outcome: "suppressed", reason: "email_suppressions" });
    const line = linesFor("email_send_result")[0]!;
    expect(line).toMatchObject({ outcome: "suppressed", purpose: "brief.weekly", orgId: ORG, correlationId: BRIEF, reason: "email_suppressions", recipientDomain: "acme-corp.example", providerMessageId: null });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.elevatedQuery).not.toHaveBeenCalled();
  });
});

describe("PRIVACY — no line carries the address, subject, body or token", () => {
  it("accepted path", async () => {
    h.send.mockResolvedValueOnce({ data: { id: "m" }, error: null });
    await sendViaProvider({ purpose: "brief.weekly", orgId: ORG, correlationId: BRIEF, to: TO, from: "x@securelogicai.com", subject: SUBJECT, html: HTML });
    assertPrivate(allLines());
  });
  it("rejected path, even when the provider's error text quotes the address", async () => {
    h.send.mockResolvedValueOnce({ data: null, error: { name: "validation_error", message: `Invalid to: ${TO}`, statusCode: 422 } });
    await sendViaProvider({ purpose: "brief.weekly", to: TO, from: "x@securelogicai.com", subject: SUBJECT, html: HTML });
    assertPrivate(allLines());
  });
  it("thrown path, even when the thrown message quotes the address", async () => {
    h.send.mockRejectedValueOnce(new Error(`timeout sending to ${TO}`));
    await sendViaProvider({ purpose: "brief.weekly", to: TO, from: "x@securelogicai.com", subject: SUBJECT, html: HTML });
    assertPrivate(allLines());
  });
  it("skip path", () => {
    logEmailSkipped({ purpose: "brief.weekly", to: TO, outcome: "suppressed" });
    assertPrivate(allLines());
  });
  it("the persisted row carries no address either", async () => {
    h.send.mockResolvedValueOnce({ data: { id: "m" }, error: null });
    await sendViaProvider({ purpose: "brief.weekly", to: TO, from: "x@securelogicai.com", subject: SUBJECT, html: HTML });
    const params = JSON.stringify(h.elevatedQuery.mock.calls[0]![1]);
    expect(params).not.toContain(TO);
    expect(params).not.toContain("SECRET-SUBJECT");
    expect(params).not.toContain("BODY-MARKER");
  });
});

describe("recipient description", () => {
  it("domain is lowercased; hash is keyed, stable and truncated; no key → no hash", () => {
    expect(recipientDomain("Alice@Example.COM")).toBe("example.com");
    expect(recipientDomain("not-an-address")).toBeNull();
    const a = recipientHash("Alice@Example.COM");
    const b = recipientHash("alice@example.com");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    delete process.env.RESEND_WEBHOOK_SECRET;
    delete process.env.EMAIL_RECIPIENT_HASH_KEY;
    expect(recipientHash("alice@example.com")).toBeNull();
  });
  it("EMAIL_RECIPIENT_HASH_KEY takes precedence over the webhook secret", () => {
    const viaSecret = recipientHash("alice@example.com");
    process.env.EMAIL_RECIPIENT_HASH_KEY = "another-key";
    expect(recipientHash("alice@example.com")).not.toBe(viaSecret);
  });
  it("sanitizeProviderText redacts addresses and bounds length", () => {
    expect(sanitizeProviderText(`bad: ${TO} and bob@x.io`)).toBe("bad: [email] and [email]");
    expect(sanitizeProviderText("x".repeat(500))).toHaveLength(200);
    expect(sanitizeProviderText(undefined)).toBe("");
  });
});
