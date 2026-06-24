import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockSend, mockQuery } = vi.hoisted(() => ({ mockSend: vi.fn(), mockQuery: vi.fn() }));

vi.mock("resend", () => ({ Resend: class { emails = { send: mockSend }; } }));
vi.mock("../infra/postgres.js", () => ({ pg: { query: mockQuery } }));
vi.mock("../infra/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { sendEmail } from "../infra/email.js";

const KEY = "RESEND_API_KEY";

beforeEach(() => {
  mockSend.mockReset();
  mockQuery.mockReset().mockResolvedValue({ rows: [] }); // not suppressed by default
  process.env[KEY] = "re_test";
});
afterEach(() => { delete process.env[KEY]; });

describe("sendEmail", () => {
  it("returns unavailable when RESEND_API_KEY is not set", async () => {
    delete process.env[KEY];
    const r = await sendEmail({ to: "a@b.com", subject: "s", html: "<p>x</p>" });
    expect(r).toEqual({ ok: false, reason: "unavailable", detail: "RESEND_API_KEY not set" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("skips a suppressed recipient (no send)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "sup-1" }] });
    const r = await sendEmail({ to: "blocked@b.com", subject: "s", html: "<p>x</p>" });
    expect(r).toEqual({ ok: false, reason: "suppressed" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends and returns the provider id on success", async () => {
    mockSend.mockResolvedValueOnce({ data: { id: "msg-123" } });
    const r = await sendEmail({ to: "a@b.com", subject: "Your export is ready", html: "<p>link</p>" });
    expect(r).toEqual({ ok: true, id: "msg-123" });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0]![0]).toMatchObject({ to: "a@b.com", subject: "Your export is ready" });
  });

  it("returns failed (never throws) when the provider errors", async () => {
    mockSend.mockRejectedValueOnce(new Error("rate limited"));
    const r = await sendEmail({ to: "a@b.com", subject: "s", html: "<p>x</p>" });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toBe("failed"); expect(r.detail).toContain("rate limited"); }
  });

  it("fails open on a suppression-check DB error (still sends)", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    mockSend.mockResolvedValueOnce({ data: { id: "msg-9" } });
    const r = await sendEmail({ to: "a@b.com", subject: "s", html: "<p>x</p>" });
    expect(r).toEqual({ ok: true, id: "msg-9" });
  });

  it("rejects an empty recipient", async () => {
    const r = await sendEmail({ to: "  ", subject: "s", html: "<p>x</p>" });
    expect(r).toEqual({ ok: false, reason: "failed", detail: "missing recipient" });
  });
});
