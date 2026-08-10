import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * The provider-suppression lookup, and the signup contract that depends on it.
 *
 * Defect this guards (found in clean-tenant onboarding validation): a hard
 * bounce puts an address on the mail PROVIDER's own suppression list — a list
 * this codebase did not know existed. Later sends to that address are accepted
 * by the provider and silently discarded, and because the Resend SDK resolves
 * (rather than throws) on an API-level rejection, signup reported
 * `verification_email: "sent"` for a customer who would never receive anything
 * and could never sign in.
 *
 * Two properties matter and are asserted here:
 *   1. the lookup FAILS OPEN — anything short of a definite "suppressed" must
 *      resolve to `unknown` so a provider blip can never block a real signup;
 *   2. the check is confined to SIGNUP and must never reach
 *      /auth/resend-verification, whose uniform answer and uniform timing are
 *      its entire account-enumeration defence.
 */

const ORIGINAL_KEY = process.env.RESEND_API_KEY;

async function load() {
  vi.resetModules();
  return await import("../infra/providerSuppression.js");
}

function mockFetch(impl: (url: string) => Promise<Response> | Response) {
  vi.stubGlobal("fetch", vi.fn((url: unknown) => Promise.resolve(impl(String(url)))));
}

const res = (status: number) => ({ status }) as Response;

beforeEach(() => {
  process.env.RESEND_API_KEY = "re_test_key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_KEY === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = ORIGINAL_KEY;
});

describe("getProviderSuppression", () => {
  it("200 from the provider means the address IS suppressed", async () => {
    mockFetch(() => res(200));
    const { getProviderSuppression } = await load();
    expect(await getProviderSuppression("blocked@example.com")).toBe("suppressed");
  });

  it("404 means the address is explicitly clear", async () => {
    mockFetch(() => res(404));
    const { getProviderSuppression } = await load();
    expect(await getProviderSuppression("fine@example.com")).toBe("clear");
  });

  it("looks the address up exactly, url-encoded", async () => {
    const seen: string[] = [];
    mockFetch((url) => { seen.push(url); return res(404); });
    const { getProviderSuppression } = await load();
    await getProviderSuppression("a+b@example.com");
    expect(seen[0]).toBe("https://api.resend.com/suppressions/a%2Bb%40example.com");
  });

  // ── fail-open: the whole point ──────────────────────────────────────────
  it("FAILS OPEN on a provider error status", async () => {
    for (const status of [401, 403, 429, 500, 502]) {
      mockFetch(() => res(status));
      const { getProviderSuppression } = await load();
      expect(await getProviderSuppression("x@example.com")).toBe("unknown");
    }
  });

  it("FAILS OPEN when the request throws or times out", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network down"))));
    const { getProviderSuppression } = await load();
    expect(await getProviderSuppression("x@example.com")).toBe("unknown");
  });

  it("FAILS OPEN when no provider key is configured — never 'clear'", async () => {
    delete process.env.RESEND_API_KEY;
    mockFetch(() => res(200));
    const { getProviderSuppression } = await load();
    // Must not be "clear": we did not learn anything, and the caller has its
    // own `unavailable` path for a missing provider.
    expect(await getProviderSuppression("x@example.com")).toBe("unknown");
  });

  it("FAILS OPEN on an empty address without calling the provider", async () => {
    const spy = vi.fn(() => Promise.resolve(res(200)));
    vi.stubGlobal("fetch", spy);
    const { getProviderSuppression } = await load();
    expect(await getProviderSuppression("   ")).toBe("unknown");
    expect(spy).not.toHaveBeenCalled();
  });

  it("only ever returns one of the three documented states", async () => {
    for (const status of [200, 404, 500]) {
      mockFetch(() => res(status));
      const { getProviderSuppression } = await load();
      expect(["suppressed", "clear", "unknown"]).toContain(
        await getProviderSuppression("x@example.com")
      );
    }
  });
});

// ── Source-shape guards on the call sites ────────────────────────────────
// getProviderSuppression is consumed inside route handlers that need a live
// Express app + DB to exercise; these assert the wiring contract that the
// runtime tests above cannot reach, in the same style as checkoutPlanRouting.
describe("wiring: signup tells the truth, resend stays an oracle-free endpoint", () => {
  const src = readFileSync(
    resolve(process.cwd(), "src/api/routes/customerAuth.ts"),
    "utf8"
  );

  it("signup's verification send consults the provider suppression list", () => {
    const fn = src.slice(
      src.indexOf("async function sendVerificationEmail"),
      src.indexOf("function lockoutEmailHtml")
    );
    expect(fn).toContain("getProviderSuppression");
    expect(fn).toContain('return "suppressed"');
  });

  it("the local sendEmail THROWS on a provider rejection (SDK resolves, not throws)", () => {
    const fn = src.slice(
      src.indexOf("async function sendEmail("),
      src.indexOf("type VerificationEmailOutcome")
    );
    // The defect was `await resend.emails.send(...)` with the result discarded.
    expect(fn).toContain(".error");
    expect(fn).toContain("throw new Error");
  });

  it("NO enumeration oracle: resend-verification never consults suppression", () => {
    const handler = src.slice(src.indexOf('router.post("/auth/resend-verification"'));
    const body = handler.slice(0, handler.indexOf('router.post("/auth/login"'));
    expect(body).not.toContain("getProviderSuppression");
  });

  it("resend-verification still answers identically for every address", () => {
    const handler = src.slice(src.indexOf('router.post("/auth/resend-verification"'));
    const body = handler.slice(0, handler.indexOf('router.post("/auth/login"'));
    // One uniform response helper, and no per-address branch in what it returns.
    expect(body).toContain('verification_email: "attempted"');
    expect(body).not.toContain('verification_email: "suppressed"');
    expect(body).not.toContain('verification_email: "sent"');
  });

  it("a suppressed signup withholds the resend hints and points at support", () => {
    const signup = src.slice(src.indexOf("signup_verification_email_undelivered"));
    expect(signup).toContain('emailOutcome === "suppressed"');
    expect(signup).toContain("Resending will not help");
    expect(signup).toContain("support_email");
  });

  it("suppressed is a distinct outcome from failed", () => {
    expect(src).toContain(
      'type VerificationEmailOutcome = "sent" | "unavailable" | "failed" | "suppressed"'
    );
  });
});
