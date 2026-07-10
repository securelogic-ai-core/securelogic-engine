/**
 * dashboardState.test.ts — the dashboard must distinguish a FAILED summary load
 * from an empty-by-design org (workflow-consistency Phase 2). A failed fetch
 * (summaryLoaded=false) renders an explicit error; a loaded summary — even all
 * zeros — renders the real panel.
 */

import { describe, it, expect } from "vitest";
import { dashboardPanel } from "../dashboardState";

describe("dashboardPanel", () => {
  it("shows the sample dashboard to non-platform users regardless of load state", () => {
    expect(dashboardPanel(false, true)).toBe("sample");
    expect(dashboardPanel(false, false)).toBe("sample");
  });

  it("shows the real posture panel when the summary loaded (zeros are a real empty state)", () => {
    expect(dashboardPanel(true, true)).toBe("posture");
  });

  it("shows an EXPLICIT error — never a silent drop — when the summary failed to load", () => {
    expect(dashboardPanel(true, false)).toBe("error");
  });
});
