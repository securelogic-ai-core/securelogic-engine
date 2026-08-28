/**
 * jwtTokenTypeInvariant.test.ts — SEC-TOKEN-1 / issue #821.
 *
 * THE DEFECT
 * ----------
 * Every token this service mints is signed with the same JWT_SECRET, so a
 * valid signature proves ORIGIN, not PURPOSE. `verifyJwt` used to assert only
 * "signed by us and unexpired", which made an `mfa_challenge` token — minted
 * for a user who has NOT yet passed the second factor — a structurally valid
 * session payload, and the role backfill then handed it `admin`.
 *
 * WHAT THIS SUITE IS FOR
 * ----------------------
 * The pre-fix argument for leaving this open was "requireAuth and
 * requireApiKey reject a missing `se`, so the crossover is unreachable". These
 * tests deliberately assert the property at the VERIFIER, not at those two
 * middlewares, because the caller-level defence is incomplete by inspection:
 * requireConsent.ts also calls verifyJwt and checks neither type nor epoch.
 * A test that passed only because two of three callers happened to be careful
 * would re-open the moment a fourth caller is added.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "crypto";
import {
  signJwt,
  signMfaChallenge,
  verifyJwt,
  verifyMfaChallenge,
} from "../lib/jwt.js";

const SECRET = "test-jwt-secret-at-least-32-characters-long!!";
let priorSecret: string | undefined;

beforeAll(() => {
  priorSecret = process.env["JWT_SECRET"];
  process.env["JWT_SECRET"] = SECRET;
});

afterAll(() => {
  if (priorSecret === undefined) delete process.env["JWT_SECRET"];
  else process.env["JWT_SECRET"] = priorSecret;
});

/** Mint an arbitrary payload with a genuinely valid signature. */
function mintSigned(payload: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
    "utf8"
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url"
  );
  const signing = `${header}.${body}`;
  const sig = crypto
    .createHmac("sha256", SECRET)
    .update(signing)
    .digest()
    .toString("base64url");
  return `${signing}.${sig}`;
}

function decode(token: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")
  );
}

const now = () => Math.floor(Date.now() / 1000);

describe("SEC-TOKEN-1 — verifyJwt enforces the token-type invariant", () => {
  it("REJECTS a real MFA challenge token (the reported bypass)", () => {
    // Not a hand-rolled forgery: this is exactly what the login route hands a
    // user who has supplied a correct password and has NOT yet supplied a
    // second factor. Before the fix, verifyJwt returned a payload here.
    const challenge = signMfaChallenge(
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222"
    );

    expect(verifyMfaChallenge(challenge)).not.toBeNull(); // genuinely valid, as its own type
    expect(verifyJwt(challenge)).toBeNull(); // but never a session
  });

  it("does not grant a foreign token the default 'admin' role on its way out", () => {
    // The role backfill is a fail-open default. Ordering matters: the type
    // guard must run first, so this can never observe role === 'admin'.
    const challenge = signMfaChallenge(
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444"
    );
    const result = verifyJwt(challenge);
    expect(result).toBeNull();
    expect((result as { role?: string } | null)?.role).toBeUndefined();
  });

  it("REJECTS any unrecognised token type, including ones not yet invented", () => {
    // Default-deny: a type added later is rejected without anyone remembering
    // to add it to a list.
    for (const type of [
      "mfa_challenge",
      "password_reset",
      "email_verification",
      "invite",
      "refresh",
      "service",
      "",
    ]) {
      const token = mintSigned({
        sub: "55555555-5555-4555-8555-555555555555",
        org: "66666666-6666-4666-8666-666666666666",
        role: "admin",
        se: 0,
        type,
        iat: now(),
        exp: now() + 300,
      });
      expect(verifyJwt(token), `type=${JSON.stringify(type)}`).toBeNull();
    }
  });

  it("REJECTS a non-string type claim (null, number, object, array)", () => {
    for (const type of [null, 0, 1, {}, [], true, false]) {
      const token = mintSigned({
        sub: "77777777-7777-4777-8777-777777777777",
        org: "88888888-8888-4888-8888-888888888888",
        role: "admin",
        se: 0,
        type,
        iat: now(),
        exp: now() + 300,
      });
      expect(verifyJwt(token), `type=${JSON.stringify(type)}`).toBeNull();
    }
  });

  it("ACCEPTS a token minted by signJwt, which now states its type", () => {
    const session = signJwt(
      "99999999-9999-4999-8999-999999999999",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "analyst",
      7
    );

    expect(decode(session)["type"]).toBe("session");

    const payload = verifyJwt(session);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe("99999999-9999-4999-8999-999999999999");
    expect(payload!.role).toBe("analyst");
    expect(payload!.se).toBe(7);
  });

  it("ACCEPTS a pre-fix session token that carries no type claim", () => {
    // COMPATIBILITY WINDOW — this test documents a deliberate weakening, and
    // is the one to delete when the rule is tightened to require the claim.
    // Sessions minted before SEC-TOKEN-1 shipped have no `type` and stay valid
    // for up to their 7-day lifetime; rejecting them would have logged out
    // every live user to fix a bypass that the `se` check already blunted.
    const legacy = mintSigned({
      sub: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      org: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      role: "viewer",
      se: 3,
      iat: now(),
      exp: now() + 3600,
    });

    const payload = verifyJwt(legacy);
    expect(payload).not.toBeNull();
    expect(payload!.role).toBe("viewer");
    expect(payload!.se).toBe(3);
  });
});

describe("SEC-TOKEN-1 — the invariant holds in both directions", () => {
  it("verifyMfaChallenge still refuses a full session token", () => {
    // The reverse crossover was already closed; this pins it so a future edit
    // to the shared verify shape cannot quietly open it.
    const session = signJwt(
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      "admin",
      1
    );
    expect(verifyMfaChallenge(session)).toBeNull();
  });

  it("no token is simultaneously a valid session and a valid challenge", () => {
    const challenge = signMfaChallenge(
      "ffffffff-ffff-4fff-8fff-ffffffffffff",
      "00000000-0000-4000-8000-000000000000"
    );
    const session = signJwt(
      "ffffffff-ffff-4fff-8fff-ffffffffffff",
      "00000000-0000-4000-8000-000000000000",
      "admin",
      1
    );

    for (const token of [challenge, session]) {
      const asSession = verifyJwt(token) !== null;
      const asChallenge = verifyMfaChallenge(token) !== null;
      expect(asSession && asChallenge).toBe(false);
    }
  });
});

describe("SEC-TOKEN-1 — the guard does not weaken the existing checks", () => {
  it("still rejects a bad signature, a tampered type included", () => {
    const session = signJwt(
      "11111111-2222-4333-8444-555555555555",
      "66666666-7777-4888-8999-aaaaaaaaaaaa",
      "admin",
      1
    );
    const [h, b] = session.split(".");
    // Re-sign nothing: keep the original signature, swap the body for one that
    // claims to be a session. Signature no longer matches.
    const forged = `${h}.${Buffer.from(
      JSON.stringify({
        sub: "attacker",
        org: "victim-org",
        role: "admin",
        se: 0,
        type: "session",
        iat: now(),
        exp: now() + 3600,
      }),
      "utf8"
    ).toString("base64url")}.${session.split(".")[2]}`;

    expect(forged).not.toBe(session);
    expect(b).toBeTruthy();
    expect(verifyJwt(forged)).toBeNull();
  });

  it("still rejects an expired token that correctly claims type 'session'", () => {
    const expired = mintSigned({
      sub: "22222222-3333-4444-8555-666666666666",
      org: "77777777-8888-4999-8aaa-bbbbbbbbbbbb",
      role: "admin",
      se: 1,
      type: "session",
      iat: now() - 7200,
      exp: now() - 60,
    });
    expect(verifyJwt(expired)).toBeNull();
  });

  it("still rejects a malformed token", () => {
    for (const bad of ["", "a", "a.b", "a.b.c.d", "....", "not-a-jwt"]) {
      expect(verifyJwt(bad), bad).toBeNull();
    }
  });
});
