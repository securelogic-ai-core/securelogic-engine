import type { RenderTarget } from "@/render/contracts/RenderTarget";
import { LICENSE_ENTITLEMENTS } from "./LicenseEntitlements";

type AllowedTargets =
  typeof LICENSE_ENTITLEMENTS[keyof typeof LICENSE_ENTITLEMENTS]["renderTargets"][number];

type _AssertAllRenderTargetsAccountedFor =
  Exclude<RenderTarget, AllowedTargets> extends never
    ? true
    : never;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const __assertAllRenderTargetsAccountedFor: _AssertAllRenderTargetsAccountedFor = true;
