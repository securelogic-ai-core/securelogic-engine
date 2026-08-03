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

describe("savedViewHref — queue-controls browse keys (EG2 slice 4)", () => {
  it("pins queue=all when any queue-only key is present, so the view opens the browse queue", () => {
    expect(savedViewHref({ q: "backup", severity: "Critical", sort: "severity" })).toBe(
      "/findings?severity=Critical&q=backup&sort=severity&queue=all"
    );
  });

  it("legacy-only views keep their exact legacy URL — no queue pin", () => {
    expect(savedViewHref({ severity: "Critical", status: "open" })).toBe(
      "/findings?status=open&severity=Critical"
    );
  });

  it("currentViewFilters captures the queue params an analyst filtered by", () => {
    expect(
      currentViewFilters({ q: "backup", governance: "needs_review", mine: "1", page: "3", junk: "x" })
    ).toEqual({ q: "backup", governance: "needs_review", mine: "1" });
  });
});
