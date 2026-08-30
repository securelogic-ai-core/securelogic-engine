/**
 * vendorAssuranceTenantWrapCoverage.test.ts — the structural guard behind
 * A04-G1's standing rule:
 *
 *     POLICY ⟹ ROUTES WRAPPED
 *
 * An RLS policy on a table whose routes are NOT tenant-scoped is a latent
 * zero-rows hazard: today the engine connects as the owner and bypasses RLS, so
 * an unscoped query looks fine; the day DATABASE_URL is repointed to
 * `app_request`, that same query silently returns nothing. The failure is
 * invisible in review and invisible in staging until the flip.
 *
 * `vendorAssuranceDocuments.ts` shipped 18 routes with ZERO tenant scoping, so
 * RLS could not land on any of the seven `vendor_assurance_*` tables. This test
 * is what keeps that closed once it is fixed: every route must be scoped by ONE
 * of two mechanisms, and a new route added with neither fails the build.
 *
 *   1. `asTenant(handler)` at the router — for handlers that only ever end in
 *      status()+json(). asTenant buffers the response and replays it after
 *      COMMIT, so it CANNOT wrap a handler that streams, sets headers, or
 *      redirects (deferredResponse throws on those).
 *
 *   2. explicit `withTenant(orgId, …)` inside the handler — required when the
 *      handler streams/redirects, performs long external I/O (R2, LLM), or
 *      already opens its own scope. `withTenant` takes a FRESH pool connection
 *      per call, so wrapping such a handler in asTenant as well would
 *      double-connect and nest a second transaction for no benefit.
 *
 * The allowlist below is deliberately explicit: adding a handler to it is a
 * visible decision with a stated reason, not a silent omission.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SOURCE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../routes/vendorAssuranceDocuments.ts"
);
const SOURCE = readFileSync(SOURCE_PATH, "utf8");

/** Everything after this marker is the router-wiring block. */
const ROUTER_BLOCK = SOURCE.slice(SOURCE.indexOf("// Router wiring"));

/**
 * Handlers that scope EXPLICITLY with withTenant instead of an asTenant wrap.
 * Each entry records WHY — an entry without a reason is a code smell, and a new
 * entry should be challenged in review.
 */
const EXPLICIT_WITH_TENANT: Record<string, string> = {
  uploadVendorAssuranceDocument:
    "streams file bytes to R2 mid-handler; scopes bracket the put so no connection is held across external I/O",
  getVendorAssurancePdfRedirect:
    "ends in a 302 redirect — asTenant's buffering proxy throws on anything but status()+json()",
  getVendorAssuranceCuecs:
    "already opens its own scope for loadCuecsWithMappings; an outer wrap would double-connect",
  rematchVendorAssuranceCuecs:
    "calls the LLM CUEC matcher (multi-second); commit-then-compute, never a tx held across the model call",
  exportVendorAssuranceDocumentXlsx:
    "sets Content-Type/Content-Disposition and sends a rendered buffer — streaming, cannot be asTenant-wrapped",
  exportVendorAssuranceDocumentPdf:
    "sets Content-Type/Content-Disposition and sends a rendered buffer — streaming, cannot be asTenant-wrapped",
};

/** Extract `router.<verb>( "<path>", …, <finalArg> );` registrations. */
function parseRegistrations(): Array<{ method: string; route: string; block: string }> {
  const out: Array<{ method: string; route: string; block: string }> = [];
  const re = /router\.(get|post|patch|put|delete)\(\s*\n?\s*"([^"]+)"([\s\S]*?)\n\);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ROUTER_BLOCK)) !== null) {
    out.push({ method: m[1]!.toUpperCase(), route: m[2]!, block: m[3]! });
  }
  return out;
}

const REGISTRATIONS = parseRegistrations();

/** The handler identifier passed as the final argument of a registration. */
function finalHandlerName(block: string): string | null {
  const cleaned = block
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim())
    .filter(Boolean)
    .join("\n");
  const parts = cleaned.split(",").map((p) => p.trim()).filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  const wrapped = last.match(/^asTenant\(([A-Za-z0-9_]+)\)$/);
  if (wrapped) return wrapped[1]!;
  const bare = last.match(/^([A-Za-z0-9_]+)$/);
  return bare ? bare[1]! : null;
}

describe("vendor-assurance routes — A04-G1 tenant-wrap coverage", () => {
  it("parses every route registration in the file", () => {
    // 21 routes: 18 from the Phase 0 audit, plus VA-1's
    // POST /vendor-assurance/cuecs/:cuecId/promote-to-finding, plus VA-S4-P2's
    // GET and POST /vendor-assurance/documents/:id/assurance-opinion. If this
    // number changes, the new route must also satisfy the coverage assertion
    // below — that is the point, and all three later routes are asTenant-wrapped
    // like the rest.
    expect(REGISTRATIONS.length).toBe(21);
  });

  it("EVERY route is tenant-scoped — by asTenant, or by a justified explicit withTenant", () => {
    const unscoped: string[] = [];

    for (const reg of REGISTRATIONS) {
      const handler = finalHandlerName(reg.block);
      expect(handler, `could not parse handler for ${reg.method} ${reg.route}`).toBeTruthy();

      const isAsTenantWrapped = /asTenant\(/.test(reg.block);
      const isExplicit = Object.prototype.hasOwnProperty.call(
        EXPLICIT_WITH_TENANT,
        handler as string
      );

      if (!isAsTenantWrapped && !isExplicit) {
        unscoped.push(`${reg.method} ${reg.route} -> ${handler}`);
      }
    }

    expect(
      unscoped,
      "These routes touch vendor_assurance_* with NO tenant scope. Adding an RLS " +
        "policy while they exist creates a silent zero-rows failure at the " +
        "app_request flip. Wrap with asTenant(), or scope explicitly with " +
        "withTenant() and add a justified entry to EXPLICIT_WITH_TENANT."
    ).toEqual([]);
  });

  it("every EXPLICIT_WITH_TENANT handler actually calls withTenant", () => {
    // Guards the inverse mistake: allowlisting a handler to skip asTenant and
    // then never adding the explicit scope, which would look intentional.
    //
    // Follows ONE level of delegation: the two export routes are thin arity
    // adapters over exportVendorAssuranceDocumentInternal, which is where the
    // scope lives. Resolving the delegate checks the EFFECTIVE scoping rather
    // than mere textual presence in the named function — the alternative would
    // be to weaken the assertion, which defeats its purpose.
    const bodyOf = (fnName: string): string | null => {
      const start = SOURCE.indexOf(`function ${fnName}(`);
      if (start === -1) return null;
      const rest = SOURCE.slice(start + 1);
      const nextFn = rest.search(/\n(?:export )?async function /);
      return nextFn === -1 ? rest : rest.slice(0, nextFn);
    };

    const missing: string[] = [];
    for (const handler of Object.keys(EXPLICIT_WITH_TENANT)) {
      const body = bodyOf(handler);
      if (body === null) {
        missing.push(`${handler} (not found in source)`);
        continue;
      }
      if (/withTenant\(/.test(body)) continue;

      // Delegation: `await someOtherFn(req, res, …)` in the same module.
      const delegate = body.match(/await\s+([A-Za-z0-9_]+)\(\s*req\s*,\s*res\b/);
      const delegateBody = delegate ? bodyOf(delegate[1]!) : null;
      if (delegateBody && /withTenant\(/.test(delegateBody)) continue;

      missing.push(handler);
    }
    expect(
      missing,
      "Allowlisted as explicitly scoped, but neither the handler nor the function " +
        "it delegates to calls withTenant()."
    ).toEqual([]);
  });

  it("no allowlisted handler is ALSO asTenant-wrapped (double-connect)", () => {
    // withTenant takes a fresh pool connection and opens its own transaction,
    // so an outer asTenant wrap would hold two connections per request.
    const doubled: string[] = [];
    for (const reg of REGISTRATIONS) {
      const handler = finalHandlerName(reg.block);
      if (
        handler &&
        Object.prototype.hasOwnProperty.call(EXPLICIT_WITH_TENANT, handler) &&
        /asTenant\(/.test(reg.block)
      ) {
        doubled.push(`${reg.method} ${reg.route} -> ${handler}`);
      }
    }
    expect(doubled).toEqual([]);
  });

  it("every allowlist entry carries a non-empty justification", () => {
    for (const [handler, reason] of Object.entries(EXPLICIT_WITH_TENANT)) {
      expect(reason.trim().length, `${handler} has no stated reason`).toBeGreaterThan(20);
    }
  });

  it("no handler reads organization_id from the request body", () => {
    // Tenant identity comes from req.organizationContext (set by
    // attachOrganizationContext from the authenticated API key), never from
    // caller-supplied input. A body-sourced org id is a cross-tenant write.
    expect(SOURCE).not.toMatch(/req\.body\s*\.\s*organization_id/);
    expect(SOURCE).not.toMatch(/body\[["']organization_id["']\]/);
  });
});
