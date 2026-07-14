/**
 * actions.test.ts — the vendor-detail Finding close control must present the closure-gate
 * refusal exactly like every other close surface: the ONE shared customer-safe sentence,
 * never the raw `close_requires_remediation_complete` contract code.
 *
 * Regression under test: this action used to `return { error: data.error }` raw, so a
 * customer clicking "Close" on /vendors/[id] saw the snake_case identifier. It now delegates
 * to mapFindingActionError — the single mapper that /findings, /ai-systems/[id],
 * /obligations/[id], /controls/[id], the Finding detail card and the Decision Workspace all
 * share — so the message cannot drift between surfaces.
 *
 * The real mapper is deliberately NOT mocked: proving parity is the whole point.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mapFindingActionError,
  CLOSE_REQUIRES_REMEDIATION_COMPLETE,
} from "@/lib/findingClosureError";

const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: () => getSession() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateFindingStatus } from "../actions";

const FINDING_ID = "11111111-1111-1111-1111-111111111111";
const VENDOR_ID = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  getSession.mockReset();
  getSession.mockResolvedValue({ jwtToken: "test-token" });
});

describe("vendor detail updateFindingStatus — closure-gate 409", () => {
  it("maps close_requires_remediation_complete to the shared customer-safe message and never leaks the raw code", async () => {
    const body = { error: CLOSE_REQUIRES_REMEDIATION_COMPLETE, open_actions: 2 };
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => body,
    }) as unknown as typeof fetch;

    const result = await updateFindingStatus(VENDOR_ID, FINDING_ID, "closed");

    // Parity: byte-for-byte the same object the shared mapper produces for every other
    // close surface — same sentence, same count, same remediation deep link.
    const expected = mapFindingActionError(body, FINDING_ID);
    expect(result).toEqual(expected);

    // The machine-readable contract code must never reach the customer.
    expect(result?.error).toBe(expected.error);
    expect(result?.error).not.toContain(CLOSE_REQUIRES_REMEDIATION_COMPLETE);
    expect(result?.error).not.toMatch(/[a-z]+_[a-z]+/); // no snake_case identifier at all
    expect(result?.blockingActions).toBe(2);
    expect(result?.remediationHref).toBe(`/findings/${FINDING_ID}?tab=remediation`);
  });

  it("also maps the governance-axis refusal to the shared message, not a raw code", async () => {
    const body = { error: "invalid_decision_transition", reason: "close_requires_remediated_or_accepted_risk" };
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => body,
    }) as unknown as typeof fetch;

    const result = await updateFindingStatus(VENDOR_ID, FINDING_ID, "closed");

    expect(result).toEqual(mapFindingActionError(body, FINDING_ID));
    expect(result?.error).not.toContain("invalid_decision_transition");
    expect(result?.error).not.toMatch(/[a-z]+_[a-z]+/);
    expect(result?.remediationHref).toBe(`/findings/${FINDING_ID}?tab=remediation`);
  });
});
