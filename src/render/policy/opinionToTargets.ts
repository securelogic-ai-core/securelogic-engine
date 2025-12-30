import "./opinionToTargets.assert";

import type { RenderTarget } from "../contracts/RenderTarget";

export type OpinionSeverity = "LOW" | "MEDIUM" | "HIGH";

export const OPINION_TARGET_POLICY: Record<
  OpinionSeverity,
  readonly RenderTarget[]
> = {
  LOW: ["PDF", "JSON"],
  MEDIUM: ["PDF", "JSON"],
  HIGH: ["PDF", "DASHBOARD", "JSON"]
} as const;
