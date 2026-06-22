/**
 * Vendor-surface entitlement gate — step 5 (spec §D / §E step 5).
 *
 * The vendor / third-party-risk surface is a Platform pillar and must gate at
 * rank 4 / premium, NOT rank 2 / standard (the $39 Brief-Pro tier — the
 * documented entitlement inversion this step fixes). This file pins that
 * contract two ways:
 *
 *   1. Source-assert — every requireEntitlement gate across the whole vendor /
 *      third-party-risk route surface mounts "premium", and ZERO "standard"
 *      gates remain. A future regression that re-introduces a "standard" gate on
 *      the vendor surface reddens CI here.
 *   2. Behavioral — exercises the actual requireEntitlement("premium") gate the
 *      routes now mount: a rank-2 key (professional/standard) gets
 *      403 insufficient_entitlement; a rank-4 key (premium/platform/team) passes.
 *
 * SCOPE NOTE: the step-5 deferred-scope boundary is now CLOSED. vendorAssessments.ts,
 * vendorReviews.ts, findings.ts, findingsExport.ts and vendorAssessmentAnalysis.ts —
 * left at rank-2 "standard" in step 5 (UI pages redirected rank-2 users, but their
 * APIs stayed rank-2-accessible to a direct API-key caller) — are flipped to
 * "premium" here and asserted below, completing the vendor-surface entitlement
 * alignment.
 */
import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { readFileSync } from "fs";
import { resolve } from "path";
import { requireEntitlement } from "../middleware/requireEntitlement.js";

// ---------------------------------------------------------------------------
// 1. Source-assert: the vendor route files gate at premium, never standard.
// ---------------------------------------------------------------------------
const VAD_SOURCE = readFileSync(
  resolve(__dirname, "../routes/vendorAssuranceDocuments.ts"),
  "utf8",
);
const VENDORS_SOURCE = readFileSync(
  resolve(__dirname, "../routes/vendors.ts"),
  "utf8",
);

// Step-5 deferred-scope files, flipped standard→premium in this change.
// [file, expected premium gate count] — each must also have zero "standard".
const PREMIUM_ROUTE_FILES: ReadonlyArray<readonly [string, number]> = [
  ["vendorAssessments.ts", 3],
  ["vendorReviews.ts", 4],
  ["findings.ts", 5],
  ["findingsExport.ts", 1],
  ["vendorAssessmentAnalysis.ts", 1],
];

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("vendor-surface entitlement gate — source", () => {
  it("vendorAssuranceDocuments.ts mounts premium on all 18 routes, zero standard", () => {
    expect(count(VAD_SOURCE, 'requireEntitlement("standard")')).toBe(0);
    // 18 route gates + 1 header doc-comment reference = 19 occurrences of premium.
    expect(count(VAD_SOURCE, 'requireEntitlement("premium")')).toBe(19);
  });

  it("vendors.ts mounts premium on all 8 routes, zero standard", () => {
    expect(count(VENDORS_SOURCE, 'requireEntitlement("standard")')).toBe(0);
    expect(count(VENDORS_SOURCE, 'requireEntitlement("premium")')).toBe(8);
  });

  // Step-5 deferred-scope files, now flipped to premium.
  for (const [file, premiumCount] of PREMIUM_ROUTE_FILES) {
    it(`${file} mounts premium on all ${premiumCount} route(s), zero standard`, () => {
      const source = readFileSync(resolve(__dirname, `../routes/${file}`), "utf8");
      expect(count(source, 'requireEntitlement("standard")')).toBe(0);
      expect(count(source, 'requireEntitlement("premium")')).toBe(premiumCount);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Behavioral: the premium gate the vendor routes now mount.
//    Mirrors requireEntitlement.test.ts against the vendor contract.
// ---------------------------------------------------------------------------
function makeReq(orgContext: any): Request {
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

describe("vendor-surface entitlement gate — behavioral (premium)", () => {
  // rank-2: the $39 Brief-Pro tier must be locked out of the vendor surface.
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
