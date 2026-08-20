/**
 * healthStorageReadiness.test.ts — SL-EVID-1.
 *
 * `/health` must tell an operator whether file uploads actually work, and it
 * must do so without (a) claiming health from the mere presence of config,
 * (b) leaking configuration on an unauthenticated endpoint, or (c) turning a
 * storage outage into a failed liveness probe that pulls the engine out of
 * rotation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { pgQuerySpy, readinessSpy } = vi.hoisted(() => ({
  pgQuerySpy: vi.fn(),
  readinessSpy: vi.fn(),
}));

vi.mock("../infra/postgres.js", () => ({
  pg: { query: pgQuerySpy, connect: vi.fn() },
}));

vi.mock("../lib/blobStorageReadiness.js", () => ({
  checkBlobStorageReadiness: (...a: unknown[]) => readinessSpy(...a),
}));

import { handleHealth } from "../routes/healthHandler.js";

function buildRes() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return { res: { status, json } as never, status, json };
}

beforeEach(() => {
  pgQuerySpy.mockReset().mockResolvedValue({ rows: [{ "?column?": 1 }] });
  readinessSpy.mockReset().mockResolvedValue({ state: "ready" });
});

describe("GET /health — storage readiness", () => {
  it("reports storage: ready when the bucket answered", async () => {
    const { res, status, json } = buildRes();

    await handleHealth({} as never, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ status: "ok", db: "connected", storage: "ready" }));
  });

  it.each([["not_configured"], ["misconfigured"], ["unreachable"]] as const)(
    "reports storage: %s honestly instead of implying uploads work",
    async (state) => {
      readinessSpy.mockResolvedValueOnce({ state });
      const { res, json } = buildRes();

      await handleHealth({} as never, res);

      expect(json).toHaveBeenCalledWith(expect.objectContaining({ storage: state }));
    },
  );

  it("does NOT degrade the liveness signal when only storage is down", async () => {
    // Production has run without object storage since launch. A 503 here would
    // pull a healthy engine out of rotation over a dependency most requests
    // never touch, converting a feature gap into an outage.
    readinessSpy.mockResolvedValueOnce({ state: "not_configured" });
    const { res, status } = buildRes();

    await handleHealth({} as never, res);

    expect(status).toHaveBeenCalledWith(200);
  });

  it("still degrades on a database failure, and still reports storage", async () => {
    pgQuerySpy.mockRejectedValueOnce(new Error("db down"));
    readinessSpy.mockResolvedValueOnce({ state: "unreachable" });
    const { res, status, json } = buildRes();

    await handleHealth({} as never, res);

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ status: "degraded", db: "unreachable", storage: "unreachable" }),
    );
  });

  it("exposes only the bare state — no bucket, endpoint, or credential detail", async () => {
    readinessSpy.mockResolvedValueOnce({ state: "unreachable" });
    const { res, json } = buildRes();

    await handleHealth({} as never, res);

    const body = JSON.stringify(json.mock.calls[0]?.[0]);
    expect(body).not.toMatch(/R2_/);
    expect(body).not.toMatch(/bucket/i);
    expect(body).not.toMatch(/endpoint/i);
    expect(body).not.toMatch(/cloudflarestorage/i);
  });

  it("never lets a storage probe failure break the health endpoint", async () => {
    readinessSpy.mockRejectedValueOnce(new Error("probe exploded"));
    const { res, status, json } = buildRes();

    await handleHealth({} as never, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ storage: "unknown" }));
  });
});
