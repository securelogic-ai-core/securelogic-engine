/**
 * connectorObservationCore.test.ts — ERIP E2.P2: the pure observation planner
 * (plan → discovery-fact rows) + the ServiceNow reference fetchDelta cursor
 * behavior + migration lockstep for 20260812.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { planObservations } from "../lib/connectorObservationCore.js";
import { planConnectorSync } from "../lib/connectorSyncCore.js";
import { serviceNowCmdbAdapter } from "../lib/connectors/serviceNowCmdb.js";
import type { HttpClient } from "../lib/connectors/types.js";
import type { NormalizedInventory } from "../lib/connectors/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

describe("planObservations", () => {
  it("emits one detail-lane row per endpoint detail input", () => {
    const inv: NormalizedInventory = {
      entities: [
        { entity_type: "asset", name: "host-a", external_ref: "m-a" },
        { entity_type: "asset", name: "host-b", external_ref: "m-b" }
      ],
      relationships: []
    };
    const plan = planConnectorSync({ id: "microsoft_defender", displayName: "MS Defender", category: "endpoint" }, inv, {});
    const obs = planObservations(plan);
    expect(obs).toHaveLength(2);
    expect(obs.every((o) => o.lane === "detail" && o.entity_type === "endpoint")).toBe(true);
    expect(obs.map((o) => o.external_ref).sort()).toEqual(["m-a", "m-b"]);
  });

  it("emits import-lane rows for CMDB entities and dedups by external_ref", () => {
    const inv: NormalizedInventory = {
      entities: [
        { entity_type: "application", name: "Billing", external_ref: "ci-1" },
        { entity_type: "data_store", name: "BillingDB", external_ref: "ci-2" }
      ],
      relationships: []
    };
    const plan = planConnectorSync({ id: "servicenow_cmdb", displayName: "ServiceNow", category: "cmdb" }, inv, {});
    const obs = planObservations(plan);
    expect(obs).toHaveLength(2);
    expect(obs.every((o) => o.lane === "import")).toBe(true);
    const byRef = new Map(obs.map((o) => [o.external_ref, o]));
    expect(byRef.get("ci-1")?.entity_type).toBe("application");
    expect(byRef.get("ci-2")?.entity_type).toBe("data_store");
  });

  it("skips entries without a usable external_ref", () => {
    const inv: NormalizedInventory = {
      entities: [{ entity_type: "application", name: "NoRef", external_ref: "" }],
      relationships: []
    };
    const plan = planConnectorSync({ id: "servicenow_cmdb", displayName: "ServiceNow", category: "cmdb" }, inv, {});
    expect(planObservations(plan)).toHaveLength(0);
  });
});

describe("serviceNowCmdb.fetchDelta (ERIP-AD-10)", () => {
  const config = { instance_url: "https://corp.service-now.com", username: "u", password: "p" };

  function httpReturning(rows: unknown[], capture?: (url: string) => void): HttpClient {
    return {
      async getJson(url) {
        capture?.(url);
        return { result: rows };
      }
    };
  }

  it("null cursor fetches everything and seeds the watermark to the max sys_updated_on", async () => {
    let seenUrl = "";
    const http = httpReturning(
      [
        { sys_id: "a", name: "A", sys_updated_on: "2026-07-01 10:00:00" },
        { sys_id: "b", name: "B", sys_updated_on: "2026-07-03 09:00:00" }
      ],
      (u) => (seenUrl = u)
    );
    const r = await serviceNowCmdbAdapter.fetchDelta!(config, http, null);
    expect(seenUrl).not.toContain("sysparm_query"); // full fetch, no filter
    expect(r.next_cursor).toEqual({ sys_updated_on: "2026-07-03 09:00:00" });
    expect(serviceNowCmdbAdapter.normalize(r.raw).entities).toHaveLength(2);
  });

  it("a cursor filters by sys_updated_on and advances only when newer rows arrive", async () => {
    let seenUrl = "";
    const http = httpReturning([{ sys_id: "c", name: "C", sys_updated_on: "2026-07-05 12:00:00" }], (u) => (seenUrl = u));
    const r = await serviceNowCmdbAdapter.fetchDelta!(config, http, { sys_updated_on: "2026-07-03 09:00:00" });
    // URLSearchParams renders the space in the watermark as '+' (form-encoding).
    expect(seenUrl).toContain("sysparm_query=sys_updated_on%3E2026-07-03+09%3A00%3A00");
    expect(r.next_cursor).toEqual({ sys_updated_on: "2026-07-05 12:00:00" });
  });

  it("an empty delta leaves the stored cursor unchanged (next_cursor null)", async () => {
    const http = httpReturning([]);
    const r = await serviceNowCmdbAdapter.fetchDelta!(config, http, { sys_updated_on: "2026-07-05 12:00:00" });
    expect(r.next_cursor).toBeNull();
  });
});

describe("migration lockstep (20260812)", () => {
  const sql = readFileSync(
    path.join(repoRoot, "db/migrations/20260812_connector_asset_observations.sql"),
    "utf8"
  );

  it("creates the observations table with RLS + app_request grant, additively", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS connector_asset_observations");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON connector_asset_observations TO app_request");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS sync_cursor JSONB");
    expect(sql.replace(/^--.*$/gm, "")).not.toMatch(/DROP\s+TABLE/i);
  });

  it("lane CHECK admits exactly detail and import", () => {
    expect(sql).toContain("lane IN ('detail', 'import')");
  });
});
