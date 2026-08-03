import { describe, it, expect } from "vitest";

import { evaluateReadiness, GET } from "../route";

/**
 * The probe's whole value is that it fails when the app is misconfigured, so
 * the unready branches carry more weight here than the happy path. The final
 * test pins the one property that must never regress: no env VALUE may appear
 * in the response, only the NAME of the failing check.
 */

const READY_ENV = {
  SESSION_SECRET: "x".repeat(32),
  ENGINE_API_URL: "https://engine.internal",
} as unknown as NodeJS.ProcessEnv;

describe("evaluateReadiness", () => {
  it("is ready when both requirements are satisfied", () => {
    expect(evaluateReadiness(READY_ENV)).toEqual({ ready: true, failed: [] });
  });

  it("fails when SESSION_SECRET is missing", () => {
    const { SESSION_SECRET: _omitted, ...env } = READY_ENV as Record<string, string>;
    const result = evaluateReadiness(env as NodeJS.ProcessEnv);
    expect(result.ready).toBe(false);
    expect(result.failed).toContain("SESSION_SECRET");
  });

  it("fails when SESSION_SECRET is shorter than 32 characters", () => {
    // Matches middleware.ts, which ignores a secret under 32 chars and fails
    // open — the app would serve with session enforcement silently disabled.
    const result = evaluateReadiness({ ...READY_ENV, SESSION_SECRET: "x".repeat(31) });
    expect(result.ready).toBe(false);
    expect(result.failed).toContain("SESSION_SECRET");
  });

  it("fails when ENGINE_API_URL is missing", () => {
    const { ENGINE_API_URL: _omitted, ...env } = READY_ENV as Record<string, string>;
    const result = evaluateReadiness(env as NodeJS.ProcessEnv);
    expect(result.ready).toBe(false);
    expect(result.failed).toContain("ENGINE_API_URL");
  });

  it("rejects the localhost fallback in production", () => {
    const result = evaluateReadiness({
      ...READY_ENV,
      NODE_ENV: "production",
      ENGINE_API_URL: "http://localhost:4000",
    });
    expect(result.ready).toBe(false);
    expect(result.failed).toContain("ENGINE_API_URL");
  });

  it("allows the localhost fallback outside production", () => {
    const result = evaluateReadiness({
      ...READY_ENV,
      NODE_ENV: "development",
      ENGINE_API_URL: "http://localhost:4000",
    });
    expect(result.ready).toBe(true);
  });

  it("reports every failing check at once", () => {
    const result = evaluateReadiness({} as NodeJS.ProcessEnv);
    expect(result.failed).toEqual(
      expect.arrayContaining(["SESSION_SECRET", "ENGINE_API_URL"])
    );
  });
});

describe("GET /api/health", () => {
  const withEnv = async <T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> => {
    const saved = { ...process.env };
    Object.assign(process.env, env);
    try {
      return await fn();
    } finally {
      // Restore exactly — deleting keys the test added as well as resetting.
      for (const key of Object.keys(process.env)) {
        if (!(key in saved)) delete process.env[key];
      }
      Object.assign(process.env, saved);
    }
  };

  it("returns 200 and status ok when ready", async () => {
    await withEnv(
      { SESSION_SECRET: "x".repeat(32), ENGINE_API_URL: "https://engine.internal" },
      async () => {
        const res = await GET();
        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({ status: "ok" });
        expect(res.headers.get("Cache-Control")).toBe("no-store");
      }
    );
  });

  it("returns 503 and names the failing check when unready", async () => {
    await withEnv(
      { SESSION_SECRET: "too-short", ENGINE_API_URL: "https://engine.internal" },
      async () => {
        const res = await GET();
        expect(res.status).toBe(503);
        const body = await res.json();
        expect(body.status).toBe("unready");
        expect(body.failed).toContain("SESSION_SECRET");
      }
    );
  });

  it("never leaks an env value into the response body", async () => {
    const secret = "super-secret-value-that-must-not-leak-0123456789";
    await withEnv(
      { SESSION_SECRET: secret, ENGINE_API_URL: "http://localhost:4000", NODE_ENV: "production" },
      async () => {
        const res = await GET();
        const text = JSON.stringify(await res.json());
        expect(text).not.toContain(secret);
        expect(text).not.toContain("localhost");
      }
    );
  });
});
