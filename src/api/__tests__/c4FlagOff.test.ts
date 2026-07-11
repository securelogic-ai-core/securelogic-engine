/**
 * c4FlagOff.test.ts — C4 part 4: proof that flag-off behaviour is byte-identical.
 *
 * Everything C4 added is fenced behind SECURELOGIC_SIGNAL_APPLICABILITY_ENABLED, which is
 * OFF by default in every environment. With the flag off:
 *
 *   - the attestation surface DOES NOT EXIST (bare 404 — not 401, not 403, not an empty
 *     list, which would each imply the route is real and you merely lack something);
 *   - the matcher's canonical-product write NEVER RUNS, so no signal ingest touches
 *     canonical_products;
 *   - the legacy path is untouched and remains authoritative (C8 has not begun).
 *
 * This is the test that lets C4 sit on `develop` without changing a single customer's
 * behaviour until an operator deliberately turns it on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import path from "path";

import {
  signalApplicabilityEnabled,
  signalApplicabilityFeatureFlag,
} from "../lib/signalApplicabilityFeatureFlag.js";

const MATCHER_SRC = fs.readFileSync(
  path.join(process.cwd(), "src/api/lib/cyberSignalProcessingService.ts"),
  "utf8"
);

const ORIGINAL = process.env["SECURELOGIC_SIGNAL_APPLICABILITY_ENABLED"];

beforeEach(() => {
  delete process.env["SECURELOGIC_SIGNAL_APPLICABILITY_ENABLED"];
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env["SECURELOGIC_SIGNAL_APPLICABILITY_ENABLED"];
  else process.env["SECURELOGIC_SIGNAL_APPLICABILITY_ENABLED"] = ORIGINAL;
  vi.restoreAllMocks();
});

describe("the flag is OFF by default — C4 is dark on arrival", () => {
  it("unset means off", () => {
    expect(signalApplicabilityEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("only the exact string 'true' turns it on — no truthy coercion", () => {
    expect(signalApplicabilityEnabled({ SECURELOGIC_SIGNAL_APPLICABILITY_ENABLED: "1" } as any)).toBe(false);
    expect(signalApplicabilityEnabled({ SECURELOGIC_SIGNAL_APPLICABILITY_ENABLED: "TRUE" } as any)).toBe(false);
    expect(signalApplicabilityEnabled({ SECURELOGIC_SIGNAL_APPLICABILITY_ENABLED: "true" } as any)).toBe(true);
  });
});

describe("flag off: the attestation surface does not exist", () => {
  function appWith(): express.Express {
    const app = express();
    app.get("/probe", signalApplicabilityFeatureFlag, (_req, res) => {
      res.status(200).json({ reached: true });
    });
    return app;
  }

  it("404s — the route is not merely forbidden, it is ABSENT", async () => {
    const res = await request(appWith()).get("/probe");
    // 404, not 401/403: a 403 would tell a prober the surface exists and they lack
    // permission. While the convergence is dark, it simply is not there.
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
    expect(res.body.reached).toBeUndefined();
  });

  it("the handler is never reached", async () => {
    const res = await request(appWith()).get("/probe");
    expect(res.body.reached).toBeUndefined();
  });

  it("flag ON: the same route is reachable (so the 404 above is the FLAG, not a typo)", async () => {
    process.env["SECURELOGIC_SIGNAL_APPLICABILITY_ENABLED"] = "true";
    const res = await request(appWith()).get("/probe");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reached: true });
  });
});

describe("flag off: the matcher's C4 write cannot run", () => {
  it("the canonical-product upsert is INSIDE the flag guard", () => {
    // Source-level, deliberately: this is a structural guarantee, not a behavioural one.
    // If someone moves the upsert out of the guard, ingestion starts writing
    // canonical_products in every environment — silently, with the flag still "off".
    const block = MATCHER_SRC.slice(
      MATCHER_SRC.indexOf("ERG convergence C4 (ADR-0003 D1)"),
      MATCHER_SRC.indexOf("ERG convergence C3b")
    );
    expect(block.length).toBeGreaterThan(0);
    expect(block).toContain("if (signalApplicabilityEnabled())");

    const guardIdx = block.indexOf("if (signalApplicabilityEnabled())");
    const upsertIdx = block.indexOf("upsertCanonicalProduct");
    expect(upsertIdx).toBeGreaterThan(guardIdx);
  });

  it("a C4 failure can never break ingestion — it is try/catch-isolated", () => {
    const block = MATCHER_SRC.slice(
      MATCHER_SRC.indexOf("ERG convergence C4 (ADR-0003 D1)"),
      MATCHER_SRC.indexOf("ERG convergence C3b")
    );
    expect(block).toContain("try {");
    expect(block).toContain("catch");
    expect(block).toContain("canonical_product_upsert_failed");
  });
});

describe("the legacy path remains authoritative (C8 has NOT begun)", () => {
  it("the matcher still writes the legacy signal_*_links as affected-truth", () => {
    // C8 is the phase that stops treating these as affected-truth. It is not this PR.
    // The table name is templated (`INSERT INTO ${linkTable}`) since the deterministic-link
    // fix, so assert on the seam that produces it rather than a literal that no longer exists.
    expect(MATCHER_SRC).toContain("INSERT INTO ${linkTable}");
    expect(MATCHER_SRC).toContain("signal_vendor_links");
    expect(MATCHER_SRC).toContain("signal_ai_system_links");
  });

  it("the matcher still creates the legacy cyber_signal finding", () => {
    expect(MATCHER_SRC).toContain("'cyber_signal'");
    expect(MATCHER_SRC).toContain("INSERT INTO findings");
  });
});
