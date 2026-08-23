/**
 * vendorPortalStaticInvariants.test.ts — Stop Gate B, criterion B.2.
 *
 * The portal's central safety property is that NO route reads an
 * authorization-bearing identifier from the caller. Every one comes from
 * `req.portalContext`, which `requirePortalSession` resolved from the session
 * row, so a caller cannot even express the attack.
 *
 * While there were four handlers this was verifiable by reading them. There are
 * now eleven, and the property is exactly the kind that decays by addition: the
 * next handler someone writes will look like the others, and `body.engagement_id`
 * would pass review because it reads naturally.
 *
 * So this test greps the source. It is deliberately crude — a parser would be
 * more precise and would also be something a future author has to understand
 * before they can satisfy it. Failing loudly on a string match is the point.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const ROUTER = resolve(here, "../routes/vendorPortal.ts");
const source = readFileSync(ROUTER, "utf8");

/**
 * Just the router-wiring block. Counting middleware across the whole file is
 * wrong: the import statement lists the same identifiers, in the same
 * `name,`-per-line shape, and inflates every count by one.
 */
const wiring = source.slice(source.indexOf("// Router wiring"));

/**
 * Identifiers that decide WHOSE data a request touches. A selector inside an
 * already-authorized scope — `requirementId`, `evidenceId` — is not on this list:
 * those are validated against the session's engagement before use, which is the
 * standard IDOR-safe pattern. These are different, because reading one from the
 * caller would let the caller choose the scope itself.
 */
const AUTHORIZATION_IDENTIFIERS = [
  "organization_id",
  "organizationId",
  "engagement_id",
  "engagementId",
  "vendor_id",
  "vendorId",
  "user_id",
  "userId",
  "invite_id",
  "inviteId",
  "session_id",
  "sessionId",
];

/** Every way a handler could read caller-controlled input in this file. */
const CALLER_INPUT = String.raw`(?:req\.body|req\.query|req\.params|body|query|params)`;

describe("vendor portal — INVARIANT 1: no authorization identifier comes from the caller", () => {
  for (const key of AUTHORIZATION_IDENTIFIERS) {
    it(`never reads \`${key}\` from a body, query or param`, () => {
      // Dot access: body.engagement_id
      const dot = new RegExp(`${CALLER_INPUT}\\s*\\.\\s*${key}\\b`);
      // Bracket access: req.params["engagementId"], body['organization_id']
      const bracket = new RegExp(`${CALLER_INPUT}\\s*\\[\\s*["'\`]${key}["'\`]\\s*\\]`);
      // Destructuring: const { engagement_id } = req.body
      const destructure = new RegExp(`\\{[^}]*\\b${key}\\b[^}]*\\}\\s*=\\s*${CALLER_INPUT}`);

      for (const [label, pattern] of [
        ["dot access", dot],
        ["bracket access", bracket],
        ["destructuring", destructure],
      ] as const) {
        const match = source.match(pattern);
        expect(
          match,
          `vendorPortal.ts reads \`${key}\` from caller input via ${label}: ` +
            `"${match?.[0] ?? ""}". Authorization identifiers must come from ` +
            `req.portalContext, which requirePortalSession resolved from the session row.`
        ).toBeNull();
      }
    });
  }

  it("the only source of org and engagement is portalContext", () => {
    // Positive counterpart: assert the safe pattern is actually present, so the
    // suite cannot pass because the handlers stopped scoping altogether.
    expect(source).toMatch(/req\.portalContext!/);
    expect(source.match(/ctx\.organizationId/g)?.length ?? 0).toBeGreaterThan(5);
    expect(source.match(/ctx\.engagementId/g)?.length ?? 0).toBeGreaterThan(5);
  });

  it("every route is behind the flag AND the session resolver", () => {
    // requirePortalSession is absent from exactly one route — the invite
    // exchange, which is what CREATES a session. If that count ever exceeds one,
    // a route has been left unauthenticated.
    const routes = wiring.match(/router\.(get|post|put|delete)\(/g) ?? [];
    // Nineteen, which is the full portal surface: session exchange and sign-out,
    // engagement read, questionnaire read and save, submit, evidence upload /
    // list / withdraw, the comment thread read and post, — VA-P1 — the vendor's
    // own team (participants read, invite a teammate, revoke one), and — VA-D1 —
    // delegation (assignments read, one question's assignment history, assign or
    // reassign a question, bulk-assign a framework, the progress board).
    //
    // This number is a TRIPWIRE, not bookkeeping. Every route added to an
    // externally-reachable surface has to come past this assertion, so bump it
    // only together with the two counts below, which are what actually prove
    // the new route is behind the kill switch and the session resolver.
    expect(routes.length).toBe(19);

    const flagged = wiring.match(/vendorPortalFeatureFlag,/g) ?? [];
    expect(flagged.length, "every route must carry the kill switch").toBe(routes.length);

    const guarded = wiring.match(/requirePortalSession,/g) ?? [];
    expect(
      guarded.length,
      "exactly one route (the invite exchange) may omit requirePortalSession"
    ).toBe(routes.length - 1);
  });

  it("no route hands out a storage key or a signed URL", () => {
    // The portal is metadata-only by design. A download path here would be an
    // unauthenticated read channel into the org's evidence store.
    expect(source).not.toMatch(/getEvidenceFileSignedUrl|getSignedReadUrl/);
    // `storage_key` is written on upload and tested for NULL in the quota query,
    // so its mere presence is expected. What must never appear is the key as a
    // RESPONSE property — that is the shape that would leak it to the vendor.
    expect(source).not.toMatch(/storage_key\s*:/);
  });

  it("visibility is never taken from the request", () => {
    // An internal-only comment must be impossible to author from outside. The
    // route pins 'vendor' literally; the table's CHECK is the backstop.
    expect(source).not.toMatch(/(?:body|req\.body)\s*\.\s*visibility/);
    // author_type and visibility are both SQL literals in the INSERT, never
    // bound parameters — a value that is never bound cannot be supplied.
    expect(source).toMatch(/VALUES\s*\([^)]*'vendor'[^)]*'vendor'[^)]*\)/);
  });
});
