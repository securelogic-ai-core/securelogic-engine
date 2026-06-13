/**
 * exporter.test.ts — the export executor (PR #2b), driven with no database via
 * the injectable seams (Decision N1): identity scope + ArrayRowStreamer + a
 * Buffer sink + stub probe/schema-version. Asserts the executor assembles a
 * valid zip (manifest + per-table NDJSON), with correct row counts, sizes,
 * hashes, notes, and fail/abort semantics.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Writable, Readable } from "node:stream";
import { createHash } from "node:crypto";
import yauzl from "yauzl";

// The executor imports infra/postgres (throws at eval without DATABASE_URL) and
// infra/logger. Stub both — the no-DB tests inject every DB seam via deps, so
// these stubs are never actually exercised; they only keep the import clean.
vi.mock("../../../infra/postgres.js", () => ({
  pg: { query: async () => ({ rows: [] }) },
  withTenant: async (_orgId: string, fn: () => Promise<unknown>) => fn(),
  withElevated: async (fn: (c: unknown) => Promise<unknown>) =>
    fn({ query: async () => ({ rows: [] }) }),
  requireTenantContext: () => ({ client: {}, orgId: "x", savepoint: { n: 0 } }),
  currentTenantContext: () => undefined,
}));
vi.mock("../../../infra/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { runExport, AttachmentNotFoundError } from "../exporter";
import { ArrayRowStreamer } from "../rowStreamer";
import { resetColumnCache } from "../columnProbe";
import { rowToNdjsonLine } from "../ndjsonTransform";
import type { AttachmentRef, ExportQuery, QueryRunner, RunExportDeps } from "../types";

const SUBJECT = {
  userId: "11111111-1111-1111-1111-111111111111",
  userEmail: "subject@example.com",
  orgId: "22222222-2222-2222-2222-222222222222",
};

// Column lists for the four projection tables (content irrelevant to the
// no-DB executor — only the probe map must resolve so the builders don't throw).
const PROJECTION_COLUMNS: Record<string, string[]> = {
  users: ["id", "organization_id", "email", "password_hash", "totp_secret"],
  org_invites: ["id", "organization_id", "email", "token"],
  organizations: ["id", "name", "entitlement_level", "stripe_customer_id"],
  webhook_endpoints: ["id", "organization_id", "url", "secret"],
};

// Fixture rows keyed by table; tables without a fixture stream empty.
const FIXTURES: Record<string, Array<Record<string, unknown>>> = {
  users: [{ id: SUBJECT.userId, email: SUBJECT.userEmail, name: "Subject" }],
  findings: [
    { id: "f1", title: "Finding one", severity: "high" },
    { id: "f2", title: "Finding two", severity: "low" },
  ],
  subscribers: [{ email: SUBJECT.userEmail, status: "subscribed" }],
  organizations: [{ id: SUBJECT.orgId, name: "Acme", entitlement_level: "platform_professional" }],
};

// The org's current members (Decision Q3) — what the readMemberEmails seam
// returns in tests. The no-DB executor never reads these from a database.
const MEMBER_EMAILS = ["a@example.com", "b@example.com"];

// Stub probe runner: 1-param queries = column-list probe; 2-param = the
// dependency reviewer_uuid presence probe (return absent → exercises the note).
const probeRunner: QueryRunner = async (_text, values) => {
  const v = values ?? [];
  if (v.length === 2) return { rows: [] };
  const table = String(v[0]);
  return { rows: (PROJECTION_COLUMNS[table] ?? []).map((c) => ({ column_name: c })) };
};

function testDeps(over: Partial<RunExportDeps> = {}): RunExportDeps {
  return {
    withScope: async (_orgId, fn) => fn(),
    openStreamer: (q: ExportQuery) => new ArrayRowStreamer(FIXTURES[q.table] ?? []),
    probeRunner,
    readSchemaVersion: async () => "20260621_test",
    readMemberEmails: async () => MEMBER_EMAILS,
    // org_full attachment seams default to "no attachments" so the table-only
    // org_full cases are deterministic; attachment cases override both.
    readAttachments: async () => [],
    openAttachment: async () => {
      throw new Error("openAttachment should not be called when there are no attachment refs");
    },
    now: () => new Date("2026-06-12T00:00:00.000Z"),
    ...over,
  };
}

// One attachment fixture row + its ASCII bytes (ASCII so the readZip utf8 decode
// round-trips for content assertions). The ref's sha256 is the digest of these
// bytes, so the executor's streamed-vs-stored cross-check passes on the happy path.
const ATTACHMENT_BYTES = Buffer.from("%PDF-1.4 fake-soc-report-bytes\n");
const ATTACHMENT_DOC_ID = "doc-aaaa-bbbb-cccc";
function attachmentRef(over: Partial<AttachmentRef> = {}): AttachmentRef {
  return {
    documentId: ATTACHMENT_DOC_ID,
    orgId: SUBJECT.orgId,
    storageKey: `org/${SUBJECT.orgId}/vendor-assurance/${ATTACHMENT_DOC_ID}/original.pdf`,
    sizeBytes: ATTACHMENT_BYTES.length,
    sha256: createHash("sha256").update(ATTACHMENT_BYTES).digest("hex"),
    sourceTable: "vendor_assurance_documents",
    ...over,
  };
}

class BufferSink extends Writable {
  private readonly chunks: Buffer[] = [];
  _write(chunk: Buffer, _enc: BufferEncoding, cb: (e?: Error | null) => void): void {
    this.chunks.push(Buffer.from(chunk));
    cb();
  }
  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

function readZip(buf: Buffer): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error("no zip"));
      const out = new Map<string, string>();
      zip.on("error", reject);
      zip.on("entry", (entry: { fileName: string }) => {
        zip.openReadStream(entry, (e, rs) => {
          if (e || !rs) return reject(e ?? new Error("no stream"));
          const cs: Buffer[] = [];
          rs.on("data", (c: Buffer) => cs.push(c));
          rs.on("end", () => {
            out.set(entry.fileName, Buffer.concat(cs).toString("utf8"));
            zip.readEntry();
          });
        });
      });
      zip.on("end", () => resolve(out));
      zip.readEntry();
    });
  });
}

beforeEach(() => resetColumnCache());

describe("runExport — user_self", () => {
  it("produces a valid zip with a manifest and one NDJSON file per table", async () => {
    const sink = new BufferSink();
    const result = await runExport(
      { subject: SUBJECT, scope: "user_self", sink, exportId: "export-1" },
      testDeps(),
    );

    const entries = await readZip(sink.toBuffer());

    // Manifest present and well-formed.
    const manifestJson = entries.get("manifest.json");
    expect(manifestJson).toBeDefined();
    const manifest = JSON.parse(manifestJson!);
    expect(manifest.generator_version).toBe("2.1.0");
    expect(manifest.schema_version).toBe("20260621_test");
    expect(manifest.scope).toBe("user_self");
    expect(manifest.target_user_id).toBe(SUBJECT.userId);
    expect(manifest.target_organization_id).toBe(SUBJECT.orgId);
    expect(manifest.generated_at).toBe("2026-06-12T00:00:00.000Z");

    // One data file per query; the manifest agrees with the returned result.
    expect(result.manifest.tables.length).toBe(manifest.tables.length);
    for (const t of result.manifest.tables) {
      expect(entries.has(t.file)).toBe(true);
    }
  });

  it("writes the subject's rows as parseable NDJSON with correct counts", async () => {
    const sink = new BufferSink();
    const result = await runExport(
      { subject: SUBJECT, scope: "user_self", sink, exportId: "export-2" },
      testDeps(),
    );
    const entries = await readZip(sink.toBuffer());

    const findings = entries.get("tables/findings.ndjson")!;
    const lines = findings.trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).id).toBe("f1");

    const findingsEntry = result.manifest.tables.find((t) => t.name === "findings")!;
    expect(findingsEntry.row_count).toBe(2);
  });

  it("computes size_bytes and sha256 over the exact NDJSON payload", async () => {
    const sink = new BufferSink();
    const result = await runExport(
      { subject: SUBJECT, scope: "user_self", sink, exportId: "export-3" },
      testDeps(),
    );
    const usersEntry = result.manifest.tables.find((t) => t.name === "users")!;
    const expectedPayload = FIXTURES.users!.map(rowToNdjsonLine).join("");
    expect(usersEntry.size_bytes).toBe(Buffer.byteLength(expectedPayload));
    expect(usersEntry.sha256).toBe(createHash("sha256").update(expectedPayload).digest("hex"));
    expect(result.bytes_written).toBe(
      result.manifest.tables.reduce((sum, t) => sum + t.size_bytes, 0),
    );
  });

  it("emits empty tables as zero-row entries (honest coverage)", async () => {
    const sink = new BufferSink();
    const result = await runExport(
      { subject: SUBJECT, scope: "user_self", sink, exportId: "export-4" },
      testDeps(),
    );
    const controls = result.manifest.tables.find((t) => t.name === "controls");
    expect(controls?.row_count).toBe(0);
    const entries = await readZip(sink.toBuffer());
    expect(entries.get("tables/controls.ndjson")).toBe("");
  });

  it("records the dependency_assessments reviewer_uuid-absent note", async () => {
    const sink = new BufferSink();
    const result = await runExport(
      { subject: SUBJECT, scope: "user_self", sink, exportId: "export-5" },
      testDeps(),
    );
    expect(result.manifest.notes.some((n) => n.includes("reviewer_uuid"))).toBe(true);
  });
});

describe("runExport — org_full (PR #2c)", () => {
  it("enumerates members and bundles the org dump with an org-scoped manifest", async () => {
    const sink = new BufferSink();
    const readMemberEmails = vi.fn(async () => MEMBER_EMAILS);
    const result = await runExport(
      { subject: SUBJECT, scope: "org_full", sink, exportId: "org-export-1" },
      testDeps({ readMemberEmails }),
    );

    // The member-enumeration seam is driven once, scoped to the subject's org.
    expect(readMemberEmails).toHaveBeenCalledTimes(1);
    expect(readMemberEmails).toHaveBeenCalledWith(SUBJECT.orgId);

    const entries = await readZip(sink.toBuffer());
    const manifest = JSON.parse(entries.get("manifest.json")!);

    // Org-level artifact: scoped to the org, NOT a single subject.
    expect(manifest.scope).toBe("org_full");
    expect(manifest.target_user_id).toBeNull();
    expect(manifest.target_organization_id).toBe(SUBJECT.orgId);
    expect(result.manifest.scope).toBe("org_full");

    // The org dump includes whole-table reads the self-export never makes
    // (e.g. organizations), and one NDJSON entry exists per manifest table.
    const orgEntry = result.manifest.tables.find((t) => t.name === "organizations");
    expect(orgEntry?.row_count).toBe(1);
    for (const t of result.manifest.tables) {
      expect(entries.has(t.file)).toBe(true);
    }
  });

  it("leaves manifest.attachments empty when the org has no attachment-bearing rows", async () => {
    const sink = new BufferSink();
    const result = await runExport(
      { subject: SUBJECT, scope: "org_full", sink, exportId: "org-export-2" },
      testDeps({ readAttachments: async () => [] }),
    );
    expect(result.manifest.attachments).toEqual([]);
  });
});

describe("runExport — org_full R2 attachments (PR #2d)", () => {
  it("streams an attachment into the bundle with a verified sha256 (status: included)", async () => {
    const sink = new BufferSink();
    const ref = attachmentRef();
    const openAttachment = vi.fn(async () => Readable.from([ATTACHMENT_BYTES]));
    const result = await runExport(
      { subject: SUBJECT, scope: "org_full", sink, exportId: "org-export-att-1" },
      testDeps({ readAttachments: async () => [ref], openAttachment }),
    );

    expect(openAttachment).toHaveBeenCalledTimes(1);
    expect(result.manifest.attachments).toHaveLength(1);

    const entry = result.manifest.attachments[0]!;
    const expectedPath = `attachments/vendor-assurance/${ATTACHMENT_DOC_ID}.pdf`;
    expect(entry).toMatchObject({
      path: expectedPath,
      status: "included",
      size_bytes: ATTACHMENT_BYTES.length,
      sha256: ref.sha256,
      source_table: "vendor_assurance_documents",
      source_row_id: ATTACHMENT_DOC_ID,
    });
    expect(entry.unavailable_reason).toBeUndefined();

    // The bytes are actually in the zip, and attachment bytes count toward the total.
    const entries = await readZip(sink.toBuffer());
    expect(entries.get(expectedPath)).toBe(ATTACHMENT_BYTES.toString("utf8"));
    const tableBytes = result.manifest.tables.reduce((s, t) => s + t.size_bytes, 0);
    expect(result.bytes_written).toBe(tableBytes + ATTACHMENT_BYTES.length);
  });

  it("records a CONFIRMED-ABSENT blob as a disclosed gap and still completes (status: unavailable)", async () => {
    const sink = new BufferSink();
    const ref = attachmentRef();
    const openAttachment = vi.fn(async () => {
      throw new AttachmentNotFoundError("attachment object not found in R2 for document doc-aaaa-bbbb-cccc");
    });

    // The export RESOLVES — a confirmed-absent blob is disclosed, never fatal.
    const result = await runExport(
      { subject: SUBJECT, scope: "org_full", sink, exportId: "org-export-att-2" },
      testDeps({ readAttachments: async () => [ref], openAttachment }),
    );

    expect(result.manifest.attachments).toHaveLength(1);
    const entry = result.manifest.attachments[0]!;
    expect(entry).toMatchObject({
      path: `attachments/vendor-assurance/${ATTACHMENT_DOC_ID}.pdf`,
      status: "unavailable",
      size_bytes: null,
      sha256: null,
      source_table: "vendor_assurance_documents",
      source_row_id: ATTACHMENT_DOC_ID,
    });
    expect(entry.unavailable_reason).toMatch(/not found/i);

    // No zip member was written for the unavailable attachment, and it adds no bytes.
    const entries = await readZip(sink.toBuffer());
    expect(entries.has(`attachments/vendor-assurance/${ATTACHMENT_DOC_ID}.pdf`)).toBe(false);
    expect(result.bytes_written).toBe(
      result.manifest.tables.reduce((s, t) => s + t.size_bytes, 0),
    );
  });

  it("fails the WHOLE export on an INDETERMINATE R2 error (not a disclosed gap)", async () => {
    const sink = new BufferSink();
    const ref = attachmentRef();
    const openAttachment = vi.fn(async () => {
      // A non-AttachmentNotFoundError = indeterminate (network/5xx/timeout).
      throw new Error("R2 connection reset");
    });
    await expect(
      runExport(
        { subject: SUBJECT, scope: "org_full", sink, exportId: "org-export-att-3" },
        testDeps({ readAttachments: async () => [ref], openAttachment }),
      ),
    ).rejects.toThrow(/connection reset/);
  });

  it("fails the WHOLE export on a sha256 MISMATCH between streamed and stored bytes", async () => {
    const sink = new BufferSink();
    // Stored sha256 deliberately does not match the streamed bytes.
    const ref = attachmentRef({ sha256: "0".repeat(64) });
    const openAttachment = vi.fn(async () => Readable.from([ATTACHMENT_BYTES]));
    await expect(
      runExport(
        { subject: SUBJECT, scope: "org_full", sink, exportId: "org-export-att-4" },
        testDeps({ readAttachments: async () => [ref], openAttachment }),
      ),
    ).rejects.toThrow(/sha256 mismatch/);
  });

  it("does not bundle attachments for a user_self export (org-owned concern only)", async () => {
    const sink = new BufferSink();
    const readAttachments = vi.fn(async () => [attachmentRef()]);
    const result = await runExport(
      { subject: SUBJECT, scope: "user_self", sink, exportId: "self-no-att" },
      testDeps({ readAttachments }),
    );
    expect(readAttachments).not.toHaveBeenCalled();
    expect(result.manifest.attachments).toEqual([]);
  });
});

describe("runExport — guards", () => {
  it("fails the whole export if any table errors (no silent partial)", async () => {
    const sink = new BufferSink();
    const boomStreamer = (q: ExportQuery) => {
      if (q.table === "findings") {
        return {
          read: async () => {
            throw new Error("boom");
          },
          close: async () => undefined,
        };
      }
      return new ArrayRowStreamer(FIXTURES[q.table] ?? []);
    };
    await expect(
      runExport(
        { subject: SUBJECT, scope: "user_self", sink, exportId: "x" },
        testDeps({ openStreamer: boomStreamer }),
      ),
    ).rejects.toThrow(/boom/);
  });
});
