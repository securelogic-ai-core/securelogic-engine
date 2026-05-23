/**
 * alerting.test.ts — sendFailureAlert + sendSecurityAlert (A04-G4/A09-G2).
 *
 * Both functions emit a Discord-compatible `{embeds: [...]}` payload to the
 * `ALERT_WEBHOOK_URL` channel. Title prefix + embed color encode the kind
 * so operators can distinguish auth-anomaly / quota / worker-failure
 * messages at a glance in the destination channel.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { sendFailureAlert, sendSecurityAlert } from "../infra/alerting.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// sendSecurityAlert
// ---------------------------------------------------------------------------

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

  it("POSTs a Discord embeds payload when the webhook is set", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://discord.com/api/webhooks/123/abc");
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchSpy);

    await sendSecurityAlert({
      kind: "credential_stuffing",
      summary: "burst from one IP",
      detail: { ip: "1.2.3.4", distinct_accounts: 12 }
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://discord.com/api/webhooks/123/abc");
    expect(opts.method).toBe("POST");
    expect((opts.headers as Record<string, string>)["Content-Type"]).toBe("application/json");

    const body = JSON.parse(opts.body as string) as { embeds: unknown[] };
    expect(Array.isArray(body.embeds)).toBe(true);
    expect(body.embeds).toHaveLength(1);
  });

  it("encodes severity via embed color + title prefix per kind", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://discord.com/api/webhooks/123/abc");

    const cases: Array<{
      kind: "account_locked" | "credential_stuffing" | "api_key_probing" | "provider_quota_exhausted";
      emoji: string;
      color: number;
    }> = [
      { kind: "account_locked",           emoji: "🔒", color: 0xCC0000 },
      { kind: "credential_stuffing",      emoji: "🚨", color: 0xCC0000 },
      { kind: "api_key_probing",          emoji: "🔑", color: 0xCC0000 },
      { kind: "provider_quota_exhausted", emoji: "💸", color: 0xFF9900 }
    ];

    for (const c of cases) {
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 204 });
      vi.stubGlobal("fetch", fetchSpy);

      await sendSecurityAlert({ kind: c.kind, summary: "test" });

      const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(opts.body as string) as {
        embeds: Array<{ title: string; color: number; footer?: { text: string } }>;
      };
      expect(body.embeds[0]!.title.startsWith(c.emoji)).toBe(true);
      expect(body.embeds[0]!.color).toBe(c.color);
      expect(body.embeds[0]!.footer?.text).toBe("securelogic-engine · security_alert");
    }
  });

  it("populates structured embed fields from detail{} (inline, with Kind + Timestamp first)", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://discord.com/api/webhooks/123/abc");
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchSpy);

    await sendSecurityAlert({
      kind: "api_key_probing",
      summary: "burst from one IP",
      detail: { ip: "9.9.9.9", invalid_key_hits: 25, window_minutes: 15 }
    });

    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as {
      embeds: Array<{
        title: string;
        description: string;
        fields: Array<{ name: string; value: string; inline?: boolean }>;
      }>;
    };
    const embed = body.embeds[0]!;
    expect(embed.title).toBe("🔑 API key probing");
    expect(embed.description).toBe("burst from one IP");

    const fieldNames = embed.fields.map((f) => f.name);
    expect(fieldNames[0]).toBe("Kind");
    expect(fieldNames[1]).toBe("Timestamp");
    expect(fieldNames).toContain("ip");
    expect(fieldNames).toContain("invalid_key_hits");

    const ipField = embed.fields.find((f) => f.name === "ip")!;
    expect(ipField.value).toBe("9.9.9.9");
    expect(ipField.inline).toBe(true);

    const hitsField = embed.fields.find((f) => f.name === "invalid_key_hits")!;
    expect(hitsField.value).toBe("25");
  });

  it("skips undefined / null detail values rather than emitting empty fields", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://discord.com/api/webhooks/123/abc");
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchSpy);

    await sendSecurityAlert({
      kind: "provider_quota_exhausted",
      summary: "anthropic out",
      detail: { provider: "anthropic", kind: "credit_balance", message: undefined, otherwise_null: null }
    });

    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as {
      embeds: Array<{ fields: Array<{ name: string }> }>;
    };
    const fieldNames = body.embeds[0]!.fields.map((f) => f.name);
    expect(fieldNames).not.toContain("message");
    expect(fieldNames).not.toContain("otherwise_null");
    expect(fieldNames).toContain("provider");
    expect(fieldNames).toContain("kind");
  });

  it("throws when the webhook responds non-2xx", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://discord.com/api/webhooks/123/abc");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    await expect(
      sendSecurityAlert({ kind: "api_key_probing", summary: "x" })
    ).rejects.toThrow(/status 500/);
  });
});

// ---------------------------------------------------------------------------
// sendFailureAlert
// ---------------------------------------------------------------------------

describe("sendFailureAlert", () => {
  it("is a no-op (no fetch) when ALERT_WEBHOOK_URL is unset", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(sendFailureAlert("intelligence-worker", "any")).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs a Discord embeds payload with worker-failure title + yellow color", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://discord.com/api/webhooks/123/abc");
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchSpy);

    await sendFailureAlert("intelligence-worker", "Anthropic 401: invalid api key");

    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as {
      embeds: Array<{
        title: string;
        description: string;
        color: number;
        fields: Array<{ name: string; value: string }>;
        footer?: { text: string };
      }>;
    };

    const embed = body.embeds[0]!;
    expect(embed.title).toBe("⚠️ Worker failure: intelligence-worker");
    expect(embed.color).toBe(0xFFCC00);
    expect(embed.description).toContain("Anthropic 401: invalid api key");
    expect(embed.footer?.text).toBe("securelogic-engine · worker_failure");

    const fieldNames = embed.fields.map((f) => f.name);
    expect(fieldNames).toContain("Worker");
    expect(fieldNames).toContain("Timestamp");
  });

  it("throws when the webhook responds non-2xx", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://discord.com/api/webhooks/123/abc");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    await expect(sendFailureAlert("w", "boom")).rejects.toThrow(/status 500/);
  });
});
