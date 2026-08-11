/**
 * requireSeatSeam.test.ts — Phase 2 enforcement seam.
 *
 * Proves the flag contract: with SECURELOGIC_SEAT_MODEL_ENABLED unset/false,
 * denyContributor and requireCapability are transparent passthroughs (byte
 * identical to pre-seat-model); with it "true", they enforce the resolved seat
 * scope.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { denyContributor, requireCapability } from "../middleware/requireSeat.js";

// Build an app that injects seat/role from headers (mimicking requireApiKey),
// then mounts the gate under test, then a 200 handler.
function makeApp(gate: express.RequestHandler) {
  const app = express();
  app.use((req, _res, next) => {
    const seat = req.header("x-seat");
    const role = req.header("x-role");
    if (seat) (req as { userSeatType?: string }).userSeatType = seat;
    if (role) (req as { userRole?: string }).userRole = role;
    next();
  });
  app.get("/probe", gate, (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

afterEach(() => vi.unstubAllEnvs());

describe("flag OFF — transparent passthrough", () => {
  it("denyContributor lets a contributor through", async () => {
    const res = await request(makeApp(denyContributor()))
      .get("/probe").set("x-seat", "contributor").set("x-role", "analyst");
    expect(res.status).toBe(200);
  });
  it("requireCapability lets anyone through", async () => {
    const res = await request(makeApp(requireCapability("users:manage")))
      .get("/probe").set("x-seat", "viewer").set("x-role", "viewer");
    expect(res.status).toBe(200);
  });
});

describe("flag ON — enforces", () => {
  it("denyContributor 403s a contributor", async () => {
    vi.stubEnv("SECURELOGIC_SEAT_MODEL_ENABLED", "true");
    const res = await request(makeApp(denyContributor()))
      .get("/probe").set("x-seat", "contributor").set("x-role", "analyst");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("seat_not_permitted");
  });

  it("denyContributor passes a full seat and a viewer seat", async () => {
    vi.stubEnv("SECURELOGIC_SEAT_MODEL_ENABLED", "true");
    for (const seat of ["full", "viewer"]) {
      const res = await request(makeApp(denyContributor()))
        .get("/probe").set("x-seat", seat).set("x-role", seat === "full" ? "analyst" : "viewer");
      expect(res.status).toBe(200);
    }
  });

  it("denyContributor passes an API-key caller (no seat header → admin-level full)", async () => {
    vi.stubEnv("SECURELOGIC_SEAT_MODEL_ENABLED", "true");
    const res = await request(makeApp(denyContributor())).get("/probe");
    expect(res.status).toBe(200);
  });

  it("requireCapability 403s when the seat lacks the capability", async () => {
    vi.stubEnv("SECURELOGIC_SEAT_MODEL_ENABLED", "true");
    const res = await request(makeApp(requireCapability("users:manage")))
      .get("/probe").set("x-seat", "full").set("x-role", "analyst"); // full non-admin: no users:manage
    expect(res.status).toBe(403);
    expect(res.body.required).toBe("users:manage");
  });

  it("requireCapability passes when the seat has it (full admin)", async () => {
    vi.stubEnv("SECURELOGIC_SEAT_MODEL_ENABLED", "true");
    const res = await request(makeApp(requireCapability("users:manage")))
      .get("/probe").set("x-seat", "full").set("x-role", "admin");
    expect(res.status).toBe(200);
  });
});
