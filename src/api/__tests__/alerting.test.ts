/**
 * alerting.test.ts — sendSecurityAlert (A04-G4/A09-G2).
 *
 * sendSecurityAlert shares the ALERT_WEBHOOK_URL channel with sendFailureAlert
 * but emits a distinct `type: "security_alert"` payload.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { sendSecurityAlert } from "../infra/alerting.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("sendSecurityAlert", () => {
  it("is a no-op (no fetch) when ALERT_WEBHOOK_URL is unset", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      sendSecurityAlert({ kind: "account_locked", summary: "x" })
    ).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs a security_alert payload when the webhook is set", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://hooks.example/abc");
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchSpy);

    await sendSecurityAlert({
      kind: "credential_stuffing",
      summary: "burst from one IP",
      detail: { ip: "1.2.3.4", distinct_accounts: 12 }
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.example/abc");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "security_alert",
      kind: "credential_stuffing",
      summary: "burst from one IP",
      detail: { ip: "1.2.3.4", distinct_accounts: 12 }
    });
    expect(typeof body["timestamp"]).toBe("string");
  });

  it("throws when the webhook responds non-2xx", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://hooks.example/abc");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    await expect(
      sendSecurityAlert({ kind: "api_key_probing", summary: "x" })
    ).rejects.toThrow(/status 500/);
  });
});
