/**
 * requireSeat.ts — the seat-model enforcement seam.
 *
 * Modelled on corePlatformCapability.ts: a single feature flag
 * (SECURELOGIC_SEAT_MODEL_ENABLED) gates ALL seat enforcement. When OFF, every
 * gate here is a transparent passthrough — behaviour is byte-identical to the
 * pre-seat-model system, and the existing entitlement/role gates decide alone.
 * When ON, these gates enforce the resolved seat scope.
 *
 * There is deliberately no independent "licensing gate": every decision routes
 * through resolveScope (seatScope.ts). These middlewares only translate a
 * resolved scope into an allow/deny for a route.
 *
 * Denials use 403 with a stable `error` vocabulary. Class A default-deny for
 * Contributors returns 404 semantics at the DETAIL layer (handlers), but the
 * ROUTE-level Contributor denial here is a 403 (the route exists; the seat may
 * not use it) — matching requireEntitlement's contract.
 */

import type { Request, Response, NextFunction } from "express";
import { scopeFromRequest, type SeatScope, type Capability } from "../lib/seatScope.js";

export function seatModelEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_SEAT_MODEL_ENABLED"] === "true";
}

/**
 * Resolve the seat scope for a request. Pure over the request's attached
 * seat/role/org context — safe to call from a handler or a middleware. Absent
 * seat/role means API-key auth (admin-level full seat).
 */
export function getSeatScope(req: Request): SeatScope {
  return scopeFromRequest(req as unknown as Parameters<typeof scopeFromRequest>[0]);
}

/**
 * Class A default-deny: block Contributor seats from a route entirely. Full and
 * Viewer seats pass this gate (a Viewer's mutations are still blocked by the
 * global mutation chokepoint and by writeScope='none'). Flag-gated.
 */
export function denyContributor() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!seatModelEnabled()) {
      next();
      return;
    }
    const scope = getSeatScope(req);
    if (scope.seatType === "contributor") {
      res.status(403).json({
        error: "seat_not_permitted",
        detail: "This action requires a Full seat.",
      });
      return;
    }
    next();
  };
}

/**
 * Require a named capability (e.g. "export:data", "risk:accept",
 * "users:manage"). Flag-gated. When on, a missing capability 403s.
 */
export function requireCapability(capability: Capability) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!seatModelEnabled()) {
      next();
      return;
    }
    const scope = getSeatScope(req);
    if (!scope.capabilities.has(capability)) {
      res.status(403).json({
        error: "capability_required",
        required: capability,
      });
      return;
    }
    next();
  };
}
