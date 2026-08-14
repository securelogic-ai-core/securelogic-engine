/**
 * askToolWireNames.test.ts — the provider tool-name boundary.
 *
 * This exists because of a live P0 that every unit test missed: the registry's
 * canonical names are dotted (`findings.search`), the Anthropic API constrains
 * tool names to `^[a-zA-Z0-9_-]{1,128}$`, and every scripted-client test mock
 * accepted whatever name it was handed. The result was that the ENTIRE tool
 * path 400'd against the real provider from the day it shipped, and the
 * rejection escaped into `unhandledRejection` → drain-and-exit.
 *
 * The invariants below are the ones a mock cannot vouch for: that what we put
 * ON THE WIRE is legal, that it is unambiguous, and that nothing downstream of
 * the boundary ever sees a wire name.
 */
import { describe, it, expect, vi } from "vitest";

// The registry resolves every tool's chain from the live router, which pulls in
// route modules that construct the pg pool at import time.
vi.hoisted(() => {
  process.env.DATABASE_URL ||= "postgres://ask-tool-wire-names-test/unused";
});

import {
  platformTools,
  resolveWireToolName,
  toWireToolName,
  toolSchemasFor,
  toolsForActionClasses,
} from "../tools/registry.js";

/**
 * The provider's documented constraint, restated here so a drift is visible.
 * Source: Anthropic "Define tools" — `name` "Must match the regex
 * `^[a-zA-Z0-9_-]{1,64}$`". Note 64, not 128.
 */
const PROVIDER_TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

describe("tool wire names", () => {
  it("every registered tool has a wire name the provider will accept", () => {
    const offenders = platformTools()
      .map((t) => ({ canonical: t.name, wire: toWireToolName(t.name) }))
      .filter((t) => !PROVIDER_TOOL_NAME.test(t.wire));

    expect(offenders).toEqual([]);
  });

  it("emits wire names in the schemas actually sent to the provider", () => {
    const schemas = toolSchemasFor(platformTools());

    expect(schemas.length).toBeGreaterThan(0);
    for (const s of schemas) {
      expect(s.name).toMatch(PROVIDER_TOOL_NAME);
      expect(s.name).not.toContain(".");
    }
    // The dotted name must survive as the canonical identity, not be renamed.
    expect(schemas.map((s) => s.name)).toContain("findings__search");
  });

  it("maps every wire name back to exactly one canonical name", () => {
    const tools = platformTools();
    for (const t of tools) {
      expect(resolveWireToolName(toWireToolName(t.name), tools)).toBe(t.name);
    }
  });

  it("wire names are unique across the registry", () => {
    const wires = platformTools().map((t) => toWireToolName(t.name));
    expect(new Set(wires).size).toBe(wires.length);
  });

  it("still accepts a canonical name inbound (models that echo the dotted form)", () => {
    const tools = platformTools();
    expect(resolveWireToolName("findings.search", tools)).toBe("findings.search");
  });

  it("returns null for a tool the model invented", () => {
    expect(resolveWireToolName("findings__invented", platformTools())).toBeNull();
  });

  it("refuses to build schemas for a tool whose wire name is illegal", () => {
    const bad = [
      { ...platformTools()[0], name: "findings search" },
    ] as ReturnType<typeof platformTools>;

    expect(() => toolSchemasFor(bad)).toThrow(/violates the provider tool-name pattern/);
  });

  it("refuses to build schemas for a wire name longer than the provider allows", () => {
    // 65 chars: legal characters, illegal length. The character class alone
    // would pass this — only the {1,64} bound catches it.
    const tooLong = [
      { ...platformTools()[0], name: "a".repeat(65) },
    ] as ReturnType<typeof platformTools>;

    expect(() => toolSchemasFor(tooLong)).toThrow(/violates the provider tool-name pattern/);
    // …and 64 exactly is still fine, so the bound is inclusive.
    const atLimit = [
      { ...platformTools()[0], name: "a".repeat(64) },
    ] as ReturnType<typeof platformTools>;
    expect(() => toolSchemasFor(atLimit)).not.toThrow();
  });

  it("refuses to build schemas when two tools collide on the wire", () => {
    const [first] = platformTools();
    const collide = [
      { ...first, name: "a.b" },
      { ...first, name: "a__b" },
    ] as ReturnType<typeof platformTools>;

    expect(() => toolSchemasFor(collide)).toThrow(/both map to wire name/);
  });

  it("holds for the mutate class too, not just read", () => {
    const mutate = toolsForActionClasses(["mutate"]);
    expect(mutate.length).toBeGreaterThan(0);
    for (const s of toolSchemasFor(mutate)) {
      expect(s.name).toMatch(PROVIDER_TOOL_NAME);
    }
  });
});
