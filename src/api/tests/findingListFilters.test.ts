import { describe, it, expect } from "vitest";
import { resolveOwnerMeFilter } from "../lib/findingListFilters.js";

describe("resolveOwnerMeFilter (owner=me security contract)", () => {
  it("no owner param → no filter", () => {
    expect(resolveOwnerMeFilter(undefined, "u1")).toEqual({ kind: "none" });
    expect(resolveOwnerMeFilter("", "u1")).toEqual({ kind: "none" });
    expect(resolveOwnerMeFilter(null, "u1")).toEqual({ kind: "none" });
  });

  it("owner=me resolves the SESSION user id server-side", () => {
    expect(resolveOwnerMeFilter("me", "u1")).toEqual({ kind: "me", userId: "u1" });
  });

  it("rejects any client-supplied user id — assignments cannot be enumerated", () => {
    expect(resolveOwnerMeFilter("11111111-1111-1111-1111-111111111111", "u1")).toEqual({
      kind: "error",
      error: "owner_filter_only_me",
    });
    expect(resolveOwnerMeFilter("someone-else", "u1")).toEqual({ kind: "error", error: "owner_filter_only_me" });
    expect(resolveOwnerMeFilter(["me"], "u1")).toEqual({ kind: "error", error: "owner_filter_only_me" });
  });

  it("owner=me without a session identity (API-key caller) is rejected, never defaulted", () => {
    expect(resolveOwnerMeFilter("me", null)).toEqual({ kind: "error", error: "owner_me_requires_user_identity" });
    expect(resolveOwnerMeFilter("me", undefined)).toEqual({ kind: "error", error: "owner_me_requires_user_identity" });
    expect(resolveOwnerMeFilter("me", "")).toEqual({ kind: "error", error: "owner_me_requires_user_identity" });
  });
});
