/**
 * sourceRegistry.test.ts — API-source descriptor conformance (P4 slice A3).
 *
 * Pure data conformance for the `kind:'api'` descriptor registry. There is no
 * runtime behavior to exercise (nothing consumes API_SOURCES yet — the
 * scheduler is deliberately not rewired until A4), so this asserts only the
 * shape and the canonical id set:
 *   - exactly the seven directly-wired API adapters are registered;
 *   - every entry is kind:'api';
 *   - ids equal the canonical feed_health id set — no extras, no missing, no
 *     duplicates;
 *   - each entry conforms to SourceDescriptor;
 *   - the GLOBAL tenancy invariant: no descriptor carries organization_id.
 *
 * Compile-time conformance (the `satisfies` check and the `@ts-expect-error`
 * negative case) is enforced by the typecheck lane; the runtime asserts below
 * back the same guarantees so the `test` lane fails loudly on drift too.
 */

import { describe, it, expect } from "vitest";
import { API_SOURCES } from "../../lib/signals/sourceRegistry.js";
import type { SourceDescriptor } from "../../lib/signals/contracts.js";

// The canonical source ids the scheduler already records via feed_health.
const CANONICAL_API_IDS = [
  "cisa_kev",
  "nvd",
  "sec_edgar",
  "federal_register",
  "cisa_alerts",
  "mitre_attack",
  "mitre_atlas"
] as const;

describe("API source registry — descriptor conformance", () => {
  it("registers exactly the seven directly-wired API adapters", () => {
    expect(API_SOURCES).toHaveLength(7);
  });

  it("marks every entry kind:'api'", () => {
    for (const src of API_SOURCES) {
      expect(src.kind).toBe("api");
    }
  });

  it("matches the canonical feed_health id set exactly (no extras, no missing)", () => {
    const ids = API_SOURCES.map((s) => s.id).sort();
    expect(ids).toEqual([...CANONICAL_API_IDS].sort());
  });

  it("has no duplicate ids", () => {
    const ids = API_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("conforms to SourceDescriptor with no organization scoping", () => {
    for (const src of API_SOURCES) {
      const descriptor: SourceDescriptor = src;
      expect(typeof descriptor.id).toBe("string");
      expect(descriptor.id.length).toBeGreaterThan(0);
      // GLOBAL shape — descriptors never carry tenant scope.
      expect("organization_id" in descriptor).toBe(false);
    }
  });

  it("rejects a non-conforming descriptor at compile time", () => {
    // @ts-expect-error — kind must be a SourceKind ("rss" | "api"), not arbitrary.
    const bad: SourceDescriptor = { id: "x", kind: "ftp" };
    expect(bad.id).toBe("x");
  });
});
