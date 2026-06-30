import { describe, it, expect } from "vitest";
import { createSubmitGuard } from "../billingPortalSubmit";

describe("createSubmitGuard (Manage Billing single-click guard)", () => {
  it("lets the first submission proceed", () => {
    const guard = createSubmitGuard();
    expect(guard.shouldProceed()).toBe(true);
  });

  it("blocks every submission after the first (duplicate-POST prevention)", () => {
    const guard = createSubmitGuard();
    expect(guard.shouldProceed()).toBe(true); // first click → native POST proceeds
    expect(guard.shouldProceed()).toBe(false); // rapid 2nd click → blocked
    expect(guard.shouldProceed()).toBe(false); // and any further clicks → blocked
  });

  it("tracks submission state via hasSubmitted", () => {
    const guard = createSubmitGuard();
    expect(guard.hasSubmitted).toBe(false);
    guard.shouldProceed();
    expect(guard.hasSubmitted).toBe(true);
  });

  it("isolates state per instance (each mounted form gets its own guard)", () => {
    const a = createSubmitGuard();
    const b = createSubmitGuard();
    expect(a.shouldProceed()).toBe(true);
    // A second form instance is unaffected by A having submitted.
    expect(b.shouldProceed()).toBe(true);
    expect(a.shouldProceed()).toBe(false);
  });
});
