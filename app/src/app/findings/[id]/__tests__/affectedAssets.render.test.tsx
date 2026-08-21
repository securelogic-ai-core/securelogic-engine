/**
 * affectedAssets.render.test.tsx — the sentence this package exists to make true.
 *
 * "Affected assets: 17 · Active: 12 · No longer observed: 5" is what an executive
 * reads, so the tests that matter are the ones about what those words mean:
 * the counts come from the server rollup and NOT from the visible page, and
 * "no longer observed" is never rendered as "remediated".
 */

import { readFileSync } from "fs";
import { resolve } from "path";

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { AffectedAssetsPanel } from "../AffectedAssetsPanel";
import type { FindingOccurrence, OccurrenceRollup } from "@/lib/api";

const FINDING = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

const occ = (over: Partial<FindingOccurrence> = {}): FindingOccurrence => ({
  id: `o-${Math.abs(Math.round(Number(over.reappeared_count ?? 0)))}-${over.asset_id ?? "x"}`,
  finding_id: FINDING,
  asset_id: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
  presence_status: "present",
  first_seen_at: "2026-08-01T00:00:00.000Z",
  last_seen_at: "2026-08-19T00:00:00.000Z",
  absent_since: null,
  remediated_at: null,
  reappeared_count: 0,
  last_reappeared_at: null,
  source: "import",
  source_occurrence_id: null,
  asset_type: "endpoint",
  asset_lifecycle_status: "active",
  ...over,
});

const rollup = (over: Partial<OccurrenceRollup> = {}): OccurrenceRollup => ({
  affected: 17, active: 12, absent: 5, remediated: 0, recurring: 0, ...over,
});

describe("the headline counts", () => {
  it("renders affected / active / no longer observed", () => {
    render(<AffectedAssetsPanel findingId={FINDING} occurrences={[occ()]}
      rollup={rollup()} limit={25} offset={0} />);
    // The phrase appears twice by design: as the section heading and as the
    // count label. Both are wanted.
    expect(screen.getAllByText("Affected assets").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("17")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getAllByText("No longer observed").length).toBeGreaterThan(0);
  });

  it("uses the SERVER rollup, not the length of the visible page", () => {
    // One row on screen, seventeen affected. Counting the page would print 1 and
    // would look entirely plausible.
    render(<AffectedAssetsPanel findingId={FINDING} occurrences={[occ()]}
      rollup={rollup()} limit={25} offset={0} />);
    expect(screen.getByText("17")).toBeTruthy();
  });

  it("never labels 'no longer observed' as remediated", () => {
    // Absence is something a scan stopped seeing; remediation is something a
    // person did. Collapsing them overstates the product's own effectiveness.
    render(<AffectedAssetsPanel findingId={FINDING}
      occurrences={[occ({ presence_status: "absent", absent_since: "2026-08-20T00:00:00.000Z" })]}
      rollup={rollup({ affected: 1, active: 0, absent: 1, remediated: 0 })}
      limit={25} offset={0} />);
    const cells = screen.getAllByText("No longer observed");
    expect(cells.length).toBeGreaterThan(0);
    expect(screen.queryByText("Fixed")).toBeNull();
  });

  it("shows recurrence only when it happened", () => {
    const { rerender } = render(<AffectedAssetsPanel findingId={FINDING} occurrences={[occ()]}
      rollup={rollup()} limit={25} offset={0} />);
    expect(screen.queryByText("Recurring")).toBeNull();
    rerender(<AffectedAssetsPanel findingId={FINDING}
      occurrences={[occ({ reappeared_count: 2, last_reappeared_at: "2026-08-18T00:00:00.000Z" })]}
      rollup={rollup({ recurring: 1 })} limit={25} offset={0} />);
    expect(screen.getByText("Recurring")).toBeTruthy();
    expect(screen.getByText("Returned 2×")).toBeTruthy();
  });
});

describe("a vulnerability with no asset", () => {
  it("is a state, not an error or an empty table", () => {
    render(<AffectedAssetsPanel findingId={FINDING} occurrences={[]}
      rollup={rollup({ affected: 0, active: 0, absent: 0, remediated: 0 })}
      limit={25} offset={0} />);
    expect(screen.getByText(/No asset recorded/i)).toBeTruthy();
    expect(screen.getByText(/valid state/i)).toBeTruthy();
  });

  it("renders no table and no counts when nothing is affected", () => {
    render(<AffectedAssetsPanel findingId={FINDING} occurrences={[]}
      rollup={rollup({ affected: 0, active: 0, absent: 0, remediated: 0 })}
      limit={25} offset={0} />);
    expect(screen.queryByText("Active")).toBeNull();
  });
});

describe("pagination", () => {
  it("offers Next while more remain", () => {
    render(<AffectedAssetsPanel findingId={FINDING} occurrences={[occ()]}
      rollup={rollup()} limit={1} offset={0} />);
    expect(screen.getByText(/Next/)).toBeTruthy();
    expect(screen.queryByText(/Previous/)).toBeNull();
    expect(screen.getByText("1–1 of 17")).toBeTruthy();
  });

  it("offers Previous once past the first page", () => {
    render(<AffectedAssetsPanel findingId={FINDING} occurrences={[occ()]}
      rollup={rollup()} limit={1} offset={5} />);
    expect(screen.getByText(/Previous/)).toBeTruthy();
    expect(screen.getByText("6–6 of 17")).toBeTruthy();
  });

  it("hides both controls when everything fits on one page", () => {
    render(<AffectedAssetsPanel findingId={FINDING} occurrences={[occ()]}
      rollup={rollup({ affected: 1, active: 1, absent: 0 })} limit={25} offset={0} />);
    expect(screen.queryByText(/Next/)).toBeNull();
    expect(screen.queryByText(/Previous/)).toBeNull();
  });
});


describe("the panel exists in BOTH finding-detail layouts", () => {
  // The Decision Workspace is a DIFFERENT TREE, not a restyling of the legacy
  // page. A panel added to only one of them disappears the moment
  // SECURELOGIC_DECISION_WORKSPACE_ENABLED flips — which is exactly the
  // regression SL-DW-ACTIVATE had to repair for the Risk Register panel. This
  // asserts at the source level because no single render exercises both trees.
  const PAGE = readFileSync(
    resolve(__dirname, "../page.tsx"),
    "utf8",
  );

  it("is rendered twice — once per layout", () => {
    const uses = PAGE.split("<AffectedAssetsPanel").length - 1;
    expect(uses).toBe(2);
  });

  it("is passed to the Decision Workspace as its own zone, not inside a tab", () => {
    expect(PAGE).toMatch(/affectedAssets=\{/);
  });

  it("travels with the Risk Register panel, which has the same requirement", () => {
    const riskUses = PAGE.split("<RiskRegisterPanel").length - 1;
    expect(riskUses).toBe(2);
  });
});
