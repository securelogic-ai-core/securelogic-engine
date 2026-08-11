/**
 * Renewal visibility (#692 A9): the engine has returned current_period_end /
 * amount / currency / interval from GET /api/billing/subscription since the
 * live-Stripe read shipped, and the app typed them — but rendered none of
 * them, so an active subscriber (including $7,200 Platform Annual) had no
 * in-app way to see when the next charge lands or for how much.
 *
 * Contract pinned here (source-shape, same idiom as commercialTruth.test.ts —
 * the page is an async server component behind iron-session, out of reach of
 * the render harness):
 *  - the Renews row exists and is fed by current_period_end + the shared
 *    price formatter,
 *  - it renders ONLY for an active subscription (trialing keeps the existing
 *    trial block; none/canceled shows neither).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "../page.tsx"), "utf8");

describe("/account renewal row", () => {
  it("renders a Renews row from the live subscription read", () => {
    expect(src).toMatch(/\{renewLabel && <Row label="Renews" value=\{renewLabel\} \/>\}/);
    expect(src).toMatch(/subscription\?\.current_period_end/);
  });

  it("is gated on an active subscription only", () => {
    expect(src).toMatch(/const isActiveSub = subscription\?\.status === "active"/);
    expect(src).toMatch(/isActiveSub && subscription\?\.current_period_end/);
  });

  it("uses the shared price formatter (no hardcoded amounts)", () => {
    const renewalIdx = src.indexOf("Renewal visibility");
    const slice = src.slice(renewalIdx, renewalIdx + 900);
    expect(slice).toMatch(/formatSubscriptionPrice\(/);
    expect(slice).not.toMatch(/\$7,?200|\$800|\$199|\$49/);
  });
});
