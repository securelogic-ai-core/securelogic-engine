import { RENDER_TARGETS } from "../../render/contracts/RenderTarget";
import { LICENSE_RENDER_ENTITLEMENTS } from "./LicenseRenderEntitlements";

type AllowedTargets =
  typeof LICENSE_RENDER_ENTITLEMENTS[keyof typeof LICENSE_RENDER_ENTITLEMENTS][number];

type AssertAllTargetsMentioned =
  Exclude<typeof RENDER_TARGETS[number], AllowedTargets> extends never
    ? true
    : never;

const _assert: AssertAllTargetsMentioned = true;
export {};
