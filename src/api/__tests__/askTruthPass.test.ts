/**
 * askTruthPass.test.ts — Ask A0. Regression coverage for the five defects the
 * September-15 forensic audit found live in POST /api/ask.
 *
 * All five share one root cause: Ask maintains a PARALLEL data-access layer —
 * eight hand-written queries that duplicate what the canonical routes already
 * compute. Every time the platform ratifies a metric definition, someone has to
 * remember to also fix Ask, and the git record shows that failing about half the
 * time (88bf1254, df05d81b, 455966e0, a71af3c6, fe70510d — five prior
 * corrections, and five more defects still live when the audit ran).
 *
 * A0 fixes the five. A1 removes the parallel layer entirely by binding Ask to
 * the canonical route handlers, which is the only durable fix — these tests are
 * the safety net for the interim.
 *
 * The defects:
 *
 *   1. Query 7 filtered `severity IN ('critical','high')` — LOWER-CASE, against
 *      a PascalCase domain (findings.ts:87). It matched nothing, so the "recent
 *      critical findings" list handed to the model was permanently empty and Ask
 *      narrated a posture with no severe findings in it. This is the exact bug
 *      whose fix is documented in the comment on query 3, ten lines above.
 *   2. Query 7 also used `status = 'open'` rather than the canonical
 *      sqlFindingActive() the same file already uses.
 *   3. `signal_sourced` counted only 'signal', missing 'cyber_signal' (the
 *      matcher's actual dual-write) and 'intelligence_event'.
 *   4. `vendor_sourced` counted only 'vendor_review', missing
 *      'vendor_cycle_review'.
 *   5. The rate limiter keyed on `req.organizationId` — assigned NOWHERE in the
 *      codebase — so it silently fell back to req.ip, a rotating Cloudflare edge
 *      address. The per-org cap the file header advertises did not exist.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; params: unknown[] }>,
  userMessage: "" as string,
  auditEvents: [] as Array<Record<string, unknown>>,
  /** Rows the mock returns for the critical-findings query. */
  criticalFindingRows: [] as Array<Record<string, unknown>>,
}));

vi.mock("../infra/postgres.js", () => ({
  pg: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      h.calls.push({ sql, params });
      // The critical-findings query: honour the severity predicate rather than
      // trusting a string assertion, so a regression to lower-case literals
      // shows up as an EMPTY customer-visible list — the failure that matters.
      if (/FROM findings/.test(sql) && /LIMIT 15/.test(sql)) {
        const rows = h.criticalFindingRows.filter((r) => {
          const sev = String(r.severity);
          const m = sql.match(/severity IN \(([^)]*)\)/);
          if (!m) return false;
          const allowed = m[1]!.split(",").map((s) => s.trim().replace(/'/g, ""));
          return allowed.includes(sev);
        });
        return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    }),
    connect: vi.fn(),
  },
  withTenant: vi.fn(async (_org: string, cb: () => Promise<unknown>) => cb()),
  pgElevated: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: vi.fn(async (opts: { messages: Array<{ content: string }> }) => {
        h.userMessage = opts.messages[0]?.content ?? "";
        return { content: [{ type: "text", text: "answer" }] };
      }),
    };
  },
}));
vi.mock("../infra/providerQuotaAlert.js", () => ({
  instrumentAnthropicClient: (c: unknown) => c,
}));
vi.mock("../lib/auditLog.js", () => ({
  writeAuditEvent: vi.fn((e: Record<string, unknown>) => {
    h.auditEvents.push(e);
  }),
}));
vi.mock("../middleware/requireApiKey.js", () => ({
  requireApiKey: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../middleware/attachOrganizationContext.js", () => ({
  attachOrganizationContext: (
    req: { organizationContext?: unknown },
    _res: unknown,
    next: () => void
  ) => {
    req.organizationContext = { organizationId: ORG };
    next();
  },
}));
vi.mock("../middleware/requireEntitlement.js", () => ({
  requireEntitlement: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import askRouter from "../routes/ask.js";
import { askEnabled } from "../lib/askFeatureFlag.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", askRouter);
  return app;
}
const ask = (question = "What are my critical findings?") =>
  request(makeApp()).post("/api/ask").send({ question });

/** The JSON context block the model was actually shown. */
function modelContext(): Record<string, any> {
  const start = h.userMessage.indexOf("{");
  const end = h.userMessage.lastIndexOf("}");
  return JSON.parse(h.userMessage.slice(start, end + 1));
}

const summaryQuery = () =>
  h.calls.find((c) => /vendor_sourced/.test(c.sql))!;
const criticalQuery = () =>
  h.calls.find((c) => /FROM findings/.test(c.sql) && /LIMIT 15/.test(c.sql))!;

beforeEach(() => {
  vi.clearAllMocks();
  h.calls = [];
  h.userMessage = "";
  h.auditEvents = [];
  h.criticalFindingRows = [];
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.SECURELOGIC_ASK_ENABLED;
});

// ─── Defects 1 + 2: the critical-findings list ──────────────────────────────

describe("Ask A0 — the critical-findings list was permanently empty", () => {
  it("matches PascalCase severities, so a Critical finding actually reaches the model", async () => {
    h.criticalFindingRows = [
      { title: "Unpatched RCE", severity: "Critical", status: "open", source_type: "manual", domain: "Vulnerability", priority: "immediate", created_at: "2026-08-01" },
      { title: "Weak TLS", severity: "High", status: "open", source_type: "manual", domain: "Network", priority: "near_term", created_at: "2026-08-02" },
    ];

    await ask();

    // The failure that matters is the VALUE the model saw, not the SQL text.
    expect(modelContext().critical_findings).toHaveLength(2);
    expect(modelContext().critical_findings[0].title).toBe("Unpatched RCE");
  });

  it("NEVER uses lower-case severity literals", async () => {
    await ask();
    const sql = criticalQuery().sql;
    // findings.ts:87 VALID_SEVERITIES = {Critical, High, Moderate, Low}.
    expect(sql).toMatch(/severity IN \('Critical', 'High'\)/);
    expect(sql).not.toMatch(/'critical'/);
    expect(sql).not.toMatch(/'high'/);
  });

  it("uses the canonical ACTIVE population, not status = 'open'", async () => {
    await ask();
    const sql = criticalQuery().sql;
    // sqlFindingActive() is the authoritative operational axis; the summary
    // count ten lines above already uses it. A list that disagrees with the
    // count beside it is worse than either alone.
    expect(sql).toMatch(/operational_status/);
    expect(sql).not.toMatch(/AND status = 'open'/);
  });

  it("orders by the same PascalCase vocabulary it filters on", async () => {
    await ask();
    expect(criticalQuery().sql).toMatch(/WHEN 'Critical' THEN 1 WHEN 'High' THEN 2/);
  });
});

// ─── Defects 3 + 4: provenance counts ───────────────────────────────────────

describe("Ask A0 — finding provenance counts came from a route-local list", () => {
  it("counts BOTH vendor workflow source types", async () => {
    await ask();
    const sql = summaryQuery().sql;
    expect(sql).toMatch(/'vendor_review'/);
    expect(sql).toMatch(/'vendor_cycle_review'/);
  });

  it("counts ALL intelligence source types, including the matcher's dual-write", async () => {
    await ask();
    const sql = summaryQuery().sql;
    expect(sql).toMatch(/'signal'/);
    expect(sql).toMatch(/'cyber_signal'/);
    expect(sql).toMatch(/'intelligence_event'/);
  });

  it("never reverts to a single-value equality on source_type", async () => {
    await ask();
    const sql = summaryQuery().sql;
    // The exact shape of the old defect.
    expect(sql).not.toMatch(/source_type = 'vendor_review'/);
    expect(sql).not.toMatch(/source_type = 'signal'/);
  });
});

// ─── Defect 5: the rate limiter ─────────────────────────────────────────────

describe("Ask A0 — the rate limiter keyed on a field that is never assigned", () => {
  it("keys on the org from organizationContext, not the unassigned req.organizationId", async () => {
    // The regression guard is on the SOURCE: `req.organizationId` is assigned
    // nowhere in the codebase, so reading it always yielded undefined and every
    // request fell through to the IP branch — which behind Cloudflare is a
    // rotating edge address, fragmenting the limit into uselessness.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const src = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../routes/ask.ts"),
      "utf8"
    );
    const start = src.indexOf("const askRateLimit");
    expect(start, "askRateLimit declaration not found").toBeGreaterThan(-1);
    // Search for the terminator AFTER the start — "POST /api/ask" also appears
    // in a doc comment further up the file.
    const end = src.indexOf("router.post(", start);
    const limiterBlock = src.slice(start, end);
    expect(limiterBlock).toMatch(/organizationContext\?\.\s*organizationId/);
    expect(limiterBlock).not.toMatch(/\(req as any\)\.organizationId/);
    expect(limiterBlock).toMatch(/org:\$\{?/);
  });
});

// ─── The kill switch ────────────────────────────────────────────────────────

describe("Ask A0 — the feature flag Ask shipped without", () => {
  it("is enabled by default (Ask is already live; this is a kill switch, not a dark launch)", () => {
    expect(askEnabled({})).toBe(true);
    expect(askEnabled({ SECURELOGIC_ASK_ENABLED: "true" })).toBe(true);
  });

  it("only 'false' disables it", () => {
    expect(askEnabled({ SECURELOGIC_ASK_ENABLED: "false" })).toBe(false);
    expect(askEnabled({ SECURELOGIC_ASK_ENABLED: "no" })).toBe(true);
  });

  it("404s BEFORE any DB read or provider call when off", async () => {
    process.env.SECURELOGIC_ASK_ENABLED = "false";
    const res = await ask();
    expect(res.status).toBe(404);
    // The whole point of a kill switch: no query, no spend.
    expect(h.calls).toHaveLength(0);
    expect(h.userMessage).toBe("");
  });
});

// ─── Auditability ───────────────────────────────────────────────────────────

describe("Ask A0 — Ask recorded nothing at all", () => {
  it("writes an ask.question.asked audit event", async () => {
    await ask("Which vendors are critical?");
    const ev = h.auditEvents.find((e) => e.eventType === "ask.question.asked");
    expect(ev).toBeTruthy();
    expect(ev!.organizationId).toBe(ORG);
    expect((ev!.payload as Record<string, unknown>).question).toBe("Which vendors are critical?");
  });

  it("records the context digest, so an investigator can tell what the model could see", async () => {
    h.criticalFindingRows = [
      { title: "X", severity: "Critical", status: "open", source_type: "manual", domain: null, priority: null, created_at: "2026-08-01" },
    ];
    await ask();
    const ev = h.auditEvents.find((e) => e.eventType === "ask.question.asked")!;
    const digest = (ev.payload as Record<string, any>).context_digest;
    expect(digest).toBeTruthy();
    expect(digest.critical_findings_listed).toBe(1);
  });

  it("does NOT put the model's answer in the audit log", async () => {
    // Answers are unbounded model output and belong in conversation storage
    // (Ask A1), not audit_log. Only its length is recorded.
    await ask();
    const ev = h.auditEvents.find((e) => e.eventType === "ask.question.asked")!;
    const payload = ev.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty("answer");
    expect(payload.answer_length).toBe("answer".length);
  });
});
