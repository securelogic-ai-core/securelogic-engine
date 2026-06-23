/**
 * Seat-limit regression pin for teamInvites.ts.
 *
 * The seat cap (organizations.max_members) is enforced live in production at
 * invite time but was previously untested. The invite-create handler is an
 * inline route closure (not exported), so this pins the enforcement at the
 * source level: a regression that drops the count, the cap read, or the 409
 * reddens CI here. Mirrors the entity-limit wiring guards in entityLimit.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const SRC = readFileSync(resolve(__dirname, "../routes/teamInvites.ts"), "utf8");

describe("teamInvites — seat-limit enforcement", () => {
  it("counts active members for the org", () => {
    expect(SRC).toMatch(
      /COUNT\(\*\)[\s\S]{0,60}FROM users[\s\S]{0,80}organization_id = \$1[\s\S]{0,40}status = 'active'/
    );
  });

  it("reads the cap from organizations.max_members, defaulting to 10", () => {
    expect(SRC).toMatch(/SELECT max_members[\s\S]{0,60}FROM organizations WHERE id = \$1/);
    expect(SRC).toMatch(/max_members\s*\?\?\s*10/);
  });

  it("returns 409 seat_limit_reached when used >= max", () => {
    expect(SRC).toMatch(/usedSeats\s*>=\s*maxSeats/);
    expect(SRC).toMatch(/status\(409\)[\s\S]{0,120}seat_limit_reached/);
  });

  it("blocks BEFORE inserting the invite (cap check precedes the INSERT)", () => {
    const capIdx = SRC.indexOf("seat_limit_reached");
    const insertIdx = SRC.search(/INSERT INTO org_invites/);
    expect(capIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(capIdx);
  });
});
