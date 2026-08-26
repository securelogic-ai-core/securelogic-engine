/**
 * sessionBillingHygiene.test.ts — SL-BILL-1 PR-G (defect D7).
 *
 * `session.billingActive` was written by ten routes and read by NOTHING. Dead
 * state is bad enough; this was also INCONSISTENT — half the writers used the
 * engine's payment-failure-aware value and half used
 * `entitlementLevel !== "starter"`, which answers a different question — so the
 * cookie's contents depended on which door the user came in through.
 *
 * It was DELETED rather than unified, because a payment-state cache in a cookie
 * is stale by construction: a session minted while billing was healthy keeps
 * claiming billingActive:true for the life of the cookie, long after the card
 * failed. The obvious future temptation — "render the dunning banner from the
 * session and skip the fetch" — would therefore have shown the reassuring
 * answer to exactly the customer PR-A and PR-B exist to warn.
 *
 * This file exists so that temptation fails CI instead of shipping. It is a
 * source-shape test on purpose: the contract is an ABSENCE, and absence is not
 * observable from a rendered page.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";

const APP_SRC = resolve(__dirname, "../..");

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

const FILES = walk(APP_SRC);

describe("D7 — session.billingActive is gone and stays gone", () => {
  it("no file writes session.billingActive", () => {
    const offenders = FILES.filter((f) =>
      /session\.billingActive\s*=/.test(readFileSync(f, "utf8"))
    ).map((f) => f.replace(APP_SRC, "src"));

    expect(offenders).toEqual([]);
  });

  it("no file reads session.billingActive", () => {
    const offenders = FILES.filter((f) => {
      const src = readFileSync(f, "utf8");
      return /session\.billingActive/.test(src) && !/DELIBERATELY ABSENT/.test(src);
    }).map((f) => f.replace(APP_SRC, "src"));

    expect(offenders).toEqual([]);
  });

  it("SessionData does not declare the field", () => {
    const session = readFileSync(resolve(APP_SRC, "lib/session.ts"), "utf8");

    expect(session).not.toMatch(/^\s*billingActive\?:/m);
    // The tombstone stays, so the next person to reach for it reads why first.
    expect(session).toMatch(/DELIBERATELY ABSENT/);
  });

  it("the wire types still carry billingActive — the API is the source of truth", () => {
    // Deleting the SESSION field must not be mistaken for deleting the concept.
    // /api/me and /api/auth/me remain authoritative and payment-failure-aware.
    const api = readFileSync(resolve(APP_SRC, "lib/api.ts"), "utf8");

    expect(api).toMatch(/billingActive:\s*boolean/);
  });
});
