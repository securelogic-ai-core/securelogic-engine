import type { LicenseTier } from "../../product/contracts/LicenseTier";
import type { OpinionSeverity } from "../policy/opinionToTargets";
import type { RenderTarget } from "../contracts/RenderTarget";

import { OPINION_TARGET_POLICY } from "../policy/opinionToTargets";
import { RENDER_ENTITLEMENTS } from "../../product/contracts/RenderEntitlements";

export interface BuiltRenderManifest {
  version: "V1";
  targets: readonly RenderTarget[];
}

export function buildRenderManifest(
  license: LicenseTier,
  severity: OpinionSeverity
): BuiltRenderManifest {
  const allowed = new Set(RENDER_ENTITLEMENTS[license]);

  const targets = OPINION_TARGET_POLICY[severity].filter(t =>
    allowed.has(t)
  );

  return {
    version: "V1",
    targets
  };
}
