import type { Policy } from "../Policy.js";

export type PolicyBundle = {
  bundleHash: string;
  bundleId: string;
  name: string;
  createdAt: string;
  policies: Policy[];
};
