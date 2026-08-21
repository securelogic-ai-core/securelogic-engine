/**
 * findingAssetOccurrences.test.ts — the HTTP contract for per-asset exposure.
 *
 * The database proves isolation and the pure modules prove the transitions, so
 * this file covers what only the route decides: that a cross-tenant id 404s
 * instead of linking, that recording the same exposure twice CONVERGES instead
 * of duplicating or erroring, and — the one people will argue about — that a
 * human cannot mark an occurrence `absent`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG = "org-1";
const FINDING = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const ASSET = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const FOREIGN_ASSET = "cccccccc-3333-4333-8333-cccccccccccc";
const OCCURRENCE = "dddddddd-4444-4444-8444-dddddddddddd";

const OWNED_FINDINGS = new Set([FINDING]);
const OWNED_ASSETS = new Set([ASSET]);

/** The occurrence the store currently holds, or null when none exists. */
const store: { row: Record<string, unknown> | null } = { row: null };
const identifierRows: { rows: Array<Record<string, unknown>> } = { rows: [] };
const inserted: Array<Record<string, unknown>> = [];
const updates: Array<Record<string, unknown>> = [];

const query = vi.fn(async (sql: string, params: unknown[] = []) => {
  if (/FROM findings WHERE id = \$1 AND organization_id = \$2/i.test(sql)) {
    const ok = OWNED_FINDINGS.has(String(params[0])) && params[1] === ORG;
    return { rows: ok ? [{ "?column?": 1 }] : [], rowCount: ok ? 1 : 0 };
  }
  if (/FROM assets WHERE id = \$1 AND organization_id = \$2/i.test(sql)) {
    const ok = OWNED_ASSETS.has(String(params[0])) && params[1] === ORG;
    return { rows: ok ? [{ "?column?": 1 }] : [], rowCount: ok ? 1 : 0 };
  }
  if (/SELECT id, presence_status, first_seen_at/i.test(sql)) {
    return { rows: store.row ? [store.row] : [], rowCount: store.row ? 1 : 0 };
  }
  if (/INSERT INTO finding_asset_occurrences/i.test(sql)) {
    const row = {
      id: OCCURRENCE, organization_id: params[0], finding_id: params[1], asset_id: params[2],
      source: params[3], source_occurrence_id: params[4], presence_status: "present",
      reappeared_count: 0,
    };
    inserted.push(row);
    return { rows: [row], rowCount: 1 };
  }
  if (/UPDATE finding_asset_occurrences/i.test(sql)) {
    const row = { id: OCCURRENCE, presence_status: params[3] ?? params[2], params };
    updates.push(row);
    return { rows: [row], rowCount: 1 };
  }
  if (/DELETE FROM finding_asset_occurrences/i.test(sql)) {
    return store.row
      ? { rows: [{ id: OCCURRENCE, asset_id: ASSET, presence_status: "present" }], rowCount: 1 }
      : { rows: [], rowCount: 0 };
  }
  if (/SELECT presence_status, COUNT/i.test(sql)) {
    return { rows: [{ presence_status: "present", n: "12" },
                     { presence_status: "absent", n: "3" },
                     { presence_status: "remediated", n: "2" }], rowCount: 3 };
  }
  if (/reappeared_count > 0/i.test(sql)) return { rows: [{ n: "4" }], rowCount: 1 };
  if (/FROM finding_asset_occurrences o/i.test(sql)) return { rows: [], rowCount: 0 };
  if (/FROM asset_identifiers/i.test(sql)) return { rows: identifierRows.rows, rowCount: identifierRows.rows.length };
  return { rows: [], rowCount: 0 };
});

vi.mock("../infra/postgres.js", () => ({
  pg: { query: (s: string, p?: unknown[]) => query(s, p ?? []) },
  pgElevated: { query: (s: string, p?: unknown[]) => query(s, p ?? []) },
}));
vi.mock("../infra/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../lib/auditLog.js", () => ({
  writeAuditEvent: () => {}, writeAuditEventAwaited: async () => true,
}));
vi.mock("../middleware/requireApiKey.js", () => ({
  requireApiKey: (req: express.Request, _r: express.Response, n: express.NextFunction) => {
    (req as never as Record<string, unknown>).apiKey = { id: "k-1" };
    (req as never as Record<string, unknown>).userId = "u-1";
    n();
  },
}));
vi.mock("../middleware/attachOrganizationContext.js", () => ({
  attachOrganizationContext: (req: express.Request, _r: express.Response, n: express.NextFunction) => {
    (req as never as Record<string, unknown>).organizationContext = { organizationId: ORG };
    n();
  },
}));
vi.mock("../middleware/requireEntitlement.js", () => ({
  requireEntitlement: () => (_q: express.Request, _r: express.Response, n: express.NextFunction) => n(),
}));
vi.mock("../middleware/requireSeat.js", () => ({
  denyContributor: () => (_q: express.Request, _r: express.Response, n: express.NextFunction) => n(),
  requireSeat: () => (_q: express.Request, _r: express.Response, n: express.NextFunction) => n(),
}));
vi.mock("../middleware/asTenant.js", () => ({ asTenant: (h: express.RequestHandler) => h }));

import occurrencesRouter from "../routes/findingAssetOccurrences.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api", occurrencesRouter);
  return a;
}

beforeEach(() => {
  vi.clearAllMocks();
  inserted.length = 0;
  updates.length = 0;
  store.row = null;
  identifierRows.rows = [];
});

describe("recording an exposure", () => {
  it("creates an occurrence for a finding and asset the org owns", async () => {
    const res = await request(app()).post(`/api/findings/${FINDING}/occurrences`)
      .send({ asset_id: ASSET, source: "manual" });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);
    expect(res.body.reappeared).toBe(false);
    expect(inserted).toHaveLength(1);
  });

  it("CONVERGES on the existing row rather than duplicating or erroring", async () => {
    // Identity is (org, finding, asset), so recording the same exposure twice is
    // an observation of one thing, not a second thing.
    store.row = {
      id: OCCURRENCE, presence_status: "present", first_seen_at: "2026-08-01T00:00:00.000Z",
      last_seen_at: "2026-08-01T00:00:00.000Z", absent_since: null, remediated_at: null,
      reappeared_count: 0, last_reappeared_at: null,
    };
    const res = await request(app()).post(`/api/findings/${FINDING}/occurrences`)
      .send({ asset_id: ASSET });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(false);
    expect(res.body.reappeared).toBe(false);
    expect(inserted).toHaveLength(0);
  });

  it("reports a REAPPEARANCE when the exposure had gone absent", async () => {
    store.row = {
      id: OCCURRENCE, presence_status: "absent", first_seen_at: "2026-08-01T00:00:00.000Z",
      last_seen_at: "2026-08-05T00:00:00.000Z", absent_since: "2026-08-10T00:00:00.000Z",
      remediated_at: null, reappeared_count: 0, last_reappeared_at: null,
    };
    const res = await request(app()).post(`/api/findings/${FINDING}/occurrences`)
      .send({ asset_id: ASSET });
    expect(res.status).toBe(200);
    expect(res.body.reappeared).toBe(true);
  });

  it("404s a cross-tenant asset instead of linking it", async () => {
    const res = await request(app()).post(`/api/findings/${FINDING}/occurrences`)
      .send({ asset_id: FOREIGN_ASSET });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("finding_or_asset_not_found");
    expect(inserted).toHaveLength(0);
  });

  it("does not distinguish 'no such asset' from 'not yours'", async () => {
    // Distinguishing them would make the endpoint an existence oracle for
    // another tenant's inventory.
    const missing = await request(app()).post(`/api/findings/${FINDING}/occurrences`)
      .send({ asset_id: "eeeeeeee-5555-4555-8555-eeeeeeeeeeee" });
    const foreign = await request(app()).post(`/api/findings/${FINDING}/occurrences`)
      .send({ asset_id: FOREIGN_ASSET });
    expect(missing.status).toBe(foreign.status);
    expect(missing.body.error).toBe(foreign.body.error);
  });

  it("requires an asset id", async () => {
    const res = await request(app()).post(`/api/findings/${FINDING}/occurrences`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("asset_id_required");
  });
});

describe("presence transitions a human may drive", () => {
  beforeEach(() => {
    store.row = {
      id: OCCURRENCE, presence_status: "present", first_seen_at: "2026-08-01T00:00:00.000Z",
      last_seen_at: "2026-08-01T00:00:00.000Z", absent_since: null, remediated_at: null,
      reappeared_count: 0, last_reappeared_at: null,
    };
  });

  it("a person may mark an exposure remediated", async () => {
    const res = await request(app())
      .patch(`/api/findings/${FINDING}/occurrences/${OCCURRENCE}`)
      .send({ presence_status: "remediated" });
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(1);
  });

  it("REFUSES to let a person mark an exposure absent", async () => {
    // Absence is an OBSERVATION — an authoritative later look did not find it —
    // and a person clicking a button is not that. Allowing it would make the
    // column mean two different things and let "I think it's gone" pass as
    // evidence. Scans observe; humans remediate.
    const res = await request(app())
      .patch(`/api/findings/${FINDING}/occurrences/${OCCURRENCE}`)
      .send({ presence_status: "absent" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_presence_transition");
    expect(res.body.detail).toMatch(/observation/i);
    expect(updates).toHaveLength(0);
  });

  it("rejects an unknown presence value", async () => {
    const res = await request(app())
      .patch(`/api/findings/${FINDING}/occurrences/${OCCURRENCE}`)
      .send({ presence_status: "gone" });
    expect(res.status).toBe(400);
  });
});

describe("reading exposure", () => {
  it("returns the rollup a finding displays", async () => {
    const res = await request(app()).get(`/api/findings/${FINDING}/occurrences`);
    expect(res.status).toBe(200);
    expect(res.body.rollup).toEqual({
      affected: 17, active: 12, absent: 3, remediated: 2, recurring: 4,
    });
  });

  it("bounds a hostile limit and offset", async () => {
    const res = await request(app())
      .get(`/api/findings/${FINDING}/occurrences?limit=99999&offset=999999999`);
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(100);
    expect(res.body.offset).toBe(100_000);
  });

  it("defaults to a bounded page", async () => {
    const res = await request(app()).get(`/api/findings/${FINDING}/occurrences`);
    expect(res.body.limit).toBe(25);
    expect(res.body.offset).toBe(0);
  });

  it("404s a finding the org does not own", async () => {
    const res = await request(app())
      .get(`/api/findings/eeeeeeee-5555-4555-8555-eeeeeeeeeeee/occurrences`);
    expect(res.status).toBe(404);
  });
});

describe("resolving a source's asset identifiers", () => {
  it("resolves a hostname to the asset that owns it", async () => {
    identifierRows.rows = [
      { asset_id: ASSET, scheme: "hostname", value: "web01", source: "manual" },
    ];
    const res = await request(app()).post("/api/assets/resolve-identifiers")
      .send({ identifiers: [{ scheme: "hostname", value: "WEB01" }] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outcome: "resolved", assetId: ASSET, via: "hostname" });
  });

  it("REFUSES an IP-only lookup without touching the database", async () => {
    // An IP is a lease, not a name. Querying on one would be work done to produce
    // an answer the resolver must discard anyway.
    const before = query.mock.calls.length;
    const res = await request(app()).post("/api/assets/resolve-identifiers")
      .send({ identifiers: [{ scheme: "ip", value: "10.0.4.12" }] });
    expect(res.body.outcome).toBe("not_found");
    expect(res.body.reason).toMatch(/IP or MAC/i);
    const identifierQueries = query.mock.calls
      .slice(before)
      .filter((c) => /FROM asset_identifiers/i.test(String(c[0])));
    expect(identifierQueries).toHaveLength(0);
  });

  it("returns ambiguous rather than guessing between two assets", async () => {
    identifierRows.rows = [
      { asset_id: ASSET, scheme: "hostname", value: "web01", source: "manual" },
      { asset_id: FOREIGN_ASSET, scheme: "hostname", value: "web01", source: "manual" },
    ];
    const res = await request(app()).post("/api/assets/resolve-identifiers")
      .send({ identifiers: [{ scheme: "hostname", value: "web01" }] });
    expect(res.body.outcome).toBe("ambiguous");
    expect(res.body.assetIds).toHaveLength(2);
  });

  it("reports not_found instead of creating an asset", async () => {
    identifierRows.rows = [];
    const res = await request(app()).post("/api/assets/resolve-identifiers")
      .send({ identifiers: [{ scheme: "hostname", value: "unknown" }] });
    expect(res.body.outcome).toBe("not_found");
    // Nothing was inserted anywhere.
    expect(inserted).toHaveLength(0);
  });

  it("requires at least one identifier", async () => {
    const res = await request(app()).post("/api/assets/resolve-identifiers").send({ identifiers: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("identifiers_required");
  });
});

describe("removing a mis-recorded exposure", () => {
  it("deletes one occurrence and returns 204", async () => {
    store.row = { id: OCCURRENCE };
    const res = await request(app())
      .delete(`/api/findings/${FINDING}/occurrences/${OCCURRENCE}`);
    expect(res.status).toBe(204);
  });

  it("404s when the occurrence is not this org's", async () => {
    store.row = null;
    const res = await request(app())
      .delete(`/api/findings/${FINDING}/occurrences/${OCCURRENCE}`);
    expect(res.status).toBe(404);
  });
});
