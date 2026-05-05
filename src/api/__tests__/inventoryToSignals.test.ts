import { describe, it, expect, vi, beforeEach } from "vitest";

// Logger mock — captures the warn call for the unknown-criticality branch.
const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }));
vi.mock("../infra/logger.js", () => ({
  logger: {
    warn: mockWarn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  vendorCriticalityToSignals,
  VENDOR_CRITICALITY_TO_SEVERITY,
  VENDOR_RISK_DOMAIN,
} from "../lib/inventoryToSignals.js";

beforeEach(() => {
  mockWarn.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// Per-criticality severity mapping (4 tests)
// ─────────────────────────────────────────────────────────────────────────────

describe("vendorCriticalityToSignals — per-criticality mapping", () => {
  it("maps 'critical' → severity 'Critical'", () => {
    const out = vendorCriticalityToSignals([{ id: "v1", criticality: "critical" }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe("Critical");
    expect(out[0]!.domain).toBe(VENDOR_RISK_DOMAIN);
  });

  it("maps 'high' → severity 'High'", () => {
    const out = vendorCriticalityToSignals([{ id: "v1", criticality: "high" }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe("High");
  });

  it("maps 'medium' → severity 'Moderate' (rename intentional)", () => {
    // vendors stores 'medium' (lowercase); engine reads 'Moderate' (TitleCase).
    // The rename is the entire reason this synthesis function exists.
    const out = vendorCriticalityToSignals([{ id: "v1", criticality: "medium" }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe("Moderate");
  });

  it("maps 'low' → severity 'Low'", () => {
    const out = vendorCriticalityToSignals([{ id: "v1", criticality: "low" }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe("Low");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Skip cases (2 tests)
// ─────────────────────────────────────────────────────────────────────────────

describe("vendorCriticalityToSignals — skip cases", () => {
  it("null criticality is skipped silently (no warn — schema-supported state)", () => {
    const out = vendorCriticalityToSignals([{ id: "v1", criticality: null }]);
    expect(out).toEqual([]);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("unknown criticality is skipped AND logs a warn (defensive against schema drift)", () => {
    const out = vendorCriticalityToSignals([{ id: "v1", criticality: "extreme" }]);
    expect(out).toEqual([]);
    expect(mockWarn).toHaveBeenCalledTimes(1);
    const call = mockWarn.mock.calls[0]!;
    expect(call[0]).toMatchObject({
      event: "vendor_criticality_unknown_skipped",
      vendorId: "v1",
      criticality: "extreme",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Empty + mixed input (2 tests)
// ─────────────────────────────────────────────────────────────────────────────

describe("vendorCriticalityToSignals — bulk inputs", () => {
  it("empty input returns empty array", () => {
    expect(vendorCriticalityToSignals([])).toEqual([]);
  });

  it("mixed input produces correct count and severities, preserving order", () => {
    const out = vendorCriticalityToSignals([
      { id: "v1", criticality: "critical" },
      { id: "v2", criticality: "low" },
      { id: "v3", criticality: null },          // skipped silently
      { id: "v4", criticality: "high" },
      { id: "v5", criticality: "weird" },       // skipped + warn
      { id: "v6", criticality: "medium" },
    ]);

    expect(out).toHaveLength(4);
    expect(out.map((s) => s.severity)).toEqual([
      "Critical",
      "Low",
      "High",
      "Moderate",
    ]);
    // null is silent, "weird" produces exactly one warn.
    expect(mockWarn).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic shape (1 test)
// ─────────────────────────────────────────────────────────────────────────────

describe("vendorCriticalityToSignals — synthetic finding shape", () => {
  it("synthetic id format is `vendor-criticality:{vendor.id}` and stable", () => {
    const vendorId = "11111111-1111-4111-8111-111111111111";
    const out = vendorCriticalityToSignals([
      { id: vendorId, criticality: "critical" },
    ]);

    expect(out[0]!.id).toBe(`vendor-criticality:${vendorId}`);
    // Stable: same input → same id every call.
    const out2 = vendorCriticalityToSignals([
      { id: vendorId, criticality: "critical" },
    ]);
    expect(out2[0]!.id).toBe(out[0]!.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mapping table introspection (1 test — guards against accidental edits)
// ─────────────────────────────────────────────────────────────────────────────

describe("VENDOR_CRITICALITY_TO_SEVERITY", () => {
  it("contains exactly the four canonical mappings", () => {
    expect(VENDOR_CRITICALITY_TO_SEVERITY).toEqual({
      critical: "Critical",
      high:     "High",
      medium:   "Moderate",
      low:      "Low",
    });
  });
});
