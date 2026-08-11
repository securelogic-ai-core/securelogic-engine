import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import express from "express";
import request from "supertest";

/**
 * GET /admin/email-environment-evidence — the P1-2 "prove" step.
 *
 * The gate this feeds: enforcement (rejecting inbound events whose environment
 * does not match this service) must not be enabled until evidence shows it
 * would drop nothing legitimate. The failure mode of getting that wrong is
 * production silently ceasing to record bounces — worse than the leak
 * enforcement fixes.
 *
 * So the properties that matter are not "does it return 200". They are:
 *   1. it classifies with the SAME functions the webhook uses, so the preview
 *      describes the system that actually exists;
 *   2. it never reports an empty window as safe;
 *   3. it counts dropped BOUNCES separately, because that is the number that
 *      decides the gate;
 *   4. it changes nothing.
 */

const pgQuery = vi.hoisted(() => vi.fn());

vi.mock("../infra/postgres.js", () => ({
  pg: { query: pgQuery },
  pgElevated: { query: vi.fn() },
  withTenant: vi.fn()
}));

const ORIGINAL_ENV = { ...process.env };

/** An event as the webhook stores it: whole body, tags included. */
function event(
  environment: string | null,
  eventType = "email.delivered",
  createdAt = "2026-08-11T00:00:00.000Z",
  shape: "object" | "array" = "object"
) {
  const tags =
    environment === null
      ? undefined
      : shape === "array"
        ? [{ name: "environment", value: environment }]
        : { environment };
  return {
    event_type: eventType,
    created_at: createdAt,
    payload: { type: eventType, data: { email_id: "e1", ...(tags ? { tags } : {}) } }
  };
}

function mockRows(rows: unknown[]) {
  pgQuery.mockReset();
  pgQuery.mockResolvedValue({ rows, rowCount: rows.length });
}

async function app() {
  vi.resetModules();
  const { default: router } = await import("../routes/adminEmailEnvironmentEvidence.js");
  const a = express();
  a.use(router);
  return a;
}

beforeEach(() => {
  pgQuery.mockReset();
  process.env.APP_ENV = "staging";
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("classification fidelity", () => {
  it("counts same-environment events as match and clears the gate", async () => {
    mockRows([event("staging"), event("staging"), event("staging")]);

    const res = await request(await app()).get("/email-environment-evidence");

    expect(res.status).toBe(200);
    expect(res.body.receiver_environment).toBe("staging");
    expect(res.body.classification.match).toBe(3);
    expect(res.body.enforcement_preview.would_reject).toBe(0);
    expect(res.body.enforcement_preview.safe_to_enforce).toBe(true);
  });

  it("identifies events from a DIFFERENT environment as mismatch", async () => {
    mockRows([event("staging"), event("production"), event("demo")]);

    const res = await request(await app()).get("/email-environment-evidence");

    expect(res.body.classification.match).toBe(1);
    expect(res.body.classification.mismatch).toBe(2);
    expect(res.body.by_sender_environment).toMatchObject({
      staging: 1,
      production: 1,
      demo: 1
    });
    expect(res.body.enforcement_preview.safe_to_enforce).toBe(false);
  });

  it("distinguishes untagged legacy events (missing) from mismatched ones", async () => {
    mockRows([event(null), event("production")]);

    const res = await request(await app()).get("/email-environment-evidence");

    expect(res.body.classification.missing).toBe(1);
    expect(res.body.classification.mismatch).toBe(1);
    expect(res.body.by_sender_environment.absent).toBe(1);
  });

  it("reports indeterminate when this receiver has no identity of its own", async () => {
    delete process.env.APP_ENV;
    mockRows([event("staging")]);

    const res = await request(await app()).get("/email-environment-evidence");

    expect(res.body.receiver_environment).toBe("unknown");
    expect(res.body.classification.indeterminate).toBe(1);
    // An unidentifiable receiver must never look like a clean match.
    expect(res.body.enforcement_preview.safe_to_enforce).toBe(false);
  });

  it("reads the ARRAY tag shape as well as the documented object shape", async () => {
    mockRows([event("staging", "email.delivered", "2026-08-11T00:00:00.000Z", "array")]);

    const res = await request(await app()).get("/email-environment-evidence");

    expect(res.body.classification.match).toBe(1);
  });
});

// ── the number the gate actually turns on ──────────────────────────────────
describe("bounce loss is counted separately", () => {
  it("separates dropped bounces/complaints from dropped delivery noise", async () => {
    mockRows([
      event("production", "email.bounced"),
      event("production", "email.complained"),
      event("production", "email.delivered"),
      event("staging", "email.bounced")
    ]);

    const res = await request(await app()).get("/email-environment-evidence");

    const preview = res.body.enforcement_preview;
    expect(preview.would_reject).toBe(3);
    // Two of the three are suppressions that would have been LOST.
    expect(preview.suppression_events_at_risk).toBe(2);
    expect(preview.other_events_at_risk).toBe(1);
    expect(preview.rejected_suppression_event_types).toMatchObject({
      "email.bounced": 1,
      "email.complained": 1
    });
    expect(preview.reason).toMatch(/suppression would have been LOST/i);
  });

  it("does not count a MATCHED bounce as at risk", async () => {
    mockRows([event("staging", "email.bounced")]);

    const res = await request(await app()).get("/email-environment-evidence");

    expect(res.body.enforcement_preview.suppression_events_at_risk).toBe(0);
    expect(res.body.enforcement_preview.safe_to_enforce).toBe(true);
  });
});

// ── the trap this endpoint exists to avoid ─────────────────────────────────
describe("an empty window is never 'safe'", () => {
  it("refuses to clear the gate when nothing was received", async () => {
    mockRows([]);

    const res = await request(await app()).get("/email-environment-evidence");

    expect(res.status).toBe(200);
    expect(res.body.events_examined).toBe(0);
    // Zero rejections out of zero events is arithmetically clean and proves
    // nothing — this is exactly the state staging sat in for months.
    expect(res.body.enforcement_preview.would_reject).toBe(0);
    expect(res.body.enforcement_preview.safe_to_enforce).toBe(false);
    expect(res.body.enforcement_preview.reason).toMatch(/NOT evidence of safety/i);
  });

  it("refuses to clear the gate when the window was truncated", async () => {
    // 5001 rows: one over the cap, all matching.
    mockRows(Array.from({ length: 5001 }, () => event("staging")));

    const res = await request(await app()).get("/email-environment-evidence");

    expect(res.body.truncated).toBe(true);
    expect(res.body.events_examined).toBe(5000);
    expect(res.body.enforcement_preview.reason).toMatch(/truncated/i);
  });
});

describe("window bounds", () => {
  it("defaults to 7 days and clamps absurd input instead of trusting it", async () => {
    for (const [input, expected] of [
      [undefined, 7],
      ["30", 30],
      ["9999", 90],
      ["-4", 7],
      ["abc", 7]
    ] as Array<[string | undefined, number]>) {
      mockRows([]);
      const res = await request(await app()).get(
        `/email-environment-evidence${input === undefined ? "" : `?days=${input}`}`
      );
      expect(res.body.window_days).toBe(expected);
    }
  });

  it("surfaces a database failure instead of reporting a clean window", async () => {
    pgQuery.mockReset().mockRejectedValue(new Error("db down"));

    const res = await request(await app()).get("/email-environment-evidence");

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("email_environment_evidence_failed");
  });
});

// ── source-shape guarantees ────────────────────────────────────────────────
describe("it reports and does not act", () => {
  const src = readFileSync(
    resolve(process.cwd(), "src/api/routes/adminEmailEnvironmentEvidence.ts"),
    "utf8"
  );
  const code = src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

  it("performs no write and exposes no non-GET verb", () => {
    expect(code).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
    expect(code).not.toMatch(/router\.(post|put|patch|delete)\(/);
  });

  it("has no feature flag — it cannot switch enforcement on", () => {
    expect(code).not.toMatch(/SECURELOGIC_[A-Z_]*ENABLED|process\.env\[/);
  });

  it("classifies with the webhook's own functions rather than re-deriving in SQL", () => {
    // If this ever moves into SQL, the preview stops describing what
    // enforcement would really do.
    expect(code).toContain("classifyEventEnvironment");
    expect(code).toContain("readEventEnvironment");
    expect(code).toContain("isSuppressionEvent");
    expect(code).not.toMatch(/tags\s*->>|payload\s*->/);
  });

  it("leaks no recipient address", () => {
    expect(code).not.toMatch(/SELECT[^;]*\bemail\b[^;]*FROM email_provider_events/s);
  });
});

describe("wiring", () => {
  const index = readFileSync(resolve(process.cwd(), "src/api/routes/index.ts"), "utf8");

  it("is mounted under /admin after the admin chain", () => {
    const chainAt = index.indexOf('router.use("/admin", ...adminChain)');
    const mountAt = index.indexOf(
      'router.use("/admin", adminEmailEnvironmentEvidenceRouter)'
    );
    expect(chainAt).toBeGreaterThan(-1);
    expect(mountAt).toBeGreaterThan(chainAt);
  });
});

describe("the webhook and the evidence agree on what a suppression event is", () => {
  const webhook = readFileSync(
    resolve(process.cwd(), "src/api/routes/emailProviderWebhook.ts"),
    "utf8"
  );

  it("both import the single shared predicate — no second definition", () => {
    expect(webhook).toContain('from "../lib/emailEventTypes.js"');
    // The old local copy must be gone, or the two can drift.
    expect(webhook).not.toMatch(/function isSuppressionEvent/);
  });

  it("the webhook still processes every event in dark mode", () => {
    const between = webhook.slice(
      webhook.indexOf("const environmentMatch"),
      webhook.indexOf('client.query("BEGIN")')
    );
    // No early return between classifying and processing: dark mode means
    // classify-and-continue, never classify-and-drop.
    expect(between).not.toMatch(/return res\.status\(4\d\d\)/);
  });
});
