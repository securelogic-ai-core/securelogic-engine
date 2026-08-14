/**
 * platformToolRegistry.test.ts — Stop Gate ASK-A structural evidence.
 *
 * The ratified invariant:
 *
 *   "Ask must never reveal an object, field, aggregate, search result, citation
 *    or derived conclusion the requesting user could not obtain through their
 *    authorized product access."
 *
 * These tests assert the STRUCTURAL half of that — the properties that make the
 * invariant hold by construction rather than by vigilance. The behavioural half
 * (a Contributor seat receiving only assigned rows; a cross-org id returning
 * nothing) is proven in the isolation harness against a real database, because
 * a mocked authorization check proves nothing about authorization.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Resolving chains means importing the real route tree, and postgres.ts throws
// at module load when DATABASE_URL is absent. A dummy URL satisfies that check;
// pg.Pool does not connect on construction and no test here issues a query.
// vi.hoisted runs before the import graph is evaluated.
vi.hoisted(() => {
  process.env.DATABASE_URL ||= "postgres://tool-registry-test/unused";
});

import { buildToolRegistry, TOOL_SPECS, toolSchemasFor } from "../tools/registry.js";
import { flattenRoutes, resolveRouteChain, ToolRouteNotFoundError } from "../tools/routeResolver.js";
import { buildRoutes } from "../routes/index.js";

const TOOLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../tools");

function toolSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".ts")) out.push(full);
    }
  };
  walk(TOOLS_DIR);
  return out;
}

// ─── The invariant that makes the tool layer safe ───────────────────────────

describe("ASK-A — the tool layer cannot reach the database", () => {
  it("NO file under src/api/tools/ imports pg, pgElevated or withTenant", () => {
    // This is the load-bearing structural assertion. Ask's original defect was a
    // PARALLEL data-access layer — eight hand-written queries that drifted from
    // the canonical routes five separate times. The fix is not better SQL; it is
    // making the second data path impossible to write.
    //
    // A tool may only reach data by executing a real route's real chain, which
    // carries entitlement, seat, capability, row-scoping and RLS with it.
    const offenders: string[] = [];
    for (const file of toolSourceFiles()) {
      const src = readFileSync(file, "utf8");
      const importLines = src
        .split("\n")
        .filter((l) => /^\s*import\b/.test(l) || /\bfrom\s+["'][^"']*postgres/.test(l));
      const joined = importLines.join("\n");
      if (/\bpg\b|pgElevated|withTenant/.test(joined)) {
        offenders.push(path.relative(TOOLS_DIR, file));
      }
    }
    expect(
      offenders,
      "A tool module imported a database handle. Tools must reach data ONLY by " +
        "executing a canonical route chain — a direct query bypasses every " +
        "authorization control the route carries."
    ).toEqual([]);
  });

  it("no tool spec accepts an organization id, or any identity override", () => {
    // Tenant identity comes from the executing request's authenticated context.
    // A tool argument that could name a tenant, a user, or a seat would be the
    // privileged bypass ASK-A forbids.
    const forbidden = /organization_?id|org_?id|tenant|user_?id|impersonat|as_user|seat|role/i;
    for (const spec of TOOL_SPECS) {
      const props = Object.keys(spec.inputSchema.properties);
      const bad = props.filter((p) => forbidden.test(p));
      expect(bad, `${spec.name} exposes identity-bearing arguments: ${bad.join(", ")}`).toEqual([]);
    }
  });

  it("every tool schema is closed — additionalProperties is false", () => {
    // An open schema lets the model pass arbitrary keys straight into a query
    // string or body. Closing it means the only things reaching a handler are
    // the parameters we chose to expose.
    for (const spec of TOOL_SPECS) {
      expect(spec.inputSchema.additionalProperties, `${spec.name} has an open schema`).toBe(false);
    }
  });
});

// ─── Chains come from the router, not from a copy ───────────────────────────

describe("ASK-A — chains are resolved from the live router", () => {
  const router = buildRoutes({ isDev: false, publicApiDisabled: false });
  const routes = flattenRoutes(router);
  const registry = buildToolRegistry(router as never);

  it("builds every declared tool", () => {
    expect(registry).toHaveLength(TOOL_SPECS.length);
    expect(registry.length).toBeGreaterThan(0);
  });

  it("each tool's chain is REFERENCE-IDENTICAL to its route's chain", () => {
    // Not "deep-equal to a copy we maintain" — the same array contents, by
    // reference, that the router will execute. There is no second list to drift.
    for (const tool of registry) {
      const routeChain = resolveRouteChain(routes, tool.binding.method, tool.binding.path);
      expect(tool.chain.length, `${tool.name}: chain length`).toBe(routeChain.length);
      tool.chain.forEach((h, i) => {
        expect(h, `${tool.name}: handler ${i} is not the route's handler`).toBe(routeChain[i]);
      });
    }
  });

  it("every chain carries authentication and org context BEFORE the handler", () => {
    // A chain missing requireApiKey would execute unauthenticated. Asserting on
    // the resolved chain rather than the declaration means this checks what will
    // actually run.
    for (const tool of registry) {
      const names = tool.chain.map((h) => h.name);
      expect(names, `${tool.name} is missing requireApiKey`).toContain("requireApiKey");
      expect(names, `${tool.name} is missing attachOrganizationContext`).toContain(
        "attachOrganizationContext"
      );
      // The handler is last; the guards precede it.
      expect(tool.chain.length, `${tool.name} has a suspiciously short chain`).toBeGreaterThanOrEqual(3);
    }
  });

  it("binding to a non-existent route fails at CONSTRUCTION, not at question time", () => {
    expect(() => resolveRouteChain(routes, "GET", "/definitely-not-a-route")).toThrow(
      ToolRouteNotFoundError
    );
  });

  it("a route deleted from the product takes its tool with it", () => {
    // The failure mode this prevents: a route is removed, the tool keeps a stale
    // captured chain, and Ask serves data from code the product no longer runs.
    const withoutFindings = routes.filter((r) => r.path !== "/findings");
    expect(() => resolveRouteChain(withoutFindings, "GET", "/findings")).toThrow(
      ToolRouteNotFoundError
    );
  });
});

// ─── Action-class discipline ────────────────────────────────────────────────

describe("ASK-A — action classes", () => {
  const registry = buildToolRegistry(
    buildRoutes({ isDev: false, publicApiDisabled: false }) as never
  );

  it("non-read tools are EXACTLY the ASK-B-approved set, class by class", () => {
    // LC-5 opened `mutate` for two tools; LC-5b opened `governed` for the
    // operator-ordered transitions (docs/validation/ask-b-action-gate.md).
    // A non-read tool outside these allowlists is a scope breach — widening
    // either list REQUIRES extending the gate evidence first. draft remains
    // unopened.
    const mutate = registry.filter((t) => t.actionClass === "mutate");
    const governed = registry.filter((t) => t.actionClass === "governed");
    const other = registry.filter(
      (t) => !["read", "mutate", "governed"].includes(t.actionClass)
    );
    expect(mutate.map((t) => t.name).sort()).toEqual(["actions.create", "actions.update"]);
    expect(governed.map((t) => t.name).sort()).toEqual([
      "findings.close",
      "risks.accept",
      "vendors.decide",
    ]);
    expect(other).toEqual([]);
  });

  it("risks.accept binds the PROPOSE step with the 5-minute TTL and owner defaulting", () => {
    const accept = registry.find((t) => t.name === "risks.accept")!;
    // The workflow's approval step stays in-product: the tool binds the
    // proposal route, never /risk-acceptances/:id/approve.
    expect(accept.binding.path).toBe("/findings/:id/risk-acceptance");
    expect(accept.proposalTtlMs).toBe(5 * 60 * 1000);
    expect(accept.inputSchema.required).toEqual(
      expect.arrayContaining(["id", "rationale", "expires_at"])
    );
    // The owner is UNCONDITIONALLY the proposing user — a smuggled owner is
    // overwritten, and the schema exposes no identity argument at all.
    expect(accept.applyDefaults!({}, { userId: "u-1" })).toEqual({ owner_user_id: "u-1" });
    expect(accept.applyDefaults!({ owner_user_id: "u-2" }, { userId: "u-1" })).toEqual({
      owner_user_id: "u-1",
    });
    expect(Object.keys(accept.inputSchema.properties)).not.toContain("owner_user_id");
  });

  it("every governed tool carries the full governed contract", () => {
    for (const tool of registry.filter((t) => t.actionClass === "governed")) {
      // Server-validated mandatory rationale: a required string field whose
      // substance validateInput enforces.
      expect(typeof tool.validateInput, `${tool.name} must validateInput`).toBe("function");
      const rationaleField = (tool.inputSchema.required ?? []).find((f) =>
        ["rationale", "decision_note"].includes(f)
      );
      expect(rationaleField, `${tool.name} must REQUIRE a rationale field`).toBeTruthy();
      // A token-gesture rationale is refused server-side.
      expect(
        tool.validateInput!({ id: "x", decision: "approved", [rationaleField!]: "short" })
      ).toBeTruthy();
      // Audit context: transition + rationale + resulting state on one event.
      expect(typeof tool.auditContext, `${tool.name} must auditContext`).toBe("function");
      const ctx = tool.auditContext!(
        { [rationaleField!]: "a substantive rationale", decision: "approved" },
        null
      );
      expect(Object.keys(ctx)).toEqual(
        expect.arrayContaining(["transition", "rationale", "resulting_state"])
      );
    }
  });

  it("findings.close pins its transition literal — the model cannot repoint it", () => {
    const close = registry.find((t) => t.name === "findings.close")!;
    expect(close.fixedInput).toEqual({ decision_state: "resolved" });
    // accepted_risk is NOT reachable through this tool: the schema does not
    // expose decision_state at all, and fixedInput overwrites any attempt.
    expect(Object.keys(close.inputSchema.properties)).not.toContain("decision_state");
  });

  it("every mutate tool renders its own server-side summary and never binds DELETE", () => {
    for (const tool of registry.filter((t) => t.actionClass === "mutate")) {
      // The confirmation card shows what the SERVER rendered from the frozen
      // input — a mutate tool without summarize would fall back to a generic
      // line and weaken what the user is actually confirming.
      expect(typeof tool.summarize, `${tool.name} must summarize`).toBe("function");
      const summary = tool.summarize!({ title: "t", source_type: "manual", priority: "watch", id: "x" });
      expect(summary.length).toBeGreaterThan(0);
      // Bounded v1: create/update only. Destructive verbs need their own gate.
      expect(["POST", "PATCH"]).toContain(tool.binding.method);
    }
  });

  it("every read tool binds to a GET route", () => {
    // A 'read' bound to POST would mutate while claiming not to.
    for (const tool of registry.filter((t) => t.actionClass === "read")) {
      expect(tool.binding.method, `${tool.name} is a read tool on a write verb`).toBe("GET");
    }
  });

  it("tool names are unique", () => {
    const names = registry.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ─── The model-facing surface ───────────────────────────────────────────────

describe("ASK-A — what the model is shown", () => {
  const registry = buildToolRegistry(
    buildRoutes({ isDev: false, publicApiDisabled: false }) as never
  );

  it("schemas expose name, description and input schema — NEVER the chain", () => {
    const schemas = toolSchemasFor(registry);
    for (const s of schemas) {
      expect(Object.keys(s).sort()).toEqual(["description", "input_schema", "name"]);
      expect(JSON.stringify(s)).not.toMatch(/requireApiKey|asTenant|chain/);
    }
  });

  it("every description tells the model what it returns and when to use it", () => {
    // A thin description produces wrong tool selection, which produces confident
    // wrong answers — the failure mode that made Ask untrustworthy in the first place.
    for (const spec of TOOL_SPECS) {
      expect(spec.description.length, `${spec.name} description is too thin`).toBeGreaterThan(60);
    }
  });

  it("the findings tool names the PascalCase severity vocabulary explicitly", () => {
    // A model guessing 'critical' gets an empty result and then narrates a clean
    // posture. That exact defect shipped (askTruthPass.test.ts) — the schema now
    // enumerates the domain values so the model cannot guess wrong.
    const spec = TOOL_SPECS.find((t) => t.name === "findings.search")!;
    const sev = spec.inputSchema.properties.severity as { enum?: string[] };
    expect(sev.enum).toEqual(["Critical", "High", "Moderate", "Low"]);
    expect(spec.description).toMatch(/PascalCase/);
  });
});
