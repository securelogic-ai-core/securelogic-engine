/**
 * loadState — the discrimination the app kept collapsing.
 *
 * These cases ARE the product rule, not implementation detail: a failed fetch
 * must never classify as an answer, and the classifier must be incapable of
 * reporting a cause it cannot see.
 */
import { describe, it, expect } from "vitest";
import { loadState, isUnavailable } from "../loadState";

describe("loadState", () => {
  it("classifies a failed fetch as unavailable — never as empty", () => {
    expect(loadState(null, (d: { rows: unknown[] }) => d.rows)).toBe("unavailable");
    expect(loadState(undefined, (d: { rows: unknown[] }) => d.rows)).toBe("unavailable");
  });

  it("classifies a successful zero-row response as empty — an empty answer is an answer", () => {
    expect(loadState({ rows: [] }, (d) => d.rows)).toBe("empty");
  });

  it("classifies a populated response as populated", () => {
    expect(loadState({ rows: [1, 2] }, (d) => d.rows)).toBe("populated");
  });

  it("without a rows accessor, a present payload is populated (loaded/not-loaded only)", () => {
    expect(loadState({ total: 0 })).toBe("populated");
    expect(loadState(null)).toBe("unavailable");
  });

  it("treats a missing or null collection as empty, not as a failure", () => {
    // The fetch SUCCEEDED; the field was absent. That is an answer about the
    // data, so it must not be laundered back into "unavailable".
    expect(loadState({ rows: null }, (d) => d.rows)).toBe("empty");
    expect(loadState({} as { rows?: unknown[] }, (d) => d.rows)).toBe("empty");
  });

  it("distinguishes an empty payload object from a null one", () => {
    expect(loadState({}, () => [])).toBe("empty");
    expect(loadState(null, () => [])).toBe("unavailable");
  });
});

describe("isUnavailable", () => {
  it("is true only for a failed fetch", () => {
    expect(isUnavailable(null)).toBe(true);
    expect(isUnavailable(undefined)).toBe(true);
    expect(isUnavailable({ vendors: [] })).toBe(false);
  });

  it("does not treat falsy-but-present payloads as failures", () => {
    // A reader that legitimately resolves to 0 or "" has still ANSWERED.
    expect(isUnavailable(0)).toBe(false);
    expect(isUnavailable("")).toBe(false);
    expect(isUnavailable(false)).toBe(false);
  });
});
