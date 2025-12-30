import { describe, it, expect } from "vitest";
import { buildRenderManifest } from "../buildRenderManifest";

describe("buildRenderManifest", () => {
  it("filters targets by license", () => {
    const manifest = buildRenderManifest("CORE", "HIGH");
    expect(manifest.targets).toEqual(["PDF", "JSON"]);
  });

  it("allows DASHBOARD on PRO + HIGH", () => {
    const manifest = buildRenderManifest("PRO", "HIGH");
    expect(manifest.targets).toContain("DASHBOARD");
  });
});
