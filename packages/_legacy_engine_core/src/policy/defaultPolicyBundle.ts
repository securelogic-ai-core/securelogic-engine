import { defaultPolicySet } from "./defaultPolicySet.js";

export const defaultPolicyBundle = {
  bundleId: "DEFAULT-BUNDLE-0001",
  name: "Default Built-in Policy Bundle",
  createdAt: new Date().toISOString(),
  policies: defaultPolicySet.policies
};
