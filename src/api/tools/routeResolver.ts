/**
 * routeResolver.ts — resolves a tool's middleware chain FROM THE LIVE ROUTER.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS INSTEAD OF DECLARING CHAINS BY HAND
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The ratified ASK-A invariant is that Ask must be INCAPABLE of returning
 * something the product would not. A hand-declared chain gets you close: you
 * copy the middleware list and write a test asserting it matches the route.
 * But that test can only catch drift it was taught to look for, and the failure
 * it is guarding against — someone adds `requireCapability("evidence:read")` to
 * a route and not to the tool — is exactly the kind a copied list invites.
 *
 * Resolving from the router removes the second list entirely. There is one
 * definition of "what runs for GET /findings", it lives in the route file, and
 * the tool executes that array. A middleware added to the route is in the tool
 * on the next boot, with no code change here and no test to remember.
 *
 * It also means tools cannot be bound to routes that do not exist: an unknown
 * (method, path) throws at registry construction — at boot, not at the moment a
 * customer asks a question.
 *
 * ── Why the handlers are safe to call directly ──────────────────────────────
 *
 * Express layers store the exact handler references the route registered,
 * INCLUDING wrappers like asTenant(...). Pulling `layer.route.stack[].handle`
 * therefore yields the real chain, wrappers intact — not the inner handler with
 * its tenant scope stripped off.
 */

import type { RequestHandler, Router } from "express";

/** Minimal shape of the Express layer internals we read. */
type ExpressLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
  handle?: { stack?: ExpressLayer[] };
};

export type ResolvedRoute = {
  method: string;
  path: string;
  chain: RequestHandler[];
};

/**
 * Flatten a built router into every (method, path, chain) it registers,
 * descending through nested routers mounted with `router.use(...)`.
 */
export function flattenRoutes(router: Router): ResolvedRoute[] {
  const out: ResolvedRoute[] = [];

  const walk = (layer: ExpressLayer): void => {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods)
        .filter((m) => layer.route!.methods[m])
        .map((m) => m.toUpperCase());
      const chain = layer.route.stack.map((s) => s.handle);
      for (const method of methods) {
        out.push({ method, path: layer.route.path, chain });
      }
      return;
    }
    const nested = layer.handle?.stack;
    if (nested) for (const l of nested) walk(l);
  };

  for (const l of (router as unknown as { stack: ExpressLayer[] }).stack) walk(l);
  return out;
}

export class ToolRouteNotFoundError extends Error {
  constructor(method: string, path: string) {
    super(
      `tool_route_not_found: no route registered for ${method} ${path}. A tool must ` +
        `bind to a route that actually exists — this fails at boot rather than at ` +
        `question time.`
    );
    this.name = "ToolRouteNotFoundError";
  }
}

/**
 * Resolve one route's chain. Throws when absent — a tool bound to a
 * non-existent route is a programming error, not a runtime condition.
 */
export function resolveRouteChain(
  routes: ResolvedRoute[],
  method: string,
  path: string
): RequestHandler[] {
  const match = routes.find((r) => r.method === method && r.path === path);
  if (!match) throw new ToolRouteNotFoundError(method, path);
  return match.chain;
}
