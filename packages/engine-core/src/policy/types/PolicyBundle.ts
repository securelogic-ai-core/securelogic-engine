import type { ExecutablePolicy } from "../registry/ExecutablePolicy.js";

export interface PolicyBundle {
  bundleId: string;
  bundleHash: string;
  name: string;
  version: string;
  parentBundleId?: string;
  createdAt: string;
  policies: ExecutablePolicy[];
}