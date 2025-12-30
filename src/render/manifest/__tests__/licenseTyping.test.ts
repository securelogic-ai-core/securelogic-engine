import type { RenderTarget } from "../../contracts/RenderTarget";
import type { LicenseCapabilities } from "../../../product/contracts/LicenseCapabilities";

describe("License → RenderTarget typing", () => {
  it("allows only valid render targets", () => {
    const caps: LicenseCapabilities = {
      allowedRenderTargets: ["PDF", "DASHBOARD"] as RenderTarget[]
    };

    expect(caps.allowedRenderTargets).toContain("PDF");
  });
});
