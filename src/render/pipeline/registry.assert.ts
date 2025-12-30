import type { RenderTarget } from "../contracts/RenderTarget";
import { RENDERER_REGISTRY } from "./registerAll";

type RegistryTargets = keyof typeof RENDERER_REGISTRY;

type _AssertRegistryCoversAllTargets =
  Exclude<RenderTarget, RegistryTargets> extends never ? true : never;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const __assertRegistryCoversAllTargets: _AssertRegistryCoversAllTargets = true;
