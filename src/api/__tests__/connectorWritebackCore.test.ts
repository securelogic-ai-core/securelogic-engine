/**
 * connectorWritebackCore.test.ts — ERIP E2a: the pure writeback decision +
 * backoff. Optimistic concurrency: apply when we own the field, hold when the
 * external system drifted from our last push.
 */

import { describe, expect, it } from "vitest";
import { decideWriteback, writebackBackoffMinutes } from "../lib/connectorWritebackCore.js";

describe("decideWriteback", () => {
  it("noop when the external value already equals desired", () => {
    expect(decideWriteback({ desiredValue: "critical", externalCurrent: "critical", lastPushed: "high" })).toBe("noop");
  });

  it("apply on the first push (no prior last-pushed), regardless of external value", () => {
    expect(decideWriteback({ desiredValue: "critical", externalCurrent: "low", lastPushed: null })).toBe("apply");
    expect(decideWriteback({ desiredValue: "critical", externalCurrent: null, lastPushed: null })).toBe("apply");
  });

  it("apply when the external value still matches our last push (we own it, no drift)", () => {
    expect(decideWriteback({ desiredValue: "critical", externalCurrent: "high", lastPushed: "high" })).toBe("apply");
  });

  it("conflict when the external value drifted from our last push", () => {
    // We last pushed "high"; someone set it to "medium" externally → do not overwrite.
    expect(decideWriteback({ desiredValue: "critical", externalCurrent: "medium", lastPushed: "high" })).toBe("conflict");
  });

  it("conflict when the field was cleared externally after our push", () => {
    expect(decideWriteback({ desiredValue: "critical", externalCurrent: null, lastPushed: "high" })).toBe("conflict");
  });
});

describe("writebackBackoffMinutes", () => {
  it("grows exponentially and caps at 60", () => {
    expect(writebackBackoffMinutes(1)).toBe(1);
    expect(writebackBackoffMinutes(2)).toBe(2);
    expect(writebackBackoffMinutes(3)).toBe(4);
    expect(writebackBackoffMinutes(4)).toBe(8);
    expect(writebackBackoffMinutes(100)).toBe(60);
  });

  it("floors at attempt 1 for non-positive input", () => {
    expect(writebackBackoffMinutes(0)).toBe(1);
    expect(writebackBackoffMinutes(-5)).toBe(1);
  });
});
