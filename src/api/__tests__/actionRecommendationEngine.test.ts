import { describe, it, expect, afterEach } from "vitest";

import {
  buildFindingActionDraft,
  buildRiskActionDraft,
  buildObligationActionDraft,
  actionEngineEnabled,
  GENERATED_FINDING_ACTION_TYPE,
  GENERATED_RISK_ACTION_TYPE,
  GENERATED_OBLIGATION_ACTION_TYPE,
  ACTION_OBLIGATION_MIN_SCORE
} from "../lib/actionRecommendationEngine.js";

// ---------------------------------------------------------------------------
// buildFindingActionDraft — pure, threshold + field mapping
// ---------------------------------------------------------------------------

describe("buildFindingActionDraft", () => {
  it("Critical finding → an immediate action linked to the finding", () => {
    const d = buildFindingActionDraft({
      findingId: "f-1",
      title: "CVE-2026-1 affects vendor: Acme Corp",
      severity: "Critical",
      priority: "immediate"
    });
    expect(d).not.toBeNull();
    expect(d!.source_type).toBe("finding");
    expect(d!.source_id).toBe("f-1");
    expect(d!.priority).toBe("immediate");
    expect(d!.action_type).toBe(GENERATED_FINDING_ACTION_TYPE);
    expect(d!.title).toContain("Review and remediate");
    expect(d!.title).toContain("Acme Corp");      // carries the finding title
    expect(d!.description).toContain("Critical");
  });

  it("High finding → near_term action", () => {
    const d = buildFindingActionDraft({ findingId: "f-2", title: "t", severity: "High", priority: "near_term" });
    expect(d?.priority).toBe("near_term");
    expect(d?.source_id).toBe("f-2");
  });

  it("Moderate / Low finding → NO action (below the actionable threshold)", () => {
    expect(buildFindingActionDraft({ findingId: "f", title: "t", severity: "Moderate", priority: "planned" })).toBeNull();
    expect(buildFindingActionDraft({ findingId: "f", title: "t", severity: "Low", priority: "watch" })).toBeNull();
  });

  it("unknown severity → no action (fail closed)", () => {
    expect(buildFindingActionDraft({ findingId: "f", title: "t", severity: "Informational", priority: "watch" })).toBeNull();
  });
});

describe("buildRiskActionDraft", () => {
  it("builds a near_term risk-exposure action linked to the risk", () => {
    const d = buildRiskActionDraft("risk-1", "Vendor Risk");
    expect(d.source_type).toBe("risk");
    expect(d.source_id).toBe("risk-1");
    expect(d.action_type).toBe(GENERATED_RISK_ACTION_TYPE);
    expect(d.priority).toBe("near_term");
    expect(d.title).toContain("Vendor Risk");
    expect(d.description).toContain("exposure");
  });

  it("uses a distinct action_type marker from the finding generator", () => {
    expect(GENERATED_RISK_ACTION_TYPE).not.toBe(GENERATED_FINDING_ACTION_TYPE);
  });
});

describe("buildObligationActionDraft", () => {
  it("builds an action for a high-confidence (>= threshold) obligation match", () => {
    const d = buildObligationActionDraft("ob-1", "HIPAA", ACTION_OBLIGATION_MIN_SCORE);
    expect(d).not.toBeNull();
    expect(d!.source_type).toBe("obligation");
    expect(d!.source_id).toBe("ob-1");
    expect(d!.action_type).toBe(GENERATED_OBLIGATION_ACTION_TYPE);
    expect(d!.priority).toBe("near_term");
    expect(d!.title).toContain("HIPAA");
  });

  it("returns null below the confidence threshold (avoids queue flood)", () => {
    expect(buildObligationActionDraft("ob-1", "HIPAA", ACTION_OBLIGATION_MIN_SCORE - 1)).toBeNull();
    expect(buildObligationActionDraft("ob-1", "HIPAA", 40)).toBeNull(); // MIN_MATCH_SCORE-level → no action
  });

  it("falls back to a generic label when none is provided", () => {
    const d = buildObligationActionDraft("ob-1", "", 90);
    expect(d!.title).toContain("a tracked obligation");
  });
});

// ---------------------------------------------------------------------------
// actionEngineEnabled — OFF by default, ON only for "true"
// ---------------------------------------------------------------------------

describe("actionEngineEnabled", () => {
  const KEY = "SECURELOGIC_ACTION_ENGINE_ENABLED";
  afterEach(() => { delete process.env[KEY]; });

  it("is OFF when unset", () => {
    expect(actionEngineEnabled({})).toBe(false);
  });

  it("is ON only for the exact string 'true'", () => {
    expect(actionEngineEnabled({ [KEY]: "true" })).toBe(true);
    expect(actionEngineEnabled({ [KEY]: "1" })).toBe(false);
    expect(actionEngineEnabled({ [KEY]: "TRUE" })).toBe(false);
  });

  it("defaults to reading process.env", () => {
    expect(actionEngineEnabled()).toBe(false);
  });
});
