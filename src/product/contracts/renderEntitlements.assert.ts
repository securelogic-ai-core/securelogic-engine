import type { RenderTarget } from "../../render/contracts/RenderTarget";
import { RENDER_ENTITLEMENTS } from "./RenderEntitlements";

type AllEntitledTargets =
  typeof RENDER_ENTITLEMENTS[keyof typeof RENDER_ENTITLEMENTS][number];

type _AssertEveryTargetIsEntitled =
  Exclude<RenderTarget, AllEntitledTargets> extends never ? true : never;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const __assertEveryTargetIsEntitled: _AssertEveryTargetIsEntitled = true;
