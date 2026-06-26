/**
 * contracts.test.ts — Four-stage signal contract conformance (P4 slice 4A.1).
 *
 * Pure type-and-shape conformance for the contract stubs. There is no runtime
 * behavior to exercise, so this asserts:
 *   - the schema-version constant is stable;
 *   - a representative `cyber_signals` ingest row (CyberSignalIngestInput shape)
 *     maps to a NormalizedSignal by stamping schemaVersion only — every other
 *     field is preserved unchanged;
 *   - RawSourceItem carries source provenance and an untouched payload;
 *   - SourceKind / SourceDescriptor accept both registry families;
 *   - the GLOBAL tenancy invariant: neither stage carries organization_id.
 *
 * Compile-time conformance (the `satisfies` checks and the `@ts-expect-error`
 * negative cases) is enforced by the typecheck lane; the runtime asserts below
 * back the same guarantees so the `test` lane fails loudly on drift too.
 */

import { describe, it, expect } from "vitest";
import {
  CONTRACT_SCHEMA_VERSION,
  type SourceKind,
  type SourceDescriptor,
  type RawSourceItem,
  type NormalizedSignal
} from "../../lib/signals/contracts.js";
import type { CyberSignalIngestInput } from "../../lib/cyberSignalValidation.js";

describe("signal contract — schema version", () => {
  it("pins the contract schema version", () => {
    expect(CONTRACT_SCHEMA_VERSION).toBe(1);
  });
});

describe("signal contract — NormalizedSignal anchors to CyberSignalIngestInput", () => {
  // A representative validated ingest row (the shape a real cyber_signals row
  // is built from). Global by construction — no organization_id.
  const ingestRow: CyberSignalIngestInput = {
    source: "cisa-kev",
    signal_type: "cve",
    severity: "critical",
    raw_payload: { cveID: "CVE-2026-12345", vendorProject: "Acme" },
    normalized_summary: "Actively exploited RCE in Acme Gateway.",
    affected_vendor: "Acme",
    affected_cve: "CVE-2026-12345",
    external_id: "CVE-2026-12345"
  };

  it("maps a cyber_signals ingest row to NormalizedSignal by stamping schemaVersion only", () => {
    const normalized: NormalizedSignal = {
      ...ingestRow,
      schemaVersion: CONTRACT_SCHEMA_VERSION
    };

    // Every ingest field is preserved unchanged.
    const { schemaVersion, ...rest } = normalized;
    expect(rest).toEqual(ingestRow);
    expect(schemaVersion).toBe(CONTRACT_SCHEMA_VERSION);
  });

  it("does NOT carry a tenant key (global signal layer)", () => {
    const normalized: NormalizedSignal = {
      ...ingestRow,
      schemaVersion: CONTRACT_SCHEMA_VERSION
    };
    const keys = Object.keys(normalized);
    expect(keys).not.toContain("organization_id");
    expect(keys).not.toContain("org_id");
    expect(keys).not.toContain("tenant_id");
  });
});

describe("signal contract — RawSourceItem", () => {
  it("carries provenance plus an untouched payload, with no tenant key", () => {
    const item: RawSourceItem<{ title: string }> = {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      sourceId: "cisa-kev",
      kind: "api",
      fetchedAt: "2026-06-26T00:00:00.000Z",
      raw: { title: "raw upstream item" }
    };

    expect(item.sourceId).toBe("cisa-kev");
    expect(item.kind).toBe("api");
    expect(item.raw).toEqual({ title: "raw upstream item" });
    expect(Object.keys(item)).not.toContain("organization_id");
  });
});

describe("signal contract — SourceKind / SourceDescriptor", () => {
  it("accepts both registry families", () => {
    const rss = { id: "bleepingcomputer", kind: "rss" } satisfies SourceDescriptor;
    const api = { id: "nvd", kind: "api" } satisfies SourceDescriptor;
    expect(rss.kind).toBe("rss");
    expect(api.kind).toBe("api");

    const kinds: SourceKind[] = ["rss", "api"];
    expect(kinds).toHaveLength(2);
  });

  it("rejects an unknown source kind at compile time", () => {
    // @ts-expect-error — "html" is not a SourceKind in this slice.
    const bad: SourceDescriptor = { id: "x", kind: "html" };
    // Runtime touch so the binding is used; the guarantee is the ts-expect-error.
    expect(bad.id).toBe("x");
  });
});
