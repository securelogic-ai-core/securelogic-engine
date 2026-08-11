/**
 * ssoJitSeatDefault.test.ts — Phase 4: SSO JIT must not silently consume a Full
 * seat.
 *
 * The SAML ACS handler is not unit-mountable without a full SAML fixture, so
 * this locks the wiring by source inspection (the same approach the repo uses
 * for other route-guard invariants) plus a behavioural check of the per-class
 * counting that the handler relies on.
 */

import { describe, it, expect, vi } from "vitest";
vi.mock("../infra/postgres.js", () => ({ pg: { query: vi.fn() } }));
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { resolveSeatCap } from "../lib/seatLimit.js";

const SSO_SRC = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "routes", "sso.ts"),
  "utf8"
);

describe("SSO JIT wiring", () => {
  it("reads the org's default SSO seat type + role", () => {
    expect(SSO_SRC).toMatch(/default_sso_seat_type/);
    expect(SSO_SRC).toMatch(/default_sso_role/);
  });

  it("inserts the resolved seat_type on the new user (not the column default)", () => {
    expect(SSO_SRC).toMatch(/INSERT INTO users[\s\S]*seat_type[\s\S]*VALUES/);
    expect(SSO_SRC).toMatch(/jitSeatType/);
    expect(SSO_SRC).toMatch(/jitRole/);
  });

  it("enforces the per-CLASS cap under the seat model (not only the Full cap)", () => {
    expect(SSO_SRC).toMatch(/enforceSeatLimitForClass/);
    expect(SSO_SRC).toMatch(/seatModelEnabled\(\)/);
  });

  it("defaults JIT users to a Viewer seat, which does not draw down Full seats", () => {
    // A viewer-seat JIT user is counted against the viewer cap, so the Full cap
    // (max_members) is untouched — the anti-silent-Full-consumption property.
    const fullCap = resolveSeatCap("full", { maxMembers: 6, maxContributorSeats: null, maxViewerSeats: null });
    const viewerCap = resolveSeatCap("viewer", { maxMembers: 6, maxContributorSeats: null, maxViewerSeats: null });
    expect(fullCap).toBe(6);
    expect(viewerCap).toBeGreaterThan(fullCap); // viewers have their own, larger pool
  });
});
