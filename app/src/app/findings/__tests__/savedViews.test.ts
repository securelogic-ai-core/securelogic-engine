import { describe, it, expect } from "vitest";
import {
  savedViewHref,
  currentViewFilters,
  filtersEqual,
  hasAnyFilter,
} from "../savedViews";

describe("savedViewHref", () => {
  it("builds a /findings URL from whitelisted filters in stable key order", () => {
    expect(savedViewHref({ severity: "Critical", status: "open" })).toBe("/findings?status=open&severity=Critical");
  });
  it("returns bare /findings when there are no filters", () => {
    expect(savedViewHref({})).toBe("/findings");
  });
});

describe("currentViewFilters", () => {
  it("keeps only whitelisted, non-empty params", () => {
    expect(currentViewFilters({ status: "open", severity: "", page: "2", junk: "x" })).toEqual({ status: "open" });
  });
});

describe("filtersEqual", () => {
  it("treats missing and empty as equivalent", () => {
    expect(filtersEqual({ status: "open" }, { status: "open" })).toBe(true);
    expect(filtersEqual({ status: "open", severity: undefined }, { status: "open" })).toBe(true);
    expect(filtersEqual({ status: "open" }, { status: "closed" })).toBe(false);
  });
});

describe("hasAnyFilter", () => {
  it("is true only when at least one filter is set", () => {
    expect(hasAnyFilter({})).toBe(false);
    expect(hasAnyFilter({ status: "" })).toBe(false);
    expect(hasAnyFilter({ domain: "Vendor Risk" })).toBe(true);
  });
});
