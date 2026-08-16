/**
 * vendorEngagementFailureText — the one sentence a reviewer sees when the
 * engine refuses an engagement action.
 *
 * The contract: the ENGINE's words are surfaced verbatim, in preference order
 * message → reason → intake-validation summary → bare error code. The UI never
 * paraphrases a refusal it did not author.
 */
import { describe, it, expect } from "vitest";
import {
  vendorEngagementFailureText,
  isEngagementFailure,
  type VendorEngagementFailure,
} from "../api";

describe("vendorEngagementFailureText", () => {
  it("prefers the handler's message verbatim", () => {
    const f: VendorEngagementFailure = {
      error: "scope_frozen",
      message:
        "The questionnaire has been issued. Its scope is frozen — a vendor's answers are only meaningful against the questions they were asked.",
      reason: "no transition from issued",
    };
    expect(vendorEngagementFailureText(f)).toBe(f.message);
  });

  it("falls back to the state machine's reason when there is no message", () => {
    const f: VendorEngagementFailure = {
      error: "cannot_begin_review",
      from: "issued",
      reason: "No transition issued → in_review for actor internal.",
    };
    expect(vendorEngagementFailureText(f)).toBe(f.reason);
  });

  it("summarizes intake validation naming the exact fields", () => {
    const f: VendorEngagementFailure = {
      error: "incomplete_intake",
      missing: ["data_sensitivity", "regulatory_breach_notification"],
      invalid: [{ field: "ai_autonomy", allowed: ["none", "human_in_the_loop"] }],
    };
    const text = vendorEngagementFailureText(f);
    expect(text).toContain("data_sensitivity");
    expect(text).toContain("regulatory_breach_notification");
    expect(text).toContain("ai_autonomy");
    expect(text).toContain("human_in_the_loop");
  });

  it("falls back to the bare error code when the engine said nothing else", () => {
    expect(vendorEngagementFailureText({ error: "recompute_failed" })).toBe("recompute_failed");
  });
});

describe("isEngagementFailure", () => {
  it("discriminates failures from successes", () => {
    expect(isEngagementFailure({ failure: { error: "x" } })).toBe(true);
    expect(isEngagementFailure({ ok: true as const, status: "issued" } as never)).toBe(false);
  });
});
