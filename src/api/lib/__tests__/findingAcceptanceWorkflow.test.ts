/**
 * findingAcceptanceWorkflow.test.ts — the side-door guard, with no database and no HTTP.
 *
 * The route/isolation tests prove the guard is WIRED IN at all three write paths (single
 * PATCH decision_state, bulk decide, legacy status). These prove the rule is RIGHT: when
 * the signed workflow is live, no direct write may fabricate an "accepted" state; when it
 * is off (production), every path is byte-identical.
 */

import { describe, expect, it } from "vitest";

import {
  directRiskAcceptanceBlocked,
  USE_RISK_ACCEPTANCE_WORKFLOW_ERROR,
} from "../findingAcceptanceWorkflow.js";

const ON = { SECURELOGIC_RISK_ACCEPTANCE_ENABLED: "true" } as unknown as NodeJS.ProcessEnv;
const OFF = { SECURELOGIC_RISK_ACCEPTANCE_ENABLED: "false" } as unknown as NodeJS.ProcessEnv;
const UNSET = {} as unknown as NodeJS.ProcessEnv;

describe("directRiskAcceptanceBlocked", () => {
  describe("workflow LIVE (SECURELOGIC_RISK_ACCEPTANCE_ENABLED=true)", () => {
    it("blocks a direct governance write to accepted_risk", () => {
      expect(directRiskAcceptanceBlocked({ decisionState: "accepted_risk" }, ON)).toBe(true);
    });

    it("blocks a legacy status write to accepted", () => {
      expect(directRiskAcceptanceBlocked({ legacyStatus: "accepted" }, ON)).toBe(true);
    });

    it("does NOT block other decision transitions (mitigating, resolved, needs_review)", () => {
      expect(directRiskAcceptanceBlocked({ decisionState: "mitigating" }, ON)).toBe(false);
      expect(directRiskAcceptanceBlocked({ decisionState: "resolved" }, ON)).toBe(false);
      expect(directRiskAcceptanceBlocked({ decisionState: "needs_review" }, ON)).toBe(false);
    });

    it("does NOT block other legacy status writes (open, in_progress, closed)", () => {
      expect(directRiskAcceptanceBlocked({ legacyStatus: "open" }, ON)).toBe(false);
      expect(directRiskAcceptanceBlocked({ legacyStatus: "in_progress" }, ON)).toBe(false);
      // 'closed' is a legitimate closure — gated by the closure policy, not this guard.
      expect(directRiskAcceptanceBlocked({ legacyStatus: "closed" }, ON)).toBe(false);
    });

    it("blocks when either axis reaches accepted, regardless of the other", () => {
      expect(
        directRiskAcceptanceBlocked({ decisionState: "mitigating", legacyStatus: "accepted" }, ON)
      ).toBe(true);
    });
  });

  describe("workflow OFF (production posture)", () => {
    it("blocks nothing when the flag is 'false' — legacy accept path is byte-identical", () => {
      expect(directRiskAcceptanceBlocked({ decisionState: "accepted_risk" }, OFF)).toBe(false);
      expect(directRiskAcceptanceBlocked({ legacyStatus: "accepted" }, OFF)).toBe(false);
    });

    it("blocks nothing when the flag is unset", () => {
      expect(directRiskAcceptanceBlocked({ decisionState: "accepted_risk" }, UNSET)).toBe(false);
      expect(directRiskAcceptanceBlocked({ legacyStatus: "accepted" }, UNSET)).toBe(false);
    });
  });

  it("exposes a customer-safe refusal body (no snake_case leak in the message)", () => {
    expect(USE_RISK_ACCEPTANCE_WORKFLOW_ERROR.error).toBe("use_risk_acceptance_workflow");
    expect(USE_RISK_ACCEPTANCE_WORKFLOW_ERROR.message).not.toMatch(/_/);
  });
});
