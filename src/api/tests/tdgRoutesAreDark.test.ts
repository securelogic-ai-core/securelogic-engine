/**
 * tdgRoutesAreDark.test.ts — the dark control, pinned at the declaration site.
 *
 * E-1 ships a capability that DESTROYS customer data. The operator's condition
 * for building it before authorization is that it cannot act until two gates
 * open, and the first of those gates is this flag. A route that forgot it would
 * be indistinguishable from one that never had it, so the property is asserted
 * over how the routes are DECLARED — the same approach as
 * askRoutesArePlatformOnly.test.ts, and for the same reason: a runtime test
 * would need the whole middleware stack and still would not prove the guard is
 * on every route.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { tdgFeatureFlag } from "../middleware/tdgFeatureFlag.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOV_SRC = readFileSync(resolve(__dirname, "../routes/dataGovernance.ts"), "utf8");
const ASK_SRC = readFileSync(resolve(__dirname, "../routes/ask.ts"), "utf8");

/** Each `router.<verb>(` block, up to the handler. */
function routeBlocks(src: string): Array<{ verb: string; path: string; chain: string }> {
  const blocks: Array<{ verb: string; path: string; chain: string }> = [];
  const re = /router\.(get|post|put|patch|delete)\(\s*"([^"]+)"([\s\S]*?)(?:async\s*\(|\(req)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    blocks.push({ verb: m[1]!, path: m[2]!, chain: m[3]! });
  }
  return blocks;
}

describe("every governance route is behind the dark control", () => {
  const routes = routeBlocks(GOV_SRC);

  it("declares the routes this package is supposed to declare", () => {
    expect(routes.length).toBeGreaterThanOrEqual(7);
    const paths = routes.map((r) => `${r.verb.toUpperCase()} ${r.path}`);
    expect(paths).toContain("PUT /governance/retention/:dataClass");
    expect(paths).toContain("POST /governance/holds");
    expect(paths).toContain("POST /governance/holds/:id/release");
    expect(paths).toContain("DELETE /governance/objects/:dataClass/:id");
  });

  it("gates every route on tdgFeatureFlag", () => {
    for (const r of routes) {
      expect(r.chain, `${r.verb} ${r.path} is not gated`).toMatch(/tdgFeatureFlag/);
    }
  });

  it("requires a JWT on every route — governance is never an API-key action", () => {
    for (const r of routes) {
      expect(r.chain, `${r.verb} ${r.path} lacks requireAuth`).toMatch(/requireAuth/);
    }
  });

  it("requires admin on every route that changes governance state or reads metadata", () => {
    const adminRequired = routes.filter(
      (r) => r.verb !== "get" || r.path.includes("/objects/") || r.path.includes("/holds") || r.path.includes("/preview")
    );
    expect(adminRequired.length).toBeGreaterThanOrEqual(5);
    for (const r of adminRequired) {
      expect(r.chain, `${r.verb} ${r.path} lacks requireAdminRole`).toMatch(/requireAdminRole/);
    }
  });
});

describe("the owner's delete carries the same gates as the reads beside it", () => {
  const del = routeBlocks(ASK_SRC).find(
    (r) => r.verb === "delete" && r.path === "/ask/conversations/:id"
  );

  it("exists", () => {
    expect(del).toBeDefined();
  });

  it("is gated on BOTH the Ask flag and the TDG dark control", () => {
    expect(del!.chain).toMatch(/askFeatureFlag/);
    expect(del!.chain).toMatch(/tdgFeatureFlag/);
  });

  it("keeps the entitlement and seat gates the conversation reads use", () => {
    expect(del!.chain).toMatch(/requireEntitlement\("premium"\)/);
    expect(del!.chain).toMatch(/denyContributor\(\)/);
  });

  it("routes the deletion through the shared governed path, not its own SQL", () => {
    expect(ASK_SRC).toMatch(/deleteGovernedObject\(/);
    // The one delete implementation lives in the service; a route writing its
    // own DELETE would bypass the hold check.
    const askDeleteRegion = ASK_SRC.slice(ASK_SRC.indexOf('router.delete(\n  "/ask/conversations/:id"'));
    expect(askDeleteRegion).not.toMatch(/DELETE FROM/);
  });
});

describe("the flag middleware itself", () => {
  function run(env: Record<string, string | undefined>) {
    const prev = process.env["SECURELOGIC_TENANT_DATA_GOVERNANCE_ENABLED"];
    if (env["SECURELOGIC_TENANT_DATA_GOVERNANCE_ENABLED"] === undefined) {
      delete process.env["SECURELOGIC_TENANT_DATA_GOVERNANCE_ENABLED"];
    } else {
      process.env["SECURELOGIC_TENANT_DATA_GOVERNANCE_ENABLED"] =
        env["SECURELOGIC_TENANT_DATA_GOVERNANCE_ENABLED"];
    }
    let status: number | null = null;
    let body: unknown = null;
    let nexted = false;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json(payload: unknown) {
        body = payload;
        return this;
      }
    };
    tdgFeatureFlag({} as never, res as never, () => {
      nexted = true;
    });
    if (prev === undefined) delete process.env["SECURELOGIC_TENANT_DATA_GOVERNANCE_ENABLED"];
    else process.env["SECURELOGIC_TENANT_DATA_GOVERNANCE_ENABLED"] = prev;
    return { status, body, nexted };
  }

  it("404s — not 403 — when off, so the capability is invisible rather than merely refused", () => {
    const r = run({});
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "not_found" });
    expect(r.nexted).toBe(false);
  });

  it("passes through only when the flag is exactly 'true'", () => {
    expect(run({ SECURELOGIC_TENANT_DATA_GOVERNANCE_ENABLED: "true" }).nexted).toBe(true);
    expect(run({ SECURELOGIC_TENANT_DATA_GOVERNANCE_ENABLED: "yes" }).nexted).toBe(false);
    expect(run({ SECURELOGIC_TENANT_DATA_GOVERNANCE_ENABLED: "1" }).nexted).toBe(false);
  });
});
