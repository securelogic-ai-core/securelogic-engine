import type { ExecutablePolicy } from "./ExecutablePolicy.js";

interface PolicyBundle {
  bundleId: string;
  bundleHash: string;
  name: string;
  version: string;
  parentBundleId?: string;
  createdAt: string;
  policies: ExecutablePolicy[];
}