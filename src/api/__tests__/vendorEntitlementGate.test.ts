/**
 * Platform-wide entitlement-gate alignment — source + behavioral pins.
 *
 * SecureLogic is a rank-4 / premium platform with a rank-2 Intelligence-Brief
 * wedge. The core platform surface (Bucket A) must gate at requireEntitlement
 * ("premium"), NOT rank-2 "standard" (the $39 Brief-Pro tier). The brief surface
 * (Bucket B) must STAY at rank-2 "standard". This suite pins both contracts so a
 * future regression that re-introduces a "standard" gate on a Bucket A file — or
 * silently promotes a Bucket B file — reddens CI here.
 *
 * History: this file began (step 5, #233) as a vendor-only gate pin and was
 * extended (#244) to the remaining vendor-surface files. PR 1 (platform-wide
 * flip) generalizes it into the parametrized suite below. The vendor files remain
 * as a subset of Bucket A.
 *
 * Pin style, per file:
 *   1. Source-assert — Bucket A: zero `requireEntitlement("standard")`, exact
 *      `requireEntitlement("premium")` count. Bucket B: zero premium, exact
 *      standard count. Carve-outs (posture, topRisksSummary, sso): unchanged.
 *   2. Behavioral — exercises the real requireEntitlement gate: a rank-2 key
 *      (professional/standard) gets 403; a rank-4 key (premium/platform/team)
 *      passes; the cyberSignals fetch/reprocess routes reject a rank-2 caller.
 */
import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { readFileSync } from "fs";
import { resolve } from "path";
import { requireEntitlement } from "../middleware/requireEntitlement.js";

function readRoute(file: string): string {
  return readFileSync(resolve(__dirname, "../routes", file), "utf8");
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const STD = 'requireEntitlement("standard")';
const PREM = 'requireEntitlement("premium")';
const STARTER = 'requireEntitlement("starter")';
const PROF = 'requireEntitlement("professional")';

// ---------------------------------------------------------------------------
// 1a. Bucket A (core platform) — premium-gated, zero standard.
//     Map value = exact `requireEntitlement("premium")` occurrence count
//     (route gates + any header doc-comment reference, e.g. VAD's 19 = 18
//     routes + 1 comment). A new route here must bump the count deliberately.
// ---------------------------------------------------------------------------
const BUCKET_A_PREMIUM: Record<string, number> = {
  // vendor / third-party-risk surface (#233 + #244)
  "vendors.ts": 8,
  "vendorAssuranceDocuments.ts": 19,
  "vendorAssessments.ts": 3,
  "vendorReviews.ts": 4,
  "vendorAssessmentAnalysis.ts": 1,
  "vendorSignalContext.ts": 1,
  // findings family (#244)
  "findings.ts": 5,
  "findingsExport.ts": 1,
  // risk engine
  "risks.ts": 8,
  "riskTreatments.ts": 4,
  "riskSettings.ts": 2,
  "riskScale.ts": 3,
  "riskScoringWeights.ts": 2,
  // risk / signal linking
  "riskControlLinks.ts": 4,
  "riskObligationLinks.ts": 4,
  "signalVendorLinks.ts": 4,
  "signalAiSystemLinks.ts": 4,
  "signalControlLinks.ts": 4,
  "signalObligationLinks.ts": 4,
  "signalMatchSuggestions.ts": 5,
  // controls / frameworks
  "controls.ts": 5,
  "controlMappings.ts": 2,
  "controlAssessments.ts": 4,
  "controlComplianceContext.ts": 1,
  "frameworks.ts": 4,
  "frameworkActivation.ts": 1,
  "frameworkReadiness.ts": 1,
  "requirements.ts": 6,
  // obligations
  "obligations.ts": 5,
  "obligationMappings.ts": 2,
  "obligationAssessments.ts": 4,
  "obligationComplianceContext.ts": 1,
  // AI governance
  "aiSystems.ts": 5,
  "aiGovernanceAssessments.ts": 4,
  "aiSystemGovernanceContext.ts": 1,
  "aiSystemVendorDependencies.ts": 4,
  "governanceReviews.ts": 3,
  // assessments / evidence / dependencies
  "assess.ts": 1,
  "assessments.ts": 2,
  "evidence.ts": 4,
  "dependencies.ts": 5,
  "dependencyAssessments.ts": 4,
  // findings/actions/policies
  "actions.ts": 5,
  "policies.ts": 6,
  // reports
  "executiveReport.ts": 2,
  "gapReport.ts": 1,
  "auditPackage.ts": 2,
  // AI features
  "ask.ts": 1,
  "transcribe.ts": 1,
  // cyber signals (customer CRUD + fetch + reprocess)
  "cyberSignals.ts": 13,
  // Bucket C rank-4 flips
  "teamInvites.ts": 5,
  "webhooks.ts": 7,
  "templates.ts": 3,
  // auditLog: already premium (#233 era) + admin-role gated — pinned here
  "auditLog.ts": 3,
};

describe("entitlement gate — Bucket A (core platform) is premium, never standard", () => {
  for (const [file, expectedPremium] of Object.entries(BUCKET_A_PREMIUM)) {
    it(`${file}: zero standard, ${expectedPremium} premium`, () => {
      const src = readRoute(file);
      expect(count(src, STD)).toBe(0);
      expect(count(src, PREM)).toBe(expectedPremium);
    });
  }
});

// auditLog is platform + admin-only: every route must also mount requireAdminRole.
describe("entitlement gate — auditLog is admin-role gated", () => {
  it("auditLog.ts mounts requireAdminRole on all 3 premium routes", () => {
    const src = readRoute("auditLog.ts");
    // 3 route mounts + 1 import = 4 occurrences.
    expect(count(src, "requireAdminRole")).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 1b. Bucket B (Intelligence-Brief surface) — STAYS standard, never premium.
//     Map value = exact `requireEntitlement("standard")` occurrence count.
// ---------------------------------------------------------------------------
const BUCKET_B_STANDARD: Record<string, number> = {
  "intelligenceBriefs.ts": 8,
  "intelligence.ts": 1,
  "subscribers.ts": 1,
  "newsletterDeliveries.ts": 1,
  "topRisks.ts": 1,
  "dashboard.ts": 1,
};

describe("entitlement gate — Bucket B (brief surface) stays standard, never premium", () => {
  for (const [file, expectedStandard] of Object.entries(BUCKET_B_STANDARD)) {
    it(`${file}: ${expectedStandard} standard, zero premium`, () => {
      const src = readRoute(file);
      expect(count(src, STD)).toBe(expectedStandard);
      expect(count(src, PREM)).toBe(0);
    });
  }
});

// ---------------------------------------------------------------------------
// 1c. Carve-outs — deliberately NOT flipped by PR 1.
//     posture.ts: rank-2 dashboard consumes /posture/history → stays standard,
//       moves with the separate dashboard/summary payload-shaping task.
//     topRisksSummary.ts: free-preview, stays starter.
//     sso.ts: federation surface, stays professional (do not tier-gate blind).
// ---------------------------------------------------------------------------
describe("entitlement gate — carve-outs unchanged by the platform flip", () => {
  it("posture.ts stays standard (4), zero premium", () => {
    const src = readRoute("posture.ts");
    expect(count(src, STD)).toBe(4);
    expect(count(src, PREM)).toBe(0);
  });

  it("topRisksSummary.ts stays starter (1)", () => {
    const src = readRoute("topRisksSummary.ts");
    expect(count(src, STARTER)).toBe(1);
    expect(count(src, PREM)).toBe(0);
  });

  it("sso.ts stays professional (1)", () => {
    const src = readRoute("sso.ts");
    expect(count(src, PROF)).toBe(1);
    expect(count(src, PREM)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Behavioral — the real requireEntitlement gate.
// ---------------------------------------------------------------------------
function makeReq(orgContext: unknown): Request {
  return { organizationContext: orgContext } as unknown as Request;
}

function makeRes(): {
  res: Response;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
} {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status } as unknown as Response;
  return { res, status, json };
}

describe("requireEntitlement('premium') — behavioral", () => {
  // rank-2: the $39 Brief-Pro tier must be locked out of the platform surface.
  for (const level of ["standard", "professional"] as const) {
    it(`rank-2 '${level}' key gets 403 insufficient_entitlement`, () => {
      const req = makeReq({ entitlementLevel: level });
      const { res, status, json } = makeRes();
      const next = vi.fn() as NextFunction;

      requireEntitlement("premium")(req, res, next);

      expect(status).toHaveBeenCalledWith(403);
      expect(json).toHaveBeenCalledWith({
        error: "insufficient_entitlement",
        required: "premium",
        current: "professional",
      });
      expect(next).not.toHaveBeenCalled();
    });
  }

  // rank-4: Platform / Team / premium pass through to the handler.
  for (const level of ["premium", "platform", "team"] as const) {
    it(`rank-4 '${level}' key passes the gate`, () => {
      const req = makeReq({ entitlementLevel: level });
      const { res } = makeRes();
      const next = vi.fn() as NextFunction;

      requireEntitlement("premium")(req, res, next);

      expect(next).toHaveBeenCalledOnce();
    });
  }

  it("null entitlement (starter fallback) is locked out", () => {
    const req = makeReq({ entitlementLevel: null });
    const { res, status } = makeRes();
    const next = vi.fn() as NextFunction;

    requireEntitlement("premium")(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. cyberSignals fetch/reprocess — rejects a rank-2 customer key.
//    PR 1 flips these system/operator routes to premium (closing the rank-2
//    leak). NOTE: a full "not customer-callable" relocation to admin/system
//    auth is deferred (org-context dependency); see PR description.
// ---------------------------------------------------------------------------
describe("cyberSignals fetch/reprocess — premium-gated, rejects rank-2", () => {
  const CYBER_SOURCE = readRoute("cyberSignals.ts");

  const FETCH_ROUTES = [
    "/cyber-signals/fetch/cisa-kev",
    "/cyber-signals/fetch/nvd",
    "/cyber-signals/fetch/sec-edgar",
    "/cyber-signals/fetch/federal-register",
    "/cyber-signals/fetch/cisa-alerts",
    "/cyber-signals/fetch/threat-intel-rss",
    "/cyber-signals/fetch/regulatory",
    "/cyber-signals/fetch/mitre-attack",
    "/cyber-signals/fetch/mitre-atlas",
    "/cyber-signals/:id/reprocess",
  ];

  it("all 9 fetch routes + reprocess are present and the file has zero standard gates", () => {
    for (const route of FETCH_ROUTES) {
      expect(CYBER_SOURCE).toContain(`"${route}"`);
    }
    expect(count(CYBER_SOURCE, STD)).toBe(0);
  });

  it("a rank-2 customer key is rejected by the premium gate the fetch routes mount", () => {
    const req = makeReq({ entitlementLevel: "professional" });
    const { res, status } = makeRes();
    const next = vi.fn() as NextFunction;

    requireEntitlement("premium")(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
