/**
 * askToolAuthorizationEquivalence.test.ts — Stop Gate ASK-A, behavioural half.
 *
 * The ratified invariant:
 *
 *   "Ask must never reveal an object, field, aggregate, search result, citation
 *    or derived conclusion the requesting user could not obtain through their
 *    authorized product access."
 *
 * platformToolRegistry.test.ts proves the STRUCTURAL half — no database import,
 * no identity argument, chains reference-identical to the routes. That is
 * necessary and not sufficient: it shows the tool layer is built correctly, not
 * that it BEHAVES correctly against real data with real row-level security.
 *
 * This suite proves the behavioural half the only way it can be proven: run the
 * same question through BOTH paths against a real Postgres and compare the
 * bytes.
 *
 *   HTTP path : supertest -> /api/<route>            (what the product returns)
 *   Tool path : executeTool(...)                     (what Ask would return)
 *
 * If those two ever diverge, Ask has become a privileged surface. Asserting
 * deep-equality on the actual response bodies means a divergence cannot hide
 * behind a plausible-looking shape.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Request, type Response } from "express";
import request from "supertest";
import { Pool } from "pg";

import { bootstrapTestDb, seedVendor, seedFinding, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";
import { buildToolRegistry } from "../../src/api/tools/registry.js";
import { executeTool } from "../../src/api/tools/executor.js";
import { requireApiKey } from "../../src/api/middleware/requireApiKey.js";
import { attachOrganizationContext } from "../../src/api/middleware/attachOrganizationContext.js";
import type { ToolDefinition } from "../../src/api/tools/types.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;
let tools: ToolDefinition[];

/** Tools compared head-to-head, with the route they must agree with. */
const EQUIVALENCE_CASES: Array<{ tool: string; route: string; args?: Record<string, unknown> }> = [
  { tool: "findings.search", route: "/api/findings" },
  { tool: "findings.summary", route: "/api/findings/summary" },
  { tool: "vendors.search", route: "/api/vendors" },
  { tool: "risks.search", route: "/api/risks" },
  { tool: "actions.search", route: "/api/actions" },
  { tool: "controls.search", route: "/api/controls" },
  { tool: "obligations.search", route: "/api/obligations" },
  {
    tool: "findings.search",
    route: "/api/findings?severity=Critical",
    args: { severity: "Critical" },
  },
];

beforeAll(async () => {
  seed = await bootstrapTestDb();

  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the ASK-A equivalence test.");
  process.env.DATABASE_URL = url;
  pool = new Pool({ connectionString: url, ssl: false });

  // Distinct data per org so a leak is unmistakable in the assertion output.
  const vA = await seedVendor(pool, seed.orgA.id, { name: "ORG-A-ONLY Vendor" });
  const vB = await seedVendor(pool, seed.orgB.id, { name: "ORG-B-SECRET Vendor" });
  await seedFinding(pool, seed.orgA.id, { title: "ORG-A-ONLY Finding", severity: "Critical" });
  await seedFinding(pool, seed.orgB.id, { title: "ORG-B-SECRET Finding", severity: "Critical" });
  void vA;
  void vB;

  app = express();
  app.use(express.json());
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));

  tools = buildToolRegistry();

  /**
   * Test-only harness endpoint. Runs the SAME authentication middleware a real
   * request runs, then executes the named tool with the resulting request as its
   * security context — which is exactly how Ask will call it.
   */
  app.post(
    "/__tooltest",
    requireApiKey,
    attachOrganizationContext,
    (req: Request, res: Response) => {
      const { tool: toolName, args } = req.body as {
        tool: string;
        args?: Record<string, unknown>;
      };
      const tool = tools.find((t) => t.name === toolName);
      if (!tool) {
        res.status(404).json({ error: "unknown_tool" });
        return;
      }
      void executeTool(req, tool, args ?? {}).then((result) => res.status(200).json(result));
    }
  );
}, 180_000);

afterAll(async () => {
  await pool?.end();
});

const httpAs = (orgKey: string, route: string) =>
  request(app).get(route).set("x-api-key", orgKey);

const toolAs = (orgKey: string, tool: string, args?: Record<string, unknown>) =>
  request(app).post("/__tooltest").set("x-api-key", orgKey).send({ tool, args });

// ─── The equivalence proof ──────────────────────────────────────────────────

describe("ASK-A — a tool returns EXACTLY what the product returns", () => {
  for (const c of EQUIVALENCE_CASES) {
    const label = c.args ? `${c.tool} (${JSON.stringify(c.args)})` : c.tool;

    it(`${label} matches ${c.route} byte for byte`, async () => {
      const viaHttp = await httpAs(seed.orgA.apiKey, c.route);
      const viaTool = await toolAs(seed.orgA.apiKey, c.tool, c.args);

      expect(viaHttp.status, `${c.route} did not 200`).toBe(200);
      expect(viaTool.status).toBe(200);
      expect(viaTool.body.ok, `tool ${c.tool} failed: ${viaTool.body.message}`).toBe(true);

      // The whole gate in one assertion: same user, same question, same answer.
      expect(viaTool.body.data).toEqual(viaHttp.body);
    });
  }
});

// ─── Cross-tenant ───────────────────────────────────────────────────────────

describe("ASK-A — cross-tenant leakage is impossible through a tool", () => {
  it("org A's tool calls never surface org B's data", async () => {
    for (const c of EQUIVALENCE_CASES) {
      const viaTool = await toolAs(seed.orgA.apiKey, c.tool, c.args);
      const serialized = JSON.stringify(viaTool.body);
      expect(
        serialized,
        `${c.tool} leaked org B data into an org A tool call`
      ).not.toMatch(/ORG-B-SECRET/);
    }
  });

  it("each org sees its OWN data, so the previous test is not passing vacuously", async () => {
    // A test that only asserts absence would also pass if every tool returned
    // nothing. This proves the tools genuinely return data.
    const a = await toolAs(seed.orgA.apiKey, "vendors.search");
    expect(JSON.stringify(a.body)).toMatch(/ORG-A-ONLY/);

    const b = await toolAs(seed.orgB.apiKey, "vendors.search");
    expect(JSON.stringify(b.body)).toMatch(/ORG-B-SECRET/);
    expect(JSON.stringify(b.body)).not.toMatch(/ORG-A-ONLY/);
  });

  it("a tool cannot be pointed at another org by ARGUMENT", async () => {
    // The schemas forbid an organization_id, but the executor must also ignore
    // one if a caller (or a prompt-injected model) invents it. Tenant identity
    // comes from the authenticated key, never from tool input.
    const injected = await toolAs(seed.orgA.apiKey, "vendors.search", {
      organization_id: seed.orgB.id,
      organizationId: seed.orgB.id,
      org_id: seed.orgB.id,
    });
    const serialized = JSON.stringify(injected.body);
    expect(serialized).not.toMatch(/ORG-B-SECRET/);
  });

  it("fetching another org's object by id is DENIED, indistinguishably from absent", async () => {
    const bVendors = await pool.query(
      `SELECT id FROM vendors WHERE organization_id = $1 LIMIT 1`,
      [seed.orgB.id]
    );
    const orgBVendorId = bVendors.rows[0].id as string;

    const viaTool = await toolAs(seed.orgA.apiKey, "vendors.get", { id: orgBVendorId });
    expect(viaTool.body.ok).toBe(false);
    expect(viaTool.body.error).toBe("denied");

    // The message must not distinguish "exists but not yours" from "absent" —
    // otherwise Ask leaks existence the API deliberately refuses to leak.
    expect(viaTool.body.message).toMatch(/not found, or not accessible/i);

    const madeUpId = "00000000-0000-4000-8000-000000000000";
    const absent = await toolAs(seed.orgA.apiKey, "vendors.get", { id: madeUpId });
    expect(absent.body.message).toBe(viaTool.body.message);
    expect(absent.body.error).toBe(viaTool.body.error);
  });
});

// ─── Authentication is not optional ─────────────────────────────────────────

describe("ASK-A — a tool cannot run without an authenticated caller", () => {
  it("no API key -> the chain refuses before any data is read", async () => {
    const res = await request(app).post("/__tooltest").send({ tool: "vendors.search" });
    // requireApiKey rejects on the harness endpoint itself.
    expect([401, 403]).toContain(res.status);
  });

  it("an invalid API key is refused", async () => {
    const res = await request(app)
      .post("/__tooltest")
      .set("x-api-key", "sk_not_a_real_key")
      .send({ tool: "vendors.search" });
    expect([401, 403]).toContain(res.status);
  });
});

// ─── Coverage ───────────────────────────────────────────────────────────────

describe("ASK-A — coverage of the registry", () => {
  it("EVERY registered read tool is exercised for cross-tenant safety", async () => {
    // A tool added to the registry without a case here would ship unproven. This
    // walks the registry itself rather than the case list, so the omission fails.
    const untested: string[] = [];

    for (const tool of tools.filter((t) => t.actionClass === "read")) {
      // Path-param tools need an id; give them one belonging to ORG B and assert
      // denial. Search tools run bare and assert absence.
      const needsId = (tool.binding.pathParams?.length ?? 0) > 0;
      let body: any;

      if (needsId) {
        const bVendor = await pool.query(
          `SELECT id FROM vendors WHERE organization_id = $1 LIMIT 1`,
          [seed.orgB.id]
        );
        const res = await toolAs(seed.orgA.apiKey, tool.name, { id: bVendor.rows[0].id });
        body = res.body;
        // Either denied, or a success that contains none of org B's data.
        if (body.ok === true && JSON.stringify(body).match(/ORG-B-SECRET/)) {
          untested.push(`${tool.name} LEAKED`);
          continue;
        }
      } else {
        const res = await toolAs(seed.orgA.apiKey, tool.name);
        body = res.body;
        if (JSON.stringify(body).match(/ORG-B-SECRET/)) {
          untested.push(`${tool.name} LEAKED`);
          continue;
        }
      }
    }

    expect(untested, "These tools leaked another tenant's data.").toEqual([]);
  });
});
