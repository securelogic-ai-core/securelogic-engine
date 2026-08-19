/**
 * auditGate.test.ts — operator-required proofs for the CI dependency-audit
 * gate (scripts/ci/auditGate.mjs). Proof 1 (the remediated baseline passes) is
 * demonstrated by the live gate run in CI itself; these fixtures pin the other
 * four required behaviors:
 *
 *   2. a NEW high+ production advisory fails the gate;
 *   3. an approved waiver applies ONLY to the named advisory and only until
 *      its expiry;
 *   4. an EXPIRED waiver fails;
 *   5. an unrelated advisory cannot hide behind an existing waiver.
 */

import { describe, expect, it } from "vitest";

// The gate is plain ESM used by CI; vitest imports it directly.
// @ts-expect-error — .mjs module without type declarations, shape asserted below.
import { evaluateAudit, extractAdvisories } from "../../../scripts/ci/auditGate.mjs";

/** Minimal npm-audit-v2-shaped fixture with one gated advisory. */
function auditFixture(entries: Array<{ pkg: string; id: string; severity: string; title?: string }>): unknown {
  const vulnerabilities: Record<string, { name: string; severity: string; via: unknown[]; fixAvailable: boolean }> = {};
  for (const e of entries) {
    const via = {
      source: 1,
      name: e.pkg,
      title: e.title ?? "synthetic advisory",
      url: `https://github.com/advisories/${e.id}`,
      severity: e.severity
    };
    if (vulnerabilities[e.pkg]) vulnerabilities[e.pkg].via.push(via);
    else vulnerabilities[e.pkg] = { name: e.pkg, severity: e.severity, via: [via], fixAvailable: true };
  }
  return { vulnerabilities, metadata: {} };
}

const NOW = new Date("2026-08-17T12:00:00Z");
const SYNTH = "GHSA-AAAA-BBBB-CCCC";
const OTHER = "GHSA-DDDD-EEEE-FFFF";

describe("audit gate proofs", () => {
  it("(2) a synthetic new HIGH production advisory FAILS the gate", () => {
    const r = evaluateAudit(auditFixture([{ pkg: "undici", id: SYNTH, severity: "high" }]), { waivers: [] }, NOW);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].advisory.id).toBe(SYNTH);
    expect(r.failures[0].reason).toBe("no waiver");
  });

  it("(2b) moderate/low advisories do not gate", () => {
    const r = evaluateAudit(auditFixture([{ pkg: "x", id: SYNTH, severity: "moderate" }]), { waivers: [] }, NOW);
    expect(r.failures).toHaveLength(0);
    expect(extractAdvisories(auditFixture([{ pkg: "x", id: SYNTH, severity: "critical" }]))).toHaveLength(1);
  });

  it("(3) an approved, unexpired waiver passes the NAMED advisory only", () => {
    const waivers = { waivers: [{ id: SYNTH, reason: "triaged: unreachable", expires: "2026-09-01", approvedBy: "operator" }] };
    const r = evaluateAudit(auditFixture([{ pkg: "undici", id: SYNTH, severity: "high" }]), waivers, NOW);
    expect(r.failures).toHaveLength(0);
    expect(r.waived).toHaveLength(1);
    expect(r.waived[0].advisory.id).toBe(SYNTH);
  });

  it("(4) an EXPIRED waiver fails the advisory again", () => {
    const waivers = { waivers: [{ id: SYNTH, reason: "was acceptable", expires: "2026-08-01", approvedBy: "operator" }] };
    const r = evaluateAudit(auditFixture([{ pkg: "undici", id: SYNTH, severity: "high" }]), waivers, NOW);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].reason).toContain("EXPIRED 2026-08-01");
  });

  it("(4b) a waiver without a valid expiry never passes anything", () => {
    const waivers = { waivers: [{ id: SYNTH, reason: "forever?", approvedBy: "operator" }] };
    const r = evaluateAudit(auditFixture([{ pkg: "undici", id: SYNTH, severity: "high" }]), waivers, NOW);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].reason).toContain("no valid expiry");
  });

  it("(5) an unrelated advisory cannot hide behind an existing waiver — even in the SAME package", () => {
    const waivers = { waivers: [{ id: SYNTH, reason: "triaged", expires: "2026-09-01", approvedBy: "operator" }] };
    const r = evaluateAudit(
      auditFixture([
        { pkg: "undici", id: SYNTH, severity: "high" },
        { pkg: "undici", id: OTHER, severity: "high", title: "different, newer advisory" }
      ]),
      waivers,
      NOW
    );
    expect(r.waived.map(w => w.advisory.id)).toEqual([SYNTH]);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].advisory.id).toBe(OTHER);
  });

  it("a stale waiver (advisory gone) is surfaced for removal, not silently kept", () => {
    const waivers = { waivers: [{ id: SYNTH, reason: "old", expires: "2026-09-01", approvedBy: "operator" }] };
    const r = evaluateAudit(auditFixture([]), waivers, NOW);
    expect(r.failures).toHaveLength(0);
    expect(r.stale).toHaveLength(1);
  });
});
