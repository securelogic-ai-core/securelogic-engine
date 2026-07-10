import { describe, it, expect } from "vitest";
import {
  toggleSelection,
  isAllSelected,
  toggleSelectAll,
  pruneSelection,
  summarizeBulkResult,
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
