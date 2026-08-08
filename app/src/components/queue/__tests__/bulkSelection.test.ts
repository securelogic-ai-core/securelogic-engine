import { describe, it, expect } from "vitest";
import {
  toggleSelection,
  isAllSelected,
  toggleSelectAll,
  pruneSelection,
  summarizeBulkResult,
  partitionAcceptEligible,
} from "../bulkSelection";

describe("toggleSelection", () => {
  it("adds then removes an id immutably", () => {
    expect(toggleSelection([], "a")).toEqual(["a"]);
    expect(toggleSelection(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("isAllSelected / toggleSelectAll", () => {
  it("isAllSelected requires every visible id present and a non-empty list", () => {
    expect(isAllSelected(["a", "b"], ["a", "b"])).toBe(true);
    expect(isAllSelected(["a"], ["a", "b"])).toBe(false);
    expect(isAllSelected([], [])).toBe(false);
  });
  it("selects all when not all selected, clears when all selected", () => {
    expect(toggleSelectAll(["a"], ["a", "b"])).toEqual(["a", "b"]);
    expect(toggleSelectAll(["a", "b"], ["a", "b"])).toEqual([]);
  });
});

describe("pruneSelection", () => {
  it("drops ids no longer visible", () => {
    expect(pruneSelection(["a", "b", "c"], ["a", "c"])).toEqual(["a", "c"]);
  });
});

describe("summarizeBulkResult", () => {
  it("all-success", () => {
    expect(summarizeBulkResult("accept", 3, 0)).toBe("3 accepted.");
    expect(summarizeBulkResult("dismiss", 5, 0)).toBe("5 dismissed.");
  });
  it("all-fail", () => {
    expect(summarizeBulkResult("accept", 0, 2)).toBe("Could not accept 2 — please retry.");
  });
  it("partial", () => {
    expect(summarizeBulkResult("dismiss", 8, 2)).toBe("8 dismissed, 2 failed — please retry those.");
  });
});

describe("partitionAcceptEligible", () => {
  const types = new Map([
    ["a", "vendor"],
    ["b", "asset"],
    ["c", "control"],
    ["d", "asset"],
  ]);

  it("splits asset rows out of a bulk accept (engine refuses them until the link store ships)", () => {
    expect(partitionAcceptEligible(["a", "b", "c", "d"], types)).toEqual({
      eligible: ["a", "c"],
      skipped: ["b", "d"],
    });
  });

  it("ids missing from the map are treated as eligible (fail open to the engine's own checks)", () => {
    expect(partitionAcceptEligible(["z"], types)).toEqual({ eligible: ["z"], skipped: [] });
  });
});

describe("summarizeBulkResult — skipped assets suffix", () => {
  it("appends the skip explanation when assets were excluded", () => {
    expect(summarizeBulkResult("accept", 3, 0, 2)).toBe(
      "3 accepted. 2 asset suggestions skipped — accept for assets is coming soon.",
    );
    expect(summarizeBulkResult("accept", 0, 0, 1)).toBe(
      "0 accepted. 1 asset suggestion skipped — accept for assets is coming soon.",
    );
  });

  it("no suffix when nothing was skipped (pre-registry behavior unchanged)", () => {
    expect(summarizeBulkResult("accept", 3, 0)).toBe("3 accepted.");
    expect(summarizeBulkResult("accept", 3, 0, 0)).toBe("3 accepted.");
  });
});
