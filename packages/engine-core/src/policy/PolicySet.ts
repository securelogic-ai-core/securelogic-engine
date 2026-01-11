import type { Policy } from "./Policy.js";

export type PolicySet = {
  version: string;
  policies: Policy[];
};
