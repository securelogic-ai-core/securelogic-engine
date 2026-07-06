/**
 * serviceNowWriteback.test.ts — ERIP E2a: the ServiceNow CMDB writeback
 * capability (readCurrent + writeField) over a fake HttpClient. Proves the URL
 * shape, the whitelist enforcement, empty→null normalization, and that a client
 * lacking patchJson is rejected with a typed error (never a silent no-write).
 */

import { describe, expect, it, vi } from "vitest";
import { serviceNowCmdbAdapter } from "../lib/connectors/serviceNowCmdb.js";
import type { HttpClient } from "../lib/connectors/types.js";

const CONFIG = { instance_url: "https://acme.service-now.com", username: "svc", password: "pw" };

function writeback() {
  const wb = serviceNowCmdbAdapter.writeback;
  if (!wb) throw new Error("expected ServiceNow to support writeback");
  return wb;
}

describe("ServiceNow writeback.fields", () => {
  it("whitelists exactly the four allowed CMDB columns", () => {
    expect([...writeback().fields]).toEqual(["business_criticality", "owned_by", "short_description", "comments"]);
  });
});

describe("ServiceNow writeback.readCurrent", () => {
  it("queries the target sys_ids and maps values, empty → null", async () => {
    const getJson = vi.fn().mockResolvedValue({
      result: [
        { sys_id: "a1", business_criticality: "1 - most critical", owned_by: "u1", short_description: "", comments: "note" }
      ]
    });
    const http = { getJson } as unknown as HttpClient;
    const out = await writeback().readCurrent(CONFIG, http, ["a1", "a1", "missing"]);

    const url = getJson.mock.calls[0][0] as string;
    expect(url).toContain("/api/now/table/cmdb_ci?");
    expect(url).toContain("sys_idINa1%2Cmissing"); // deduped, comma-encoded
    expect(url).toContain("sysparm_exclude_reference_link=true");
    expect(out.get("a1")).toEqual({
      business_criticality: "1 - most critical",
      owned_by: "u1",
      short_description: null, // "" → null
      comments: "note"
    });
    expect(out.has("missing")).toBe(false); // not returned by ServiceNow
  });

  it("returns an empty map for no refs and makes no call", async () => {
    const getJson = vi.fn();
    const out = await writeback().readCurrent(CONFIG, { getJson } as unknown as HttpClient, []);
    expect(out.size).toBe(0);
    expect(getJson).not.toHaveBeenCalled();
  });
});

describe("ServiceNow writeback.writeField", () => {
  it("PATCHes the CI with only whitelisted fields", async () => {
    const patchJson = vi.fn().mockResolvedValue({ result: {} });
    const http = { getJson: vi.fn(), patchJson } as unknown as HttpClient;
    await writeback().writeField(CONFIG, http, "sys 1/2", {
      business_criticality: "1 - most critical",
      owned_by: "u9",
      not_allowed: "nope"
    });
    const [url, headers, body] = patchJson.mock.calls[0];
    expect(url).toBe("https://acme.service-now.com/api/now/table/cmdb_ci/sys%201%2F2"); // ref encoded
    expect(headers.Authorization).toMatch(/^Basic /);
    expect(body).toEqual({ business_criticality: "1 - most critical", owned_by: "u9" }); // not_allowed dropped
  });

  it("no-ops (no PATCH) when nothing whitelisted remains", async () => {
    const patchJson = vi.fn();
    await writeback().writeField(CONFIG, { getJson: vi.fn(), patchJson } as unknown as HttpClient, "a1", { bogus: "x" });
    expect(patchJson).not.toHaveBeenCalled();
  });

  it("throws a typed error when the client cannot PATCH", async () => {
    const http = { getJson: vi.fn() } as unknown as HttpClient; // no patchJson
    await expect(writeback().writeField(CONFIG, http, "a1", { owned_by: "u1" })).rejects.toThrow(
      /connector_http_client_missing_patch_json/
    );
  });
});
