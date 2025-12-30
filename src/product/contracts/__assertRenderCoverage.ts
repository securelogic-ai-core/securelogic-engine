import type { RenderTarget } from "../../render/contracts/RenderTarget";
import { LICENSE_RENDER_ENTITLEMENTS } from "./LicenseRenderEntitlements";

type AllTargets = RenderTarget;

type CoveredTargets =
  (typeof LICENSE_RENDER_ENTITLEMENTS)[keyof typeof LICENSE_RENDER_ENTITLEMENTS][number];

type AssertAllTargetsCovered =
  Exclude<AllTargets, CoveredTargets> extends never ? true : never;

const _assert: AssertAllTargetsCovered = true;
