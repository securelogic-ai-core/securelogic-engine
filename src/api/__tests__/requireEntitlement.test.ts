import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { requireEntitlement } from "../middleware/requireEntitlement.js";

function makeReq(orgContext: any): Request {
  return { organizationContext: orgContext } as unknown as Request;
}

function makeRes(): { res: Response; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status } as unknown as Response;
  return { res, status, json };
}

describe("requireEntitlement", () => {
  it("returns 401 when organizationContext is missing (programming error)", () => {
    const req = { } as unknown as Request;
    const { res, status, json } = makeRes();
    const next = vi.fn() as NextFunction;

    requireEntitlement("standard")(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: "api_key_required" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when current entitlement is below required", () => {
    const req = makeReq({ entitlementLevel: "starter" });
    const { res, status, json } = makeRes();
    const next = vi.fn() as NextFunction;

    requireEntitlement("premium")(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      error: "insufficient_entitlement",
      required: "premium",
      current: "starter",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when current entitlement matches required", () => {
    const req = makeReq({ entitlementLevel: "premium" });
    const { res } = makeRes();
    const next = vi.fn() as NextFunction;

    requireEntitlement("premium")(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("calls next() when current entitlement exceeds required", () => {
    const req = makeReq({ entitlementLevel: "premium" });
    const { res } = makeRes();
    const next = vi.fn() as NextFunction;

    requireEntitlement("standard")(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("treats 'platform' as premium (alias)", () => {
    const req = makeReq({ entitlementLevel: "platform" });
    const { res } = makeRes();
    const next = vi.fn() as NextFunction;

    requireEntitlement("premium")(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("treats 'team' as premium (alias)", () => {
    const req = makeReq({ entitlementLevel: "team" });
    const { res } = makeRes();
    const next = vi.fn() as NextFunction;

    requireEntitlement("premium")(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("treats 'standard' and 'professional' as equal rank", () => {
    const reqStd = makeReq({ entitlementLevel: "standard" });
    const reqPro = makeReq({ entitlementLevel: "professional" });
    const { res } = makeRes();

    const stdNext = vi.fn() as NextFunction;
    const proNext = vi.fn() as NextFunction;

    requireEntitlement("professional")(reqStd, res, stdNext);
    requireEntitlement("standard")(reqPro, res, proNext);

    expect(stdNext).toHaveBeenCalledOnce();
    expect(proNext).toHaveBeenCalledOnce();
  });

  it("falls back to 'starter' when entitlementLevel is null", () => {
    const req = makeReq({ entitlementLevel: null });
    const { res, status } = makeRes();
    const next = vi.fn() as NextFunction;

    requireEntitlement("premium")(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
