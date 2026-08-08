/**
 * GET /api/briefing/changes (EG2 Tier 2 slice 10) — source-level pins, same
 * style as the evidence/recent route pins: the safety-critical properties are
 * structural and cheap to verify against the source.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const src = readFileSync(
  resolve(__dirname, "../routes/briefingChanges.ts"),
  "utf-8"
);

describe("GET /api/briefing/changes — gate, chain, scope", () => {
  it("is dark behind the engine Briefing flag (404 while off, like the layout routes)", () => {
    expect(src).toMatch(/SECURELOGIC_DASHBOARD_BRIEFING_ENABLED/);
    expect(src).toMatch(/briefingDisabled\(\)/);
    expect(src).toMatch(/404/);
  });

  it("runs behind the full tenant chain", () => {
    expect(src).toMatch(/requireApiKey/);
    expect(src).toMatch(/attachOrganizationContext/);
    expect(src).toMatch(/requireEntitlement\("premium"\)/);
    expect(src).toMatch(/asTenant\(/);
  });

  it("every subquery is org-scoped — six populations, six organization_id predicates", () => {
    const matches = src.match(/organization_id = \$1/g) ?? [];
    expect(matches.length).toBe(6);
  });

  it("validates and CLAMPS `since` — never an unbounded history scan", () => {
    expect(src).toMatch(/since_must_be_iso_timestamp/);
    expect(src).toMatch(/since_must_be_in_the_past/);
    expect(src).toMatch(/MAX_WINDOW_DAYS = 90/);
    // The clamp is reported so the UI can say "showing the last 90 days".
    expect(src).toMatch(/clamped/);
  });

  it("transition counts come from the append-only lifecycle stream, deduped per finding", () => {
    expect(src).toMatch(/finding_lifecycle_events/);
    const dedup = src.match(/COUNT\(DISTINCT finding_id\)/g) ?? [];
    expect(dedup.length).toBe(2); // remediated + resolved
    expect(src).toMatch(/axis = 'operational' AND to_state = 'remediated'/);
    expect(src).toMatch(/axis = 'decision' AND to_state = 'resolved'/);
  });

  it("newly-overdue means BECAME overdue inside the window, not all standing overdue work", () => {
    expect(src).toMatch(/due_date < CURRENT_DATE/);
    expect(src).toMatch(/due_date >= \$2::date/);
  });
});
