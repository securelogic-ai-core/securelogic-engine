import { describe, it, expect } from "vitest";
import { directIntelRefs, describeChange } from "../lib/findingContextResolver.js";

describe("directIntelRefs (pure)", () => {
  it("maps an intelligence_event source to eventIds", () => {
    expect(directIntelRefs("intelligence_event", "e1")).toEqual({ signalIds: [], eventIds: ["e1"] });
  });
  it("maps cyber_signal / signal sources to signalIds", () => {
    expect(directIntelRefs("cyber_signal", "s1")).toEqual({ signalIds: ["s1"], eventIds: [] });
    expect(directIntelRefs("signal", "s2")).toEqual({ signalIds: ["s2"], eventIds: [] });
  });
  it("returns empty for assessment-sourced findings or a missing source_id", () => {
    expect(directIntelRefs("vendor_review", "v1")).toEqual({ signalIds: [], eventIds: [] });
    expect(directIntelRefs("control_test", "c1")).toEqual({ signalIds: [], eventIds: [] });
    expect(directIntelRefs("cyber_signal", null)).toEqual({ signalIds: [], eventIds: [] });
  });
});

describe("describeChange (pure)", () => {
  it("labels creation", () => {
    expect(describeChange("finding.created", null)).toBe("Finding created");
  });
  it("labels field updates from the payload", () => {
    expect(describeChange("finding.updated", { severity: "Critical" })).toBe("Severity changed to Critical");
    expect(describeChange("finding.updated", { status: "in_progress" })).toBe("Status changed to in_progress");
    expect(describeChange("finding.updated", { owner_user_id: "u1" })).toBe("Owner reassigned");
    expect(describeChange("finding.updated", { priority: "immediate" })).toBe("Priority changed to immediate");
    expect(describeChange("finding.updated", {})).toBe("Finding updated");
  });
  it("humanizes unknown finding event types", () => {
    expect(describeChange("finding.escalated", null)).toBe("escalated");
  });
});
