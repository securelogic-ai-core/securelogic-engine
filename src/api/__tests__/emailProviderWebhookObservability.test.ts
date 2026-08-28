/**
 * emailProviderWebhookObservability.test.ts — EMAIL-OBS-1, the receive side.
 *
 * Every inbound provider event emits ONE `email_provider_event` line that
 * joins the provider's message id back to the send that produced it
 * (`email_sends`, written by the transport). Pinned here:
 *   1. matched → purpose / org / correlation / sendId on the line, unmatched:false;
 *   2. no matching send → unmatched:true, event still processed and stored;
 *   3. a join lookup failure → unmatched:true + joinError, still processed;
 *   4. bounce reason fields are surfaced, with any address redacted;
 *   5. the provider message id is written to `email_provider_events`;
 *   6. PRIVACY — the line carries domain + hash, never the address.
 *
 * Signature verification is mocked to pass; it runs first and is pinned by
 * its own suite.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

const h = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}));

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn() },
  pgElevated: { connect: vi.fn(async () => ({ query: h.query, release: h.release })) }
}));
vi.mock("../infra/logger.js", () => ({
  logger: { info: h.info, warn: h.warn, error: h.error, debug: h.debug }
}));
vi.mock("../infra/verifyWebhookSignature.js", () => ({ verifyWebhookSignature: () => true }));

import router, { readProviderMessageId, readEventReason } from "../routes/emailProviderWebhook.js";

const TO = "alice.customer@acme-corp.example";
const ORG = "22222222-2222-4222-8222-222222222222";
const BRIEF = "11111111-1111-4111-8111-111111111111";
const SEND_ID = "33333333-3333-4333-8333-333333333333";
const MSG = "56761188-7520-42d8-8898-ff6fc54ce618";

function app() {
  const a = express();
  a.use(express.json({ verify: (req, _res, buf) => { (req as { rawBody?: string }).rawBody = buf.toString("utf8"); } }));
  a.use(router);
  return a;
}

function post(body: unknown) {
  return request(app())
    .post("/webhooks/email/resend")
    .set("svix-id", "evt_1")
    .set("svix-timestamp", "1")
    .set("svix-signature", "v1,sig")
    .send(body as object);
}

function providerEventLines(): Array<Record<string, unknown>> {
  return [...h.info.mock.calls, ...h.warn.mock.calls]
    .map((c) => c[0] as Record<string, unknown>)
    .filter((o) => o && o.event === "email_provider_event");
}

/** Default DB script: join returns `joinRows`; everything else succeeds. */
function scriptDb(joinRows: unknown[], opts: { joinThrows?: boolean } = {}) {
  h.query.mockImplementation(async (sql: string) => {
    if (/FROM email_sends/.test(sql)) {
      if (opts.joinThrows) throw new Error("relation email_sends does not exist");
      return { rows: joinRows, rowCount: joinRows.length };
    }
    if (/INSERT INTO email_provider_events/.test(sql)) return { rows: [{ id: "row-1" }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
}

const ORIGINAL = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env.APP_ENV = "staging";
  process.env.RESEND_WEBHOOK_SECRET = "whsec_test";
});
afterEach(() => { process.env = { ...ORIGINAL }; });

const bounced = {
  type: "email.bounced",
  created_at: "2026-08-28T10:00:00Z",
  data: {
    email_id: MSG,
    to: [TO],
    subject: "Intelligence Brief: Jul 1 – Jul 7 SECRET-SUBJECT",
    tags: { environment: "staging" },
    bounce: { type: "Permanent", subType: "General", message: `Mailbox ${TO} does not exist` }
  }
};

describe("email_provider_event — join to the originating send", () => {
  it("matched: carries purpose / org / correlation / sendId from email_sends", async () => {
    scriptDb([{ id: SEND_ID, purpose: "brief.weekly", organization_id: ORG, correlation_id: BRIEF, created_at: "2026-08-28T09:59:00Z" }]);

    const res = await post(bounced);
    expect(res.status).toBe(200);

    const lines = providerEventLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      eventType: "email.bounced",
      providerMessageId: MSG,
      unmatched: false,
      sendId: SEND_ID,
      purpose: "brief.weekly",
      orgId: ORG,
      correlationId: BRIEF,
      environmentClassification: "match",
      recipientDomain: "acme-corp.example",
      bounceType: "Permanent",
      bounceSubType: "General"
    });
    expect(typeof lines[0]!.recipientHash).toBe("string");
    // A delivery problem is a warn, so it is visible at the default level.
    expect(h.warn.mock.calls.some((c) => (c[0] as { event?: string }).event === "email_provider_event")).toBe(true);

    // The join query used the provider + message id, and the event row stores the id.
    const joinCall = h.query.mock.calls.find((c) => /FROM email_sends/.test(c[0] as string))!;
    expect(joinCall[1]).toEqual(["resend", MSG]);
    const insertCall = h.query.mock.calls.find((c) => /INSERT INTO email_provider_events/.test(c[0] as string))!;
    expect(insertCall[0]).toContain("provider_message_id");
    expect(insertCall[1]).toContain(MSG);
  });

  it("unmatched: no send row → unmatched:true, event still stored and processed", async () => {
    scriptDb([]);
    const res = await post({ ...bounced, type: "email.delivered", data: { ...bounced.data, bounce: undefined } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, duplicate: false });
    const line = providerEventLines()[0]!;
    expect(line).toMatchObject({ unmatched: true, sendId: null, purpose: null, orgId: null, correlationId: null, eventType: "email.delivered" });
    expect(line).not.toHaveProperty("joinError");
    // Delivered is informational.
    expect(h.info.mock.calls.some((c) => (c[0] as { event?: string }).event === "email_provider_event")).toBe(true);
    expect(h.query.mock.calls.some((c) => /INSERT INTO email_provider_events/.test(c[0] as string))).toBe(true);
    expect(h.query.mock.calls.some((c) => c[0] === "COMMIT")).toBe(true);
  });

  it("join failure: unmatched:true with joinError, and the event is STILL processed", async () => {
    scriptDb([], { joinThrows: true });
    const res = await post(bounced);
    expect(res.status).toBe(200);
    const line = providerEventLines()[0]!;
    expect(line).toMatchObject({ unmatched: true });
    expect(String(line.joinError)).toContain("email_sends");
    // Bounce → suppression still written.
    expect(h.query.mock.calls.some((c) => /INSERT INTO email_suppressions/.test(c[0] as string))).toBe(true);
    expect(h.query.mock.calls.some((c) => c[0] === "COMMIT")).toBe(true);
  });

  it("an event without a message id skips the join and reports unmatched", async () => {
    scriptDb([]);
    await post({ type: "email.sent", data: { to: [TO] } });
    expect(h.query.mock.calls.some((c) => /FROM email_sends/.test(c[0] as string))).toBe(false);
    expect(providerEventLines()[0]).toMatchObject({ unmatched: true, providerMessageId: null });
  });
});

describe("PRIVACY — the provider-event line never carries the address, subject or body", () => {
  it("bounced with an address quoted in the provider's bounce message", async () => {
    scriptDb([{ id: SEND_ID, purpose: "brief.weekly", organization_id: ORG, correlation_id: BRIEF, created_at: "x" }]);
    await post(bounced);
    const serialised = [...h.info.mock.calls, ...h.warn.mock.calls, ...h.debug.mock.calls]
      .map((c) => JSON.stringify(c[0]) + String(c[1] ?? ""));
    expect(serialised.length).toBeGreaterThan(0);
    for (const s of serialised) {
      expect(s).not.toContain(TO);
      expect(s).not.toContain("alice.customer");
      expect(s).not.toContain("SECRET-SUBJECT");
    }
    const line = providerEventLines()[0]!;
    expect(line.reason).toBe("Mailbox [email] does not exist");
  });
});

describe("payload readers", () => {
  it("readProviderMessageId prefers data.email_id, accepts the legacy data.id, else null", () => {
    expect(readProviderMessageId({ data: { email_id: " m1 " } })).toBe("m1");
    expect(readProviderMessageId({ data: { id: "m2" } })).toBe("m2");
    expect(readProviderMessageId({ data: { email_id: "m1", id: "m2" } })).toBe("m1");
    expect(readProviderMessageId({ data: {} })).toBeNull();
    expect(readProviderMessageId(null)).toBeNull();
    expect(readProviderMessageId({ data: { email_id: 42 } })).toBeNull();
  });

  it("readEventReason surfaces bounce type/subType/message (redacted) or a top-level reason", () => {
    expect(readEventReason({ data: { bounce: { type: "Transient", subType: "MailboxFull", message: `full: ${TO}` } } }))
      .toEqual({ bounceType: "Transient", bounceSubType: "MailboxFull", reason: "full: [email]" });
    expect(readEventReason({ data: { reason: "greylisted" } })).toEqual({ bounceType: null, bounceSubType: null, reason: "greylisted" });
    expect(readEventReason({ data: {} })).toEqual({ bounceType: null, bounceSubType: null, reason: null });
  });
});
