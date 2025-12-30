import { assertLicenseAllowsTarget } from "./assertLicenseAllowsTarget";

import type { RenderManifestV1 } from "../manifest";
import "../bootstrap/registerAllRenderers";

import type { RenderManifestV1 } from "../manifest/RenderManifestV1";
import { RendererRegistry } from "./RendererRegistry";
import { getLicenseEntitlements } from "../../product/runtime/getLicenseEntitlements";

export function executeRenderPipeline(manifest: RenderManifestV1) {
  const license =
    typeof manifest.license === "string"
      ? { version: "V1" as const, tier: manifest.license }
      : manifest.license;

  const entitlements = getLicenseEntitlements(license);

  if (!entitlements.allowedRenderTargets.includes(manifest.target)) {
    return { status: "LICENSE_VIOLATION" as const };
  }

  const renderer = RendererRegistry.get(manifest.target);

  if (!renderer) {
    return { status: "UNSUPPORTED_TARGET" as const };
  }

  return {
    status: "RENDERED" as const,
    result: renderer.render(manifest)
  };
}
