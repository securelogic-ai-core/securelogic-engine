/**
 * vendorsExportCsvLastReviewed.test.ts — GET /api/vendors/export.csv must not
 * ship a "Last Reviewed" column.
 *
 * PRODUCT RULING these tests hold the line on: "reviewed" is not a valid
 * customer-facing vendor metric. `vendors.last_reviewed_at` is written by
 * NOTHING in the product — not by PATCH /api/vendors/:id (the field is absent
 * from validateVendorPatch), not by POST /api/vendor-assessments, not by the
 * CSV import, not by any INSERT. So the exported column was permanently blank
 * for every vendor in every org, and a blank cell under a "Last Reviewed"
 * header reads to the customer as "this vendor has never been reviewed" — a
 * confident claim over a predicate the data cannot support.
 *
 * This is a DEFINITION defect, not a counting defect, which is why the
 * count-truth work upstream could not have caught it: an exact number over a
 * meaningless predicate passes every arithmetic test you can write.
 *
 * The failure mode of REMOVING a column is header/row drift — a header list
 * and a row list edited out of step silently shift every subsequent field one
 * place left. The alignment test below exists for that, not for ceremony.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG = "11111111-1111-4111-8111-111111111111";

/** A date that appears ONLY in last_reviewed_at, so finding it in the output
 *  proves the value leaked — no other field can produce it. */
const REVIEWED_SENTINEL = "2019-03-07";

const h = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; params: unknown[] }>,
  exportRows: [] as Array<Record<string, unknown>>
}));

vi.mock("../infra/postgres.js", () => ({
  pg: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      h.calls.push({ sql, params });
      if (/FROM vendors/.test(sql) && /LIMIT 10000/.test(sql)) {
        return { rows: h.exportRows, rowCount: h.exportRows.length };
      }
      return { rows: [], rowCount: 0 };
    }),
    connect: vi.fn()
  },
  withTenant: vi.fn(async (_org: string, cb: () => Promise<unknown>) => cb()),
  pgElevated: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) }
}));
vi.mock("../infra/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}));
vi.mock("../lib/auditLog.js", () => ({ writeAuditEvent: vi.fn() }));
vi.mock("../middleware/requireApiKey.js", () => ({
  requireApiKey: (_req: unknown, _res: unknown, next: () => void) => next()
}));
vi.mock("../middleware/attachOrganizationContext.js", () => ({
  attachOrganizationContext: (req: { organizationContext?: unknown }, _res: unknown, next: () => void) => {
    req.organizationContext = { organizationId: ORG };
    next();
  }
}));
vi.mock("../middleware/requireEntitlement.js", () => ({
  requireEntitlement: () => (_req: unknown, _res: unknown, next: () => void) => next()
}));
vi.mock("../lib/corePlatformCapability.js", () => ({
  requirePremiumOrCorePlatform: (_req: unknown, _res: unknown, next: () => void) => next()
}));

import vendorsRouter from "../routes/vendors.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", vendorsRouter);
  return app;
}

const exportQuery = () =>
  h.calls.find((c) => /FROM vendors/.test(c.sql) && /LIMIT 10000/.test(c.sql))!;

/** Split an RFC 4180 line into cells. Every cell csvRow emits is quoted, and
 *  inner quotes are doubled, so quoted-run matching is exact here. */
function cells(line: string): string[] {
  return (line.match(/"(?:[^"]|"")*"/g) ?? []).map((c) =>
    c.slice(1, -1).replace(/""/g, '"')
  );
}

function lines(body: string): string[] {
  return body.split("\r\n").filter((l) => l.length > 0);
}

/** A DB row shaped like the pre-change SELECT: it still carries
 *  last_reviewed_at, so any code path that re-reads it will surface the
 *  sentinel even though the current SELECT no longer asks for the column. */
function aRow(over: Record<string, unknown> = {}) {
  return {
    id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
    name: "Acme Payments",
    category: "payments",
    criticality: "critical",
    status: "active",
    data_sensitivity: "restricted",
    access_level: "system_access",
    website: "acme.example",
    service_description: "Card processing",
    created_at: "2026-01-15T00:00:00.000Z",
    last_reviewed_at: `${REVIEWED_SENTINEL}T00:00:00.000Z`,
    ...over
  };
}

const EXPECTED_HEADER = [
  "ID", "Name", "Category", "Criticality", "Status",
  "Data Sensitivity", "Access Level", "Website",
  "Description", "Created At"
];

beforeEach(() => {
  h.calls = [];
  h.exportRows = [];
});

describe('GET /api/vendors/export.csv — the retired "Last Reviewed" column', () => {
  it("does not emit a Last Reviewed header", async () => {
    const res = await request(makeApp()).get("/api/vendors/export.csv");

    expect(res.status).toBe(200);
    const header = cells(lines(res.text)[0]);
    expect(header).not.toContain("Last Reviewed");
    // Nor any near-miss rename that would resurrect the same claim.
    expect(res.text).not.toMatch(/reviewed/i);
  });

  it("emits exactly the ten surviving columns, in order", async () => {
    const res = await request(makeApp()).get("/api/vendors/export.csv");

    expect(cells(lines(res.text)[0])).toEqual(EXPECTED_HEADER);
  });

  it("does not select last_reviewed_at from the database at all", async () => {
    await request(makeApp()).get("/api/vendors/export.csv");

    // Removing the header while still selecting and emitting the value would
    // shift every later column; removing it at the source cannot.
    expect(exportQuery().sql).not.toMatch(/last_reviewed_at/);
  });

  it("never writes a review date into a data row, even when the record carries one", async () => {
    h.exportRows = [aRow()];

    const res = await request(makeApp()).get("/api/vendors/export.csv");

    expect(res.text).not.toContain(REVIEWED_SENTINEL);
  });

  it("keeps every data row aligned with the header after the removal", async () => {
    h.exportRows = [
      aRow(),
      // Nulls and an embedded comma + quote: the cells most likely to be
      // miscounted if header and row lists ever drift apart again.
      aRow({
        id: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
        name: 'Beta "Systems", Inc.',
        category: null,
        criticality: null,
        data_sensitivity: null,
        access_level: null,
        website: null,
        service_description: null,
        last_reviewed_at: null
      })
    ];

    const res = await request(makeApp()).get("/api/vendors/export.csv");

    const rows = lines(res.text);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(cells(row)).toHaveLength(EXPECTED_HEADER.length);
    }
  });

  it("still exports the fields the register actually maintains", async () => {
    h.exportRows = [aRow()];

    const res = await request(makeApp()).get("/api/vendors/export.csv");

    const row = cells(lines(res.text)[1]);
    expect(row).toEqual([
      "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
      "Acme Payments",
      "payments",
      "critical",
      "active",
      "restricted",
      "system_access",
      "acme.example",
      "Card processing",
      "2026-01-15"
    ]);
  });

  it("escapes a name containing quotes and commas without breaking alignment", async () => {
    h.exportRows = [aRow({ name: 'Beta "Systems", Inc.' })];

    const res = await request(makeApp()).get("/api/vendors/export.csv");

    expect(cells(lines(res.text)[1])[1]).toBe('Beta "Systems", Inc.');
  });
});

describe("GET /api/vendors/export.csv — unchanged contract around the removal", () => {
  it("is still scoped to the caller's organization", async () => {
    await request(makeApp()).get("/api/vendors/export.csv");

    const q = exportQuery();
    expect(q.sql).toMatch(/organization_id = \$1/);
    expect(q.params[0]).toBe(ORG);
  });

  it("still serves text/csv as a .csv attachment", async () => {
    const res = await request(makeApp()).get("/api/vendors/export.csv");

    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="vendors-\d{4}-\d{2}-\d{2}\.csv"/);
  });

  it("still forwards the status and criticality filters to SQL", async () => {
    await request(makeApp()).get("/api/vendors/export.csv?status=archived&criticality=high");

    const q = exportQuery();
    expect(q.sql).toMatch(/status = \$2/);
    expect(q.sql).toMatch(/criticality = \$3/);
    expect(q.params).toEqual([ORG, "archived", "high"]);
  });

  it("still rejects an unknown status filter before querying", async () => {
    const res = await request(makeApp()).get("/api/vendors/export.csv?status=bogus");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_status_filter");
    expect(h.calls.filter((c) => /LIMIT 10000/.test(c.sql))).toHaveLength(0);
  });
});
