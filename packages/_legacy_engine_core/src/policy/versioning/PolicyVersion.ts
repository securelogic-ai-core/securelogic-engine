import type { PolicySet } from "../PolicySet.js";

export type PolicyVersion = {
  versionId: string;
  name: string;
  createdAt: string;
  policies: PolicySet;
};
