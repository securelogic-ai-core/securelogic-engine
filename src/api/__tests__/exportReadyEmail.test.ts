import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockSendEmail } = vi.hoisted(() => ({ mockSendEmail: vi.fn() }));
vi.mock("../infra/email.js", () => ({ sendEmail: mockSendEmail }));
vi.mock("../infra/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  exportEmailEnabled,
  buildExportDownloadUrl,
  buildExportReadyEmail,
  sendExportReadyEmail
} from "../lib/exportReadyEmail.js";

const FLAG = "SECURELOGIC_EXPORT_EMAIL_ENABLED";
const EXP = new Date("2026-07-01T00:00:00.000Z");

beforeEach(() => { mockSendEmail.mockReset(); });
afterEach(() => { delete process.env[FLAG]; delete process.env["DATA_EXPORT_DOWNLOAD_BASE_URL"]; delete process.env["APP_BASE_URL"]; });

describe("exportEmailEnabled", () => {
  it("off by default, on only for 'true'", () => {
    expect(exportEmailEnabled({})).toBe(false);
    expect(exportEmailEnabled({ [FLAG]: "true" })).toBe(true);
    expect(exportEmailEnabled({ [FLAG]: "1" })).toBe(false);
  });
});

describe("buildExportDownloadUrl", () => {
  it("builds the tokenized public download route on the configured base", () => {
    const url = buildExportDownloadUrl("tok-123", { DATA_EXPORT_DOWNLOAD_BASE_URL: "https://app.example.com/" });
    expect(url).toBe("https://app.example.com/api/data-exports/download?token=tok-123");
  });
  it("url-encodes the token and falls back to the default base", () => {
    const url = buildExportDownloadUrl("a/b+c", {});
    expect(url).toContain("/api/data-exports/download?token=a%2Fb%2Bc");
  });
});

describe("buildExportReadyEmail", () => {
  it("includes the download link and an expiry date", () => {
    const m = buildExportReadyEmail("https://x/api/data-exports/download?token=t", EXP);
    expect(m.subject).toMatch(/export is ready/i);
    expect(m.html).toContain("https://x/api/data-exports/download?token=t");
    expect(m.html).toContain("2026-07-01");
    expect(m.text).toContain("2026-07-01");
  });
});

describe("sendExportReadyEmail", () => {
  it("disabled (flag off) → no sendEmail call", async () => {
    const r = await sendExportReadyEmail({ to: "u@x.com", rawToken: "t", expiresAt: EXP });
    expect(r).toEqual({ ok: false, reason: "unavailable", detail: "export email disabled" });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("enabled → calls sendEmail with the export subject + recipient", async () => {
    process.env[FLAG] = "true";
    mockSendEmail.mockResolvedValueOnce({ ok: true, id: "m1" });
    const r = await sendExportReadyEmail({ to: "u@x.com", rawToken: "tok", expiresAt: EXP });
    expect(r).toEqual({ ok: true, id: "m1" });
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const arg = mockSendEmail.mock.calls[0]![0];
    expect(arg.to).toBe("u@x.com");
    expect(arg.subject).toMatch(/export is ready/i);
    expect(arg.html).toContain("token=tok");
  });

  it("enabled but missing recipient/token → failed, no send", async () => {
    process.env[FLAG] = "true";
    const r = await sendExportReadyEmail({ to: "", rawToken: "t", expiresAt: EXP });
    expect(r).toEqual({ ok: false, reason: "failed", detail: "missing recipient/token" });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("never throws when sendEmail rejects", async () => {
    process.env[FLAG] = "true";
    mockSendEmail.mockRejectedValueOnce(new Error("boom"));
    const r = await sendExportReadyEmail({ to: "u@x.com", rawToken: "t", expiresAt: EXP });
    expect(r.ok).toBe(false);
  });
});
