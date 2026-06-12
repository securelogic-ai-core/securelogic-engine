/**
 * manifest.test.ts — the bundle manifest builder (PR #2b).
 */

import { describe, it, expect } from "vitest";
import {
  buildManifest,
  serializeManifest,
  GENERATOR_VERSION,
  EXPORT_GDPR_NOTE,
} from "../manifest";
import type { ManifestTableEntry } from "../types";

const tableEntry = (over: Partial<ManifestTableEntry> = {}): ManifestTableEntry => ({
  name: "findings",
  category: "C",
  row_count: 2,
  file: "tables/findings.ndjson",
  size_bytes: 42,
  sha256: "deadbeef",
  ...over,
});

describe("buildManifest", () => {
  const base = {
    exportId: "11111111-1111-1111-1111-111111111111",
    scope: "user_self" as const,
    targetUserId: "22222222-2222-2222-2222-222222222222",
    targetOrganizationId: "33333333-3333-3333-3333-333333333333",
    generatedAt: new Date("2026-06-12T08:00:00.000Z"),
    schemaVersion: "20260621_gdpr_foundations",
    tables: [tableEntry()],
  };

  it("produces the documented snake_case shape with constants applied", () => {
    const m = buildManifest(base);
    expect(m).toMatchObject({
      export_id: base.exportId,
      scope: "user_self",
      target_user_id: base.targetUserId,
      target_organization_id: base.targetOrganizationId,
      generated_at: "2026-06-12T08:00:00.000Z",
      generator_version: "2.0.0",
      schema_version: "20260621_gdpr_foundations",
    });
    expect(m.tables).toHaveLength(1);
    expect(m.gdpr_note).toBe(EXPORT_GDPR_NOTE);
    expect(GENERATOR_VERSION).toBe("2.0.0");
  });

  it("defaults attachments and notes to empty arrays", () => {
    const m = buildManifest(base);
    expect(m.attachments).toEqual([]);
    expect(m.notes).toEqual([]);
  });

  it("passes through a null schema_version", () => {
    const m = buildManifest({ ...base, schemaVersion: null });
    expect(m.schema_version).toBeNull();
  });

  it("carries explicit notes and attachments through", () => {
    const m = buildManifest({
      ...base,
      notes: ["dependency_assessments: reviewer_uuid absent"],
      attachments: [
        {
          path: "attachments/vendor-assurance/abc.pdf",
          size_bytes: 10,
          sha256: "feed",
          source_table: "vendor_assurance_documents",
          source_row_id: "abc",
        },
      ],
    });
    expect(m.notes).toEqual(["dependency_assessments: reviewer_uuid absent"]);
    expect(m.attachments[0]?.path).toBe("attachments/vendor-assurance/abc.pdf");
  });

  it("gdpr_note discloses NDJSON, current-email matching, recycled-email, and tombstones", () => {
    expect(EXPORT_GDPR_NOTE).toMatch(/NDJSON/i);
    expect(EXPORT_GDPR_NOTE).toMatch(/current email/i);
    expect(EXPORT_GDPR_NOTE).toMatch(/previously held by another/i);
    expect(EXPORT_GDPR_NOTE).toMatch(/deleted account/i);
  });
});

describe("serializeManifest", () => {
  it("round-trips to the same object", () => {
    const m = buildManifest({
      exportId: "e",
      scope: "user_self",
      targetUserId: null,
      targetOrganizationId: "o",
      generatedAt: new Date("2026-01-01T00:00:00.000Z"),
      schemaVersion: null,
      tables: [],
    });
    const json = serializeManifest(m);
    expect(json).toContain('"generator_version": "2.0.0"');
    expect(JSON.parse(json)).toEqual(m);
  });
});
