/**
 * askRoutesCarryOrgCapabilityGate.test.ts — E-3 pinned at the declaration site.
 *
 * The org dimension of the Ask capability is enforced by requireOrgCapability
 * ("ask") in every Ask route chain. A route that forgot it would be
 * indistinguishable from one that never had it, so the property is asserted
 * over how the routes are DECLARED — the tdgRoutesAreDark.test.ts approach,
 * for the same reason: a runtime test would need the whole middleware stack
 * and still would not prove the guard is on every route.
 *
 * Also pinned: the in-handler flag sites compose BOTH dimensions. An
 * env-flag call that lost its orgCapabilityAllows conjunct would silently
 * revert that capability to all-tenants-at-once — the exact property E-3
 * removes — so the source must show the pair together.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASK_SRC = readFileSync(resolve(__dirname, "../routes/ask.ts"), "utf8");
const ACTIONS_SRC = readFileSync(resolve(__dirname, "../routes/askActions.ts"), "utf8");

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

describe("every ask route carries the org capability gate", () => {
  const routes = routeBlocks(ASK_SRC).filter((r) => r.path.startsWith("/ask"));

  it("declares the routes this package is supposed to gate", () => {
    const paths = routes.map((r) => `${r.verb.toUpperCase()} ${r.path}`);
    expect(paths).toContain("POST /ask");
    expect(paths).toContain("POST /ask/stream");
    expect(paths).toContain("GET /ask/conversations");
    expect(paths).toContain("DELETE /ask/conversations/:id");
  });

  it('mounts requireOrgCapability("ask") on every route', () => {
    for (const r of routes) {
      expect(r.chain, `${r.verb} ${r.path} lacks the org gate`).toMatch(
        /requireOrgCapability\("ask"\)/
      );
    }
  });

  it("mounts the org gate AFTER attachOrganizationContext (it needs the context)", () => {
    for (const r of routes) {
      const ctxAt = r.chain.indexOf("attachOrganizationContext");
      const gateAt = r.chain.indexOf('requireOrgCapability("ask")');
      expect(ctxAt, `${r.verb} ${r.path} lacks attachOrganizationContext`).toBeGreaterThan(-1);
      expect(gateAt, `${r.verb} ${r.path} mounts the gate before its context`).toBeGreaterThan(ctxAt);
    }
  });
});

describe("the askActions surface carries the org capability gate", () => {
  it('the shared CHAIN mounts requireOrgCapability("ask") after attachOrganizationContext', () => {
    const chain = ACTIONS_SRC.match(/const CHAIN = \[([\s\S]*?)\] as const;/)?.[1] ?? "";
    const ctxAt = chain.indexOf("attachOrganizationContext");
    const gateAt = chain.indexOf('requireOrgCapability("ask")');
    expect(ctxAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(ctxAt);
  });

  it("the per-class check composes env AND org for both agentic classes", () => {
    const fn = ACTIONS_SRC.match(
      /async function classCurrentlyEnabled\([\s\S]*?\n\}/
    )?.[0] ?? "";
    expect(fn).toMatch(/askActionsEnabled\(\) && \(await orgCapabilityAllows\(organizationId, "ask_actions"\)\)/);
    expect(fn).toMatch(/askGovernedEnabled\(\) && \(await orgCapabilityAllows\(organizationId, "ask_governed"\)\)/);
  });
});

describe("the in-handler flag sites compose both dimensions", () => {
  it("the tool-path switch is env AND org", () => {
    expect(ASK_SRC).toMatch(
      /askToolsEnabled\(\) && \(await orgCapabilityAllows\(organizationId, "ask_tools"\)\)/
    );
  });

  it("the action-class offering is env AND org for each class", () => {
    expect(ASK_SRC).toMatch(
      /askActionsEnabled\(\) && \(await orgCapabilityAllows\(organizationId, "ask_actions"\)\)/
    );
    expect(ASK_SRC).toMatch(
      /askGovernedEnabled\(\) && \(await orgCapabilityAllows\(organizationId, "ask_governed"\)\)/
    );
  });

  it("the streaming route checks the org dimension of both flags it composes", () => {
    expect(ASK_SRC).toMatch(/orgCapabilityAllows\(organizationId, "ask_streaming"\)/);
  });
});
