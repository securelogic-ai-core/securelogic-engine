import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import express from "express";
import request from "supertest";

/**
 * requireAdminNetwork — the admin IP allowlist, finally wired into adminChain.
 *
 * THE DEFECT THIS CLOSES
 * ----------------------
 * `SECURELOGIC_ADMIN_ALLOWED_IPS` was populated in production, asserted at
 * startup, and read by nothing: the middleware existed with zero call sites, so
 * /admin was restricted by key possession alone while the codebase claimed a
 * network restriction. A control that is configured, validated, and believed
 * active is more dangerous than one that is absent.
 *
 * THE TRAP THAT MADE WIRING IT DANGEROUS
 * --------------------------------------
 * The middleware read `req.ip`, which behind Render's Cloudflare edge is a CDN
 * node, not the caller — measured live: a client at 172.191.151.49 arrived as
 * 172.70.134.76, then 172.71.190.23. Comparing that against an allowlist of
 * operator addresses can only produce "no match", so enabling this as written
 * would have 401'd 100% of admin traffic in production.
 *
 * These tests therefore pin THREE things, and the third is the one that would
 * actually have caused an outage:
 *   1. the allow/deny decision itself,
 *   2. that enforcement is off unless explicitly switched on,
 *   3. that the client IP comes from Cloudflare's header, NOT `req.ip`.
 */

const ALLOWED = "20.42.11.16";
const ALLOWED_IN_CIDR = "10.1.2.3";
const DENIED = "203.0.113.77";
/** A Cloudflare edge address — what `req.ip` actually is in production. */
const CLOUDFLARE_EDGE = "172.70.134.76";

const ORIGINAL_ENV = { ...process.env };

function configure(opts: { allowlist?: string; enforced?: boolean } = {}) {
  process.env.SECURELOGIC_ADMIN_ALLOWED_IPS =
    opts.allowlist ?? `${ALLOWED}/32, 10.0.0.0/8`;
  if (opts.enforced) process.env.SECURELOGIC_ADMIN_NETWORK_ENFORCED = "true";
  else delete process.env.SECURELOGIC_ADMIN_NETWORK_ENFORCED;
}

/**
 * An app shaped like production: `trust proxy` 1, the middleware, then a
 * sentinel that only runs if the request was allowed through.
 */
async function app() {
  vi.resetModules();
  const { requireAdminNetwork } = await import("../middleware/requireAdminNetwork.js");
  const a = express();
  a.set("trust proxy", 1);
  a.use(requireAdminNetwork);
  a.get("/admin/thing", (_req, res) => res.status(200).json({ reached: true }));
  return a;
}

/** Simulate Cloudflare: it sets CF-Connecting-IP and forwards from an edge node. */
function asClient(agent: request.Test, clientIp: string | null) {
  agent.set("X-Forwarded-For", CLOUDFLARE_EDGE);
  if (clientIp !== null) agent.set("CF-Connecting-IP", clientIp);
  return agent;
}

beforeEach(() => configure());
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

// ── the decision ───────────────────────────────────────────────────────────
describe("enforcing: allow / deny", () => {
  it("ALLOWS an allowlisted IP", async () => {
    configure({ enforced: true });
    const res = await asClient(request(await app()).get("/admin/thing"), ALLOWED);
    expect(res.status).toBe(200);
    expect(res.body.reached).toBe(true);
  });

  it("ALLOWS an IP inside an allowlisted CIDR", async () => {
    configure({ enforced: true });
    const res = await asClient(request(await app()).get("/admin/thing"), ALLOWED_IN_CIDR);
    expect(res.status).toBe(200);
  });

  it("REJECTS an IP that is not allowlisted", async () => {
    configure({ enforced: true });
    const res = await asClient(request(await app()).get("/admin/thing"), DENIED);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("admin_unauthorized");
    expect(res.body.reached).toBeUndefined();
  });

  it("REJECTS an IPv4 address that merely resembles an allowlisted one", async () => {
    configure({ enforced: true });
    for (const near of ["20.42.11.17", "20.42.11.1", "120.42.11.16"]) {
      const res = await asClient(request(await app()).get("/admin/thing"), near);
      expect(res.status).toBe(401);
    }
  });

  it("treats an IPv4-mapped IPv6 client as its IPv4 equivalent", async () => {
    configure({ enforced: true });
    const res = await asClient(request(await app()).get("/admin/thing"), `::ffff:${ALLOWED}`);
    expect(res.status).toBe(200);
  });
});

// ── the outage this would have caused ──────────────────────────────────────
describe("client IP comes from Cloudflare, NOT req.ip", () => {
  it("does NOT allowlist-match against the Cloudflare edge address", async () => {
    // The exact production scenario: allowlist contains the operator's real IP,
    // req.ip is a CDN node. Reading req.ip would compare the CDN node and fail.
    configure({ allowlist: `${CLOUDFLARE_EDGE}/32`, enforced: true });
    const res = await asClient(request(await app()).get("/admin/thing"), ALLOWED);
    // The CF header says the caller is ALLOWED (not on this allowlist), so it
    // must be rejected — proving the edge address was not what got compared.
    expect(res.status).toBe(401);
  });

  it("uses the CF header even when req.ip differs from it", async () => {
    configure({ enforced: true });
    const res = await asClient(request(await app()).get("/admin/thing"), ALLOWED);
    expect(res.status).toBe(200); // req.ip was the (non-allowlisted) edge node
  });

  it("REJECTS when the CF header is absent and only a CDN address remains", async () => {
    // Header missing => the only address available is the edge node. Allowing
    // that would hand admin access to everyone sharing the PoP.
    configure({ enforced: true });
    const res = await asClient(request(await app()).get("/admin/thing"), null);
    expect(res.status).toBe(401);
  });

  it("REJECTS a multi-valued CF header rather than guessing which entry to believe", async () => {
    configure({ enforced: true });
    const res = await request(await app())
      .get("/admin/thing")
      .set("X-Forwarded-For", CLOUDFLARE_EDGE)
      .set("CF-Connecting-IP", `${ALLOWED}, ${DENIED}`);
    expect(res.status).toBe(401);
  });

  it("REJECTS a malformed CF header", async () => {
    configure({ enforced: true });
    for (const bad of ["not-an-ip", "", "999.999.999.999", "x".repeat(200)]) {
      const res = await request(await app())
        .get("/admin/thing")
        .set("X-Forwarded-For", CLOUDFLARE_EDGE)
        .set("CF-Connecting-IP", bad);
      expect(res.status).toBe(401);
    }
  });
});

// ── the rollout gate ───────────────────────────────────────────────────────
describe("dark by default", () => {
  it("does NOT reject a disallowed IP while enforcement is off", async () => {
    configure(); // enforced not set
    const res = await asClient(request(await app()).get("/admin/thing"), DENIED);
    expect(res.status).toBe(200);
    expect(res.body.reached).toBe(true);
  });

  it("does NOT reject when the allowlist is empty while enforcement is off", async () => {
    configure({ allowlist: "" });
    const res = await asClient(request(await app()).get("/admin/thing"), DENIED);
    expect(res.status).toBe(200);
  });

  it("requires exactly \"true\" — no truthy-ish value enables rejection", async () => {
    for (const value of ["TRUE", "1", "yes", "on", ""]) {
      configure();
      process.env.SECURELOGIC_ADMIN_NETWORK_ENFORCED = value;
      const res = await asClient(request(await app()).get("/admin/thing"), DENIED);
      expect(res.status).toBe(200);
    }
  });
});

// ── misconfiguration ───────────────────────────────────────────────────────
describe("enforcing: allowlist misconfiguration fails closed", () => {
  it("an EMPTY allowlist admits nobody (500, not open)", async () => {
    configure({ allowlist: "", enforced: true });
    const res = await asClient(request(await app()).get("/admin/thing"), ALLOWED);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("server_misconfigured");
  });

  it("an allowlist of only INVALID entries admits nobody", async () => {
    configure({ allowlist: "not-an-ip, 999.1.1.1, ///", enforced: true });
    const res = await asClient(request(await app()).get("/admin/thing"), ALLOWED);
    expect(res.status).toBe(500);
  });

  it("keeps valid entries when some entries are junk", async () => {
    configure({ allowlist: `garbage, ${ALLOWED}/32, ///`, enforced: true });
    expect((await asClient(request(await app()).get("/admin/thing"), ALLOWED)).status).toBe(200);
    expect((await asClient(request(await app()).get("/admin/thing"), DENIED)).status).toBe(401);
  });
});

// ── it must not leak which control refused ─────────────────────────────────
describe("response shape", () => {
  it("returns the same opaque body as an auth failure", async () => {
    configure({ enforced: true });
    const res = await asClient(request(await app()).get("/admin/thing"), DENIED);
    expect(res.body).toEqual({ error: "admin_unauthorized" });
    // No allowlist contents, no resolved IP, nothing about why.
    expect(JSON.stringify(res.body)).not.toContain(ALLOWED);
    expect(JSON.stringify(res.body)).not.toContain(DENIED);
  });
});

// ── chain wiring ───────────────────────────────────────────────────────────
describe("wiring: one chain, network check first, nothing bypasses it", () => {
  const index = readFileSync(resolve(process.cwd(), "src/api/routes/index.ts"), "utf8");
  const chain = index.slice(index.indexOf("const adminChain"));
  const body = chain.slice(0, chain.indexOf("]"));

  it("requireAdminNetwork is IN adminChain", () => {
    expect(body).toContain("requireAdminNetwork");
  });

  it("it runs BEFORE lockout, key check, rate limit and audit", () => {
    const at = (name: string) => body.indexOf(name);
    expect(at("requireAdminNetwork")).toBeGreaterThan(-1);
    for (const later of ["adminLockout", "requireAdminKey", "adminRateLimit", "adminAudit"]) {
      // Off-network callers must not consume a shared lockout counter or
      // rate-limit budget, and must not reach the key comparison at all.
      expect(at("requireAdminNetwork")).toBeLessThan(at(later));
    }
  });

  it("there is exactly ONE admin chain", () => {
    expect(index.match(/const adminChain/g)?.length).toBe(1);
    expect(index.match(/\.\.\.adminChain/g)?.length).toBe(1);
  });

  it("requireAdminKey is still present and unweakened", () => {
    expect(body).toContain("requireAdminKey");
    const mw = readFileSync(
      resolve(process.cwd(), "src/api/middleware/requireAdminKey.ts"),
      "utf8"
    );
    // The timing-safe comparison is the property that must not have moved.
    expect(mw).toMatch(/timingSafeEqual/);
  });

  it("every /admin mount except the static dashboard sits AFTER the chain", () => {
    const chainAt = index.indexOf('router.use("/admin", ...adminChain)');
    const mounts = [...index.matchAll(/router\.use\("(\/admin[^"]*)"/g)];
    const before = mounts
      .filter((m) => m.index! < chainAt && !index.slice(m.index!, m.index! + 60).includes("adminChain"))
      .map((m) => m[1]);
    // Known and deliberate: a static HTML shell with no DB access, whose JS
    // calls the protected endpoints with an operator-supplied token.
    expect(before).toEqual(["/admin/ops/dashboard"]);
  });

  it("the pre-chain dashboard route really is static — no data access", () => {
    const dash = readFileSync(
      resolve(process.cwd(), "src/api/routes/adminOpsDashboard.ts"),
      "utf8"
    );
    expect(dash).not.toMatch(/\bpg\.query\b|\bpgElevated\.query\b/);
    expect(dash).not.toMatch(/router\.(post|put|patch|delete)\(/);
  });
});

// ── the startup claim must match reality ───────────────────────────────────
describe("startup no longer claims a restriction it does not enforce", () => {
  const selfTest = readFileSync(
    resolve(process.cwd(), "src/api/startup/selfTest.ts"),
    "utf8"
  );

  it("still requires the allowlist to be configured in production", () => {
    expect(selfTest).toContain('assertNonEmptyEnv("SECURELOGIC_ADMIN_ALLOWED_IPS")');
  });

  it("no longer asserts /admin is fail-closed merely because the var is set", () => {
    // The old comment said "/admin is fail-closed if this is missing", which was
    // false while the middleware was unmounted.
    const stale = /\/admin is fail-closed if this is missing/;
    expect(selfTest).not.toMatch(stale);
    expect(selfTest).toContain("SECURELOGIC_ADMIN_NETWORK_ENFORCED");
  });
});
