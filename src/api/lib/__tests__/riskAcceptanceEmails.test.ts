/**
 * riskAcceptanceEmails.test.ts — the notification CONTENT + flag gate, DB- and mail-free.
 *
 * Recipient resolution and delivery (riskAcceptanceNotifier.ts) are exercised in staging;
 * these pin the honest subject/body, HTML escaping, and separation-of-duties wording, plus
 * the flag gate that keeps production silent.
 */

import { describe, expect, it } from "vitest";

import {
  buildAcceptanceProposedEmail,
  buildAcceptanceDecidedEmail,
  buildFindingUrl,
  riskAcceptanceNotificationsEnabled,
} from "../riskAcceptanceEmails.js";

const ON = { SECURELOGIC_RISK_ACCEPTANCE_NOTIFICATIONS_ENABLED: "true" } as unknown as NodeJS.ProcessEnv;

describe("riskAcceptanceNotificationsEnabled", () => {
  it("is off unless the flag is exactly 'true' (production posture is silent)", () => {
    expect(riskAcceptanceNotificationsEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(
      riskAcceptanceNotificationsEnabled({ SECURELOGIC_RISK_ACCEPTANCE_NOTIFICATIONS_ENABLED: "false" } as unknown as NodeJS.ProcessEnv)
    ).toBe(false);
    expect(riskAcceptanceNotificationsEnabled(ON)).toBe(true);
  });
});

describe("buildFindingUrl", () => {
  it("uses APP_BASE_URL, trims a trailing slash, and encodes the id", () => {
    const url = buildFindingUrl("f 1", { APP_BASE_URL: "https://staging.example.com/" } as unknown as NodeJS.ProcessEnv);
    expect(url).toBe("https://staging.example.com/findings/f%201");
  });
});

describe("buildAcceptanceProposedEmail", () => {
  it("names the requester, the review date, and links to the finding", () => {
    const { subject, html, text } = buildAcceptanceProposedEmail(
      "Unpatched TLS on edge",
      "https://app/findings/f-1",
      "Ana Ops",
      "2026-12-31"
    );
    expect(subject).toContain("Unpatched TLS on edge");
    expect(subject).toMatch(/awaiting your approval/i);
    expect(html).toContain("Ana Ops");
    expect(html).toContain("2026-12-31");
    expect(html).toContain("https://app/findings/f-1");
    // Separation-of-duties wording is the whole reason the email exists.
    expect(text).toMatch(/proposer cannot approve/i);
  });

  it("escapes HTML in the finding title", () => {
    const { html } = buildAcceptanceProposedEmail("<script>x</script>", "https://app/f", "A", "2026-01-01");
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("buildAcceptanceDecidedEmail", () => {
  it("APPROVED reads as binding + closed, and includes the decision note", () => {
    const { subject, html } = buildAcceptanceDecidedEmail(
      "Vendor SOC gap",
      "https://app/f",
      "Ana Ops",
      "approved",
      "Committee accepted for one cycle."
    );
    expect(subject).toMatch(/approved/i);
    expect(html).toMatch(/accepted and binding/i);
    expect(html).toContain("Committee accepted for one cycle.");
  });

  it("REJECTED reads as still-active and omits an absent note", () => {
    const { subject, html } = buildAcceptanceDecidedEmail("Vendor SOC gap", "https://app/f", null, "rejected", null);
    expect(subject).toMatch(/rejected/i);
    expect(html).toMatch(/remains active/i);
    expect(html).not.toMatch(/Decision note/);
  });
});
