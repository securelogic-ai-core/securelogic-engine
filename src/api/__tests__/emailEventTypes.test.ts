import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { isSuppressionEvent } from "../lib/emailEventTypes.js";

/**
 * The suppression predicate, pinned to the event names the provider ACTUALLY
 * sends.
 *
 * The defect this guards (found 2026-08-11): the predicate tested
 * `includes("complaint")` while Resend sends `email.complained` — which does
 * not contain that substring. Both the production and staging webhooks are
 * subscribed to `email.complained`, so spam complaints were being received and
 * stored for the life of the integration, and never suppressed. We kept mailing
 * people who had reported us as spam, which is the fastest way to lose sender
 * reputation for every customer on the shared domain.
 *
 * The lesson worth encoding: a substring predicate over a vocabulary owned by
 * someone else must be tested against that vocabulary verbatim, not against
 * words we assume they use.
 */

/** Every event type Resend can deliver, exactly as the provider spells it. */
const RESEND_EVENTS = [
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.complained",
  "email.bounced",
  "email.opened",
  "email.clicked",
  "email.failed"
] as const;

const SHOULD_SUPPRESS = new Set(["email.bounced", "email.complained"]);

describe("isSuppressionEvent, against the provider's real vocabulary", () => {
  for (const type of RESEND_EVENTS) {
    const expected = SHOULD_SUPPRESS.has(type);
    it(`${type} -> ${expected ? "suppresses" : "does not suppress"}`, () => {
      expect(isSuppressionEvent(type)).toBe(expected);
    });
  }

  it("email.complained suppresses — the exact regression", () => {
    expect(isSuppressionEvent("email.complained")).toBe(true);
  });

  it("still honours the historical bare spellings", () => {
    expect(isSuppressionEvent("bounce")).toBe(true);
    expect(isSuppressionEvent("complaint")).toBe(true);
  });

  it("a send failure is NOT a recipient-level suppression", () => {
    // `failed` means the message did not go out, not that the address is bad.
    expect(isSuppressionEvent("email.failed")).toBe(false);
  });

  it("suppresses exactly two of the provider's eight event types", () => {
    expect(RESEND_EVENTS.filter(isSuppressionEvent)).toEqual([
      "email.complained",
      "email.bounced"
    ]);
  });
});

describe("the operator dashboard uses the same stem", () => {
  const dash = readFileSync(
    resolve(process.cwd(), "src/api/routes/adminOpsDashboard.ts"),
    "utf8"
  );

  it("the Complaint filter matches email.complained", () => {
    const filter = /data-type="([a-z]+)">Complaint</.exec(dash)?.[1];
    expect(filter).toBeDefined();
    expect("email.complained".includes(filter!)).toBe(true);
  });

  it("the complaint badge matches email.complained", () => {
    const badge = /ev\.includes\('(complain[a-z]*)'\)/.exec(dash)?.[1];
    expect(badge).toBeDefined();
    expect("email.complained".includes(badge!)).toBe(true);
  });
});
