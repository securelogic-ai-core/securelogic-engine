import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

/**
 * B1 demotion (Launch Completion 1) — the three legacy Vendor Assurance write
 * routes refuse with one canonical 410 when
 * SECURELOGIC_LEGACY_VENDOR_WRITES_ENABLED === "false", and pass through
 * untouched otherwise. DB-free: with the flag off the gate must fire before
 * any validation or DB work (asserted via a pg.connect spy); with the flag on
 * an empty body must reach validation (400), proving the gate is a
 * passthrough, not a rewrite.
 */

vi.mock("../middleware/requireApiKey.js", () => ({
  requireApiKey: (req: any, _res: any, next: any) => {
    req.apiKey = { id: "22222222-2222-4222-8222-222222222222" };
    next();
  },
}));
vi.mock("../middleware/attachOrganizationContext.js", () => ({
  attachOrganizationContext: (req: any, _res: any, next: any) => {
    req.organizationContext = {
      organizationId: "11111111-1111-4111-8111-111111111111",
    };
    next();
  },
}));
vi.mock("../middleware/requireEntitlement.js", () => ({
  requireEntitlement: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../lib/corePlatformCapability.js", () => ({
  requirePremiumOrCorePlatform: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../middleware/requireSeat.js", () => ({
  denyContributor: () => (_req: any, _res: any, next: any) => next(),
  seatModelEnabled: () => false,
}));
vi.mock("../middleware/asTenant.js", () => ({
  asTenant: (handler: any) => handler,
}));

const pgConnect = vi.fn(async () => {
  throw new Error("pg.connect must not be reached in this test");
});
vi.mock("../infra/postgres.js", () => ({
  pg: { connect: (...a: any[]) => pgConnect(...a), query: vi.fn() },
  pgElevated: { query: vi.fn() },
  withTenant: vi.fn(),
}));

const auditEvents: any[] = [];
vi.mock("../lib/auditLog.js", () => ({
  writeAuditEvent: (e: any) => {
    auditEvents.push(e);
    return true;
  },
  writeAuditEventAwaited: async (e: any) => {
    auditEvents.push(e);
    return true;
  },
}));
vi.mock("../lib/webhookDispatcher.js", () => ({
  dispatchWebhookEvent: vi.fn(),
}));
vi.mock("../lib/vendorRiskScoreRecompute.js", () => ({
  scheduleVendorScoreRecompute: vi.fn(),
  recomputeVendorRiskScore: vi.fn(),
}));

import vendorAssessmentsRouter from "../routes/vendorAssessments.js";
import vendorReviewsRouter from "../routes/vendorReviews.js";
import { LEGACY_VENDOR_WRITE_GONE } from "../lib/legacyVendorWriteFlag.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", vendorAssessmentsRouter);
  app.use("/api", vendorReviewsRouter);
  return app;
}

const app = makeApp();
const REVIEW_ID = "33333333-3333-4333-8333-333333333333";

const WRITES: Array<{ label: string; send: () => request.Test }> = [
  {
    label: "POST /api/vendor-assessments",
    send: () => request(app).post("/api/vendor-assessments").send({}),
  },
  {
    label: "POST /api/vendor-reviews",
    send: () => request(app).post("/api/vendor-reviews").send({}),
  },
  {
    label: "PATCH /api/vendor-reviews/:id",
    send: () => request(app).patch(`/api/vendor-reviews/${REVIEW_ID}`).send({}),
  },
];

beforeEach(() => {
  auditEvents.length = 0;
  pgConnect.mockClear();
});

afterEach(() => {
  delete process.env.SECURELOGIC_LEGACY_VENDOR_WRITES_ENABLED;
});

describe("legacy vendor write demotion (B1)", () => {
  describe("flag off — every legacy write is 410 Gone", () => {
    for (const w of WRITES) {
      it(`${w.label} → 410 with the canonical body, before any DB work`, async () => {
        process.env.SECURELOGIC_LEGACY_VENDOR_WRITES_ENABLED = "false";
        const res = await w.send();
        expect(res.status).toBe(410);
        expect(res.body).toEqual(LEGACY_VENDOR_WRITE_GONE);
        expect(pgConnect).not.toHaveBeenCalled();
      });
    }

    it("each rejection writes a legacy_write_rejected audit event", async () => {
      process.env.SECURELOGIC_LEGACY_VENDOR_WRITES_ENABLED = "false";
      for (const w of WRITES) await w.send();
      expect(auditEvents.map((e) => e.eventType).sort()).toEqual([
        "vendor_assessment.legacy_write_rejected",
        "vendor_review.legacy_write_rejected",
        "vendor_review.legacy_write_rejected",
      ]);
      for (const e of auditEvents) {
        expect(e.organizationId).toBe("11111111-1111-4111-8111-111111111111");
      }
    });

    it("PATCH 410s for any id — real or not — so the demoted state cannot enumerate reviews", async () => {
      process.env.SECURELOGIC_LEGACY_VENDOR_WRITES_ENABLED = "false";
      const res = await request(app)
        .patch("/api/vendor-reviews/99999999-9999-4999-8999-999999999999")
        .send({ status: "in_progress" });
      expect(res.status).toBe(410);
    });
  });

  describe("flag on (default) — the gate is a pure passthrough", () => {
    for (const state of [undefined, "true", "TRUE", "1", ""] as const) {
      it(`env=${JSON.stringify(state)}: empty body reaches validation (400, not 410)`, async () => {
        if (state === undefined) {
          delete process.env.SECURELOGIC_LEGACY_VENDOR_WRITES_ENABLED;
        } else {
          process.env.SECURELOGIC_LEGACY_VENDOR_WRITES_ENABLED = state;
        }
        const res = await request(app).post("/api/vendor-assessments").send({});
        expect(res.status).toBe(400);
      });
    }

    it("no audit noise on the passthrough path", async () => {
      delete process.env.SECURELOGIC_LEGACY_VENDOR_WRITES_ENABLED;
      await request(app).post("/api/vendor-reviews").send({});
      expect(
        auditEvents.filter((e) => String(e.eventType).includes("legacy_write"))
      ).toEqual([]);
    });
  });

  it("read routes are untouched by the flag (GET list is not 410)", async () => {
    process.env.SECURELOGIC_LEGACY_VENDOR_WRITES_ENABLED = "false";
    // pg.query is a plain vi.fn() returning undefined, so the handler will
    // fail internally — the assertion is only that the demotion gate does not
    // apply (anything but 410 proves the reads are exempt).
    const res = await request(app).get("/api/vendor-reviews");
    expect(res.status).not.toBe(410);
  });
});
