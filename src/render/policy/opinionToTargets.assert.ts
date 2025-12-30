import type { RenderTarget } from "../contracts/RenderTarget";
import { OPINION_TARGET_POLICY } from "./opinionToTargets";

type PolicyTargets =
  typeof OPINION_TARGET_POLICY[keyof typeof OPINION_TARGET_POLICY][number];

type _AssertPolicyTargetsValid =
  Exclude<PolicyTargets, RenderTarget> extends never ? true : never;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const __assertPolicyTargetsValid: _AssertPolicyTargetsValid = true;
