import { describe, it, expect } from "vitest";
import { activeActionsCount } from "../actionsMetrics";

// The ONE client-side fallback for the Metric Contract ACTIVE-actions total —
// shared by ActionsRing, OpenItemsAging, and the Briefing composer.
describe("activeActionsCount", () => {
  it("prefers the server-computed Metric Contract `active` field", () => {
    expect(activeActionsCount({ active: 7, open: 1, in_progress: 1, blocked: 1 })).toBe(7);
    // Server zero is authoritative — never re-derived from the parts.
    expect(activeActionsCount({ active: 0, open: 4 })).toBe(0);
  });

  it("falls back to summing the exact parts on older engine payloads", () => {
    expect(activeActionsCount({ open: 4, in_progress: 2, blocked: 1 })).toBe(7);
    expect(activeActionsCount({ open: 4, in_progress: 2 })).toBe(6); // blocked absent
  });

  it("is honest about missing payloads", () => {
    expect(activeActionsCount(null)).toBe(0);
    expect(activeActionsCount(undefined)).toBe(0);
    expect(activeActionsCount({})).toBe(0);
  });
});
