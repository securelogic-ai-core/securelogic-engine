/**
 * askProposals.test.ts — the pure client half of the ASK-B proposal flow.
 *
 * Every confirm/decline outcome is terminal, and every message must be honest
 * about single-use: no branch may invite a retry of the same card.
 */
import { describe, it, expect } from "vitest";

import { describeProposalOutcome, proposalExpired } from "../askProposals";
import type { AskConfirmResult } from "@/lib/api";

describe("describeProposalOutcome", () => {
  it("executed → success, applied", () => {
    const r = describeProposalOutcome({ ok: true, status: "executed", summary: "s" });
    expect(r.tone).toBe("success");
    expect(r.text).toMatch(/applied/i);
  });

  it("refused → warning carrying the platform's own message", () => {
    const r = describeProposalOutcome({
      ok: true,
      status: "refused",
      summary: "s",
      message: "The platform declined this change under your current access.",
    });
    expect(r.tone).toBe("warning");
    expect(r.text).toContain("declined this change");
  });

  it("declined → muted, nothing changed", () => {
    const r = describeProposalOutcome({ ok: true, status: "declined", summary: "s" });
    expect(r.tone).toBe("muted");
    expect(r.text).toMatch(/nothing was changed/i);
  });

  it("404 miss → expired/no-longer-confirmable wording, pointing at a FRESH ask", () => {
    const r = describeProposalOutcome({
      ok: false,
      status: 404,
      code: "proposal_not_found",
      message: "No confirmable proposal matches this token.",
    } as AskConfirmResult);
    expect(r.tone).toBe("muted");
    expect(r.text).toMatch(/ask again/i);
  });

  it("401 → session-expired wording", () => {
    const r = describeProposalOutcome({
      ok: false,
      status: 401,
      code: "unauthorized",
      message: "Not authenticated",
    } as AskConfirmResult);
    expect(r.tone).toBe("error");
    expect(r.text).toMatch(/sign in/i);
  });

  it("no branch invites retrying the same card", () => {
    const results: AskConfirmResult[] = [
      { ok: true, status: "executed", summary: "s" },
      { ok: true, status: "refused", summary: "s", message: "m" },
      { ok: true, status: "declined", summary: "s" },
      { ok: false, status: 404, code: "proposal_not_found", message: "m" },
      { ok: false, status: 502, code: "confirm_failed", message: "m" },
    ];
    for (const result of results) {
      const text = describeProposalOutcome(result).text.toLowerCase();
      expect(text).not.toMatch(/try again|retry this|click again/);
    }
  });
});

describe("proposalExpired", () => {
  it("false before the deadline, true after", () => {
    const now = new Date("2026-08-13T12:00:00Z");
    expect(proposalExpired("2026-08-13T12:15:00Z", now)).toBe(false);
    expect(proposalExpired("2026-08-13T11:59:59Z", now)).toBe(true);
  });

  it("an unparseable timestamp does NOT hide the buttons (server enforces anyway)", () => {
    expect(proposalExpired("not-a-date")).toBe(false);
  });
});
