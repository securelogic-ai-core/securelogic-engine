/**
 * vendorPortalTokens.test.ts — the external trust boundary's credential model.
 *
 * This is the module the entire vendor portal's security rests on, and it is
 * pure, so it can be tested exhaustively without a database. Stop Gate B's
 * behavioural half (IDOR sweeps, upload abuse, cross-engagement access) needs
 * the routes and lands with them; this is the foundation those tests assume.
 */
import { describe, it, expect } from "vitest";
import {
  INVITE_TTL_MS,
  PORTAL_SESSION_COOKIE,
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_IDLE_TTL_MS,
  checkInviteValidity,
  checkSessionValidity,
  generatePortalToken,
  hashPortalToken,
  hashUserAgent,
  mintInviteToken,
  mintSessionToken,
  portalCookieOptions,
  slideIdleWindow,
} from "../lib/vendorPortal/portalTokens.js";

const NOW = new Date("2026-08-12T12:00:00.000Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);

// ─── Entropy and hashing ────────────────────────────────────────────────────

describe("portal tokens — entropy and storage", () => {
  it("mints 256 bits of entropy, hex encoded", () => {
    const t = generatePortalToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never repeats across many mints", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generatePortalToken()));
    expect(seen.size).toBe(500);
  });

  it("hashes with plain SHA-256 — deterministic, and not the token itself", () => {
    const t = "a".repeat(64);
    const h = hashPortalToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toBe(t);
    expect(hashPortalToken(t)).toBe(h);
  });

  it("the minted record NEVER carries the raw token into storage fields", () => {
    // The raw token exists only in the email / cookie. A database read must
    // never yield a usable credential.
    const invite = mintInviteToken(NOW);
    expect(invite.tokenHash).toBe(hashPortalToken(invite.token));
    expect(invite.tokenHash).not.toBe(invite.token);

    const session = mintSessionToken(NOW);
    expect(session.tokenHash).not.toBe(session.token);
  });

  it("hashes the user agent rather than storing it", () => {
    // The raw UA is a fingerprinting surface with no investigative value beyond
    // "did it change", and can carry detail about a vendor's device estate.
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)";
    expect(hashUserAgent(ua)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashUserAgent(ua)).not.toContain("Mozilla");
    expect(hashUserAgent(null)).toBeNull();
    expect(hashUserAgent(undefined)).toBeNull();
  });
});

// ─── Lifetimes ──────────────────────────────────────────────────────────────

describe("portal tokens — lifetimes", () => {
  it("an invite lasts 30 days", () => {
    expect(mintInviteToken(NOW).expiresAt.getTime()).toBe(NOW.getTime() + INVITE_TTL_MS);
  });

  it("a session carries BOTH an idle and an absolute bound", () => {
    // Either alone leaves a hole: idle-only lets polling keep a session alive
    // forever; absolute-only leaves an abandoned browser open for the window.
    const s = mintSessionToken(NOW);
    expect(s.idleExpiresAt.getTime()).toBe(NOW.getTime() + SESSION_IDLE_TTL_MS);
    expect(s.absoluteExpiresAt.getTime()).toBe(NOW.getTime() + SESSION_ABSOLUTE_TTL_MS);
    expect(s.absoluteExpiresAt.getTime()).toBeGreaterThan(s.idleExpiresAt.getTime());
  });

  it("the session is far shorter-lived than the invite that produced it", () => {
    // The whole point of the exchange: the long-lived secret stays in email, and
    // what travels with the browser is short-lived.
    expect(SESSION_ABSOLUTE_TTL_MS).toBeLessThan(INVITE_TTL_MS);
  });

  it("sliding the idle window NEVER pushes past the absolute bound", () => {
    const s = mintSessionToken(NOW);
    // Six days in: a full idle slide would exceed the 7-day absolute bound.
    const slid = slideIdleWindow(s.absoluteExpiresAt, at(6 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000));
    expect(slid.getTime()).toBeLessThanOrEqual(s.absoluteExpiresAt.getTime());
  });

  it("sliding early moves the idle window forward normally", () => {
    const s = mintSessionToken(NOW);
    const slid = slideIdleWindow(s.absoluteExpiresAt, at(60 * 60 * 1000));
    expect(slid.getTime()).toBe(NOW.getTime() + 60 * 60 * 1000 + SESSION_IDLE_TTL_MS);
  });
});

// ─── Validity ───────────────────────────────────────────────────────────────

describe("portal tokens — invite validity fails closed", () => {
  const live = { expiresAt: at(INVITE_TTL_MS), revokedAt: null };

  it("accepts a live invite", () => {
    expect(checkInviteValidity(live, NOW)).toEqual({ valid: true });
  });

  it("a MISSING invite is not_found — the resolver never treats absent as valid", () => {
    expect(checkInviteValidity(null, NOW)).toEqual({ valid: false, reason: "not_found" });
  });

  it("rejects an expired invite, exactly at the boundary", () => {
    // <= not <: a token that expires at T must be dead AT T, not one tick later.
    expect(checkInviteValidity(live, at(INVITE_TTL_MS)).valid).toBe(false);
    expect(checkInviteValidity(live, at(INVITE_TTL_MS - 1)).valid).toBe(true);
  });

  it("rejects a revoked invite even while still within its expiry", () => {
    const revoked = { expiresAt: at(INVITE_TTL_MS), revokedAt: NOW };
    expect(checkInviteValidity(revoked, NOW)).toEqual({ valid: false, reason: "revoked" });
  });

  it("REVOCATION BEATS EXPIRY in the reported reason", () => {
    // An operator who revoked a link should see it reported as revoked even
    // after it would also have aged out — otherwise the audit trail suggests it
    // simply lapsed.
    const both = { expiresAt: at(-1), revokedAt: at(-2) };
    expect(checkInviteValidity(both, NOW).valid).toBe(false);
    expect((checkInviteValidity(both, NOW) as { reason: string }).reason).toBe("revoked");
  });
});

describe("portal tokens — session validity checks BOTH bounds", () => {
  const live = {
    idleExpiresAt: at(SESSION_IDLE_TTL_MS),
    absoluteExpiresAt: at(SESSION_ABSOLUTE_TTL_MS),
    revokedAt: null,
  };

  it("accepts a live session", () => {
    expect(checkSessionValidity(live, NOW)).toEqual({ valid: true });
  });

  it("rejects on the IDLE bound even when the absolute bound is far away", () => {
    expect(checkSessionValidity(live, at(SESSION_IDLE_TTL_MS)).valid).toBe(false);
  });

  it("rejects on the ABSOLUTE bound even when idle was just refreshed", () => {
    // The case a half-implemented session misses: a caller polling every minute
    // keeps idle alive indefinitely, and only the absolute bound stops them.
    const refreshed = {
      idleExpiresAt: at(SESSION_ABSOLUTE_TTL_MS + SESSION_IDLE_TTL_MS),
      absoluteExpiresAt: at(SESSION_ABSOLUTE_TTL_MS),
      revokedAt: null,
    };
    expect(checkSessionValidity(refreshed, at(SESSION_ABSOLUTE_TTL_MS)).valid).toBe(false);
  });

  it("rejects a revoked session immediately — this is the kill switch", () => {
    // Throwing the portal flag revokes sessions; that must take effect at once,
    // not when the idle window happens to lapse.
    const revoked = { ...live, revokedAt: NOW };
    expect(checkSessionValidity(revoked, NOW)).toEqual({ valid: false, reason: "revoked" });
  });

  it("a MISSING session is not_found", () => {
    expect(checkSessionValidity(null, NOW)).toEqual({ valid: false, reason: "not_found" });
  });
});

// ─── Cookie ─────────────────────────────────────────────────────────────────

describe("portal tokens — cookie attributes", () => {
  it("is httpOnly, SameSite=Lax, and SCOPED TO THE PORTAL PATH", () => {
    // Path scoping means the portal cookie is never sent to the authenticated
    // application, even if a vendor navigates there.
    const o = portalCookieOptions(at(SESSION_ABSOLUTE_TTL_MS), true);
    expect(o.httpOnly).toBe(true);
    expect(o.sameSite).toBe("lax");
    expect(o.path).toBe("/vendor-portal");
    expect(o.secure).toBe(true);
  });

  it("drops Secure only outside production, so local http still works", () => {
    expect(portalCookieOptions(at(1000), false).secure).toBe(false);
  });

  it("expires with the session's ABSOLUTE bound", () => {
    const abs = at(SESSION_ABSOLUTE_TTL_MS);
    expect(portalCookieOptions(abs, true).expires).toBe(abs);
  });

  it("uses a cookie name distinct from the internal session", () => {
    // The two authentication contexts must never mix; sharing a name would be
    // one refactor away from a portal session being read as a user session.
    expect(PORTAL_SESSION_COOKIE).toBe("sl_vendor_portal");
    expect(PORTAL_SESSION_COOKIE).not.toMatch(/^securelogic_session$/);
  });
});
