/**
 * alertingWebhookFormat.test.ts — Slack/Discord webhook format selection.
 *
 * `ALERT_WEBHOOK_URL` may point at a Slack incoming webhook or a Discord
 * channel webhook. The alert functions build one internal embed structure
 * and serialize it to whichever shape the host accepts — Slack rejects a
 * Discord `{embeds}` body with HTTP 400. These tests pin:
 *   1. `detectWebhookFormat()` host → format mapping (incl. the Slack default).
 *   2. The wire shape actually POSTed for each target.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  detectWebhookFormat,
  buildWebhookBody,
  sendSecurityAlert
} from "../infra/alerting.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// detectWebhookFormat — host → format
// ---------------------------------------------------------------------------

describe("detectWebhookFormat", () => {
  it("maps hooks.slack.com to slack", () => {
    expect(detectWebhookFormat("https://hooks.slack.com/services/T0/B0/xyz")).toBe("slack");
  });

  it("maps discord.com and discordapp.com (and subdomains) to discord", () => {
    expect(detectWebhookFormat("https://discord.com/api/webhooks/123/abc")).toBe("discord");
    expect(detectWebhookFormat("https://discordapp.com/api/webhooks/123/abc")).toBe("discord");
    expect(detectWebhookFormat("https://ptb.discord.com/api/webhooks/123/abc")).toBe("discord");
  });

  it("defaults unknown hosts to slack (most common target)", () => {
    expect(detectWebhookFormat("https://example.com/hook")).toBe("slack");
    expect(detectWebhookFormat("https://mattermost.internal/hooks/abc")).toBe("slack");
  });

  it("defaults an unparseable URL to slack rather than throwing", () => {
    expect(detectWebhookFormat("not-a-url")).toBe("slack");
    expect(detectWebhookFormat("")).toBe("slack");
  });
});

// ---------------------------------------------------------------------------
// buildWebhookBody — payload shape per target
// ---------------------------------------------------------------------------

describe("buildWebhookBody", () => {
  const embed = {
    title: "🔒 Account locked",
    description: "5 failed logins",
    color: 0xcc0000,
    fields: [
      { name: "Kind", value: "account_locked", inline: true },
      { name: "ip", value: "1.2.3.4", inline: true }
    ],
    footer: { text: "securelogic-engine · security_alert" }
  };

  it("emits a Discord {embeds:[...]} body for a Discord URL (unchanged)", () => {
    const body = buildWebhookBody("https://discord.com/api/webhooks/1/a", embed);
    expect(body).toEqual({ embeds: [embed] });
  });

  it("emits a Slack {text, blocks} body for a Slack URL", () => {
    const body = buildWebhookBody("https://hooks.slack.com/services/T/B/x", embed) as {
      text: string;
      blocks: Array<{ type: string; text?: { type: string; text: string }; fields?: Array<{ type: string; text: string }> }>;
    };

    // No Discord shape leaks through.
    expect("embeds" in body).toBe(false);

    // Fallback notification text is present.
    expect(typeof body.text).toBe("string");
    expect(body.text.length).toBeGreaterThan(0);
    expect(body.text).toContain("Account locked");

    // header block carries the title as plain_text.
    const header = body.blocks.find((b) => b.type === "header")!;
    expect(header.text!.type).toBe("plain_text");
    expect(header.text!.text).toContain("Account locked");

    // description renders as a mrkdwn section.
    const descSection = body.blocks.find(
      (b) => b.type === "section" && b.text?.type === "mrkdwn"
    )!;
    expect(descSection.text!.text).toBe("5 failed logins");

    // fields are mapped into a section `fields` array as *name*\nvalue mrkdwn.
    const fieldSection = body.blocks.find((b) => b.type === "section" && Array.isArray(b.fields))!;
    const fieldTexts = fieldSection.fields!.map((f) => f.text);
    expect(fieldSection.fields!.every((f) => f.type === "mrkdwn")).toBe(true);
    expect(fieldTexts).toContain("*Kind*\naccount_locked");
    expect(fieldTexts).toContain("*ip*\n1.2.3.4");
  });

  it("defaults a non-Slack, non-Discord URL to the Slack shape", () => {
    const body = buildWebhookBody("https://example.com/hook", embed);
    expect("blocks" in body).toBe(true);
    expect("embeds" in body).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: sendSecurityAlert posts the right shape for the configured host
// ---------------------------------------------------------------------------

describe("sendSecurityAlert wire shape per ALERT_WEBHOOK_URL host", () => {
  it("POSTs Slack blocks (not Discord embeds) to a hooks.slack.com URL", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/x");
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchSpy);

    await sendSecurityAlert({
      kind: "account_locked",
      summary: "5 failed logins",
      detail: { ip: "1.2.3.4", account: "a@b.com" }
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.slack.com/services/T/B/x");

    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect("blocks" in body).toBe(true);
    expect("embeds" in body).toBe(false);
    expect(Array.isArray(body.blocks)).toBe(true);
    expect(typeof body.text).toBe("string");
  });

  it("still POSTs Discord embeds to a discord.com URL", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://discord.com/api/webhooks/123/abc");
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchSpy);

    await sendSecurityAlert({ kind: "account_locked", summary: "x" });

    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect("embeds" in body).toBe(true);
    expect("blocks" in body).toBe(false);
  });
});
