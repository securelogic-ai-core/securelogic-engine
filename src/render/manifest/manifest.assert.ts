import { RENDER_TARGETS } from "../contracts/RenderTarget";
import type { RenderManifestV1 } from "./RenderManifestV1";

type ManifestTarget = RenderManifestV1["target"];
type AllowedTargets = typeof RENDER_TARGETS[number];

type AssertManifestTargetValid =
  Exclude<ManifestTarget, AllowedTargets> extends never ? true : never;

// ⛔ compile-time failure if manifest allows invalid targets
const _assert: AssertManifestTargetValid = true;
export {};
