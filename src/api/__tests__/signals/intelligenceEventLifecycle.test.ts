/**
 * intelligenceEventLifecycle.test.ts — Intelligence Pipeline Hardening.
 *
 * Pins the 7-state lifecycle: evidence→state derivation and time-based
 * resolution/archival.
 */

import { describe, it, expect } from "vitest";
import {
  deriveLifecycleState,
  ageLifecycleState,
  isAuthoritativeSource,
  RESOLVE_AFTER_DAYS,
  ARCHIVE_AFTER_DAYS
} from "../../lib/signals/intelligenceEventLifecycle.js";

describe("deriveLifecycleState", () => {
  const base = { sourceCount: 1, hasAuthoritative: false, everExploited: false, everPatched: false };

  it("new for a single non-authoritative source", () => {
    expect(deriveLifecycleState(base)).toBe("new");
  });
  it("corroborating for two non-authoritative sources", () => {
    expect(deriveLifecycleState({ ...base, sourceCount: 2 })).toBe("corroborating");
  });
  it("confirmed for an authoritative source or 3+ sources", () => {
    expect(deriveLifecycleState({ ...base, hasAuthoritative: true })).toBe("confirmed");
    expect(deriveLifecycleState({ ...base, sourceCount: 3 })).toBe("confirmed");
  });
  it("actively_exploited when exploited (overrides corroboration)", () => {
    expect(deriveLifecycleState({ ...base, everExploited: true })).toBe("actively_exploited");
    expect(deriveLifecycleState({ ...base, sourceCount: 5, hasAuthoritative: true, everExploited: true })).toBe("actively_exploited");
  });
  it("mitigated when patched, and when exploited+patched (fix for the active threat)", () => {
    expect(deriveLifecycleState({ ...base, everPatched: true })).toBe("mitigated");
    expect(deriveLifecycleState({ ...base, everExploited: true, everPatched: true })).toBe("mitigated");
  });
});

describe("ageLifecycleState", () => {
  it("keeps fresh events unchanged", () => {
    expect(ageLifecycleState("confirmed", 5)).toBe("confirmed");
  });
  it("resolves a mitigated event after the resolve window", () => {
    expect(ageLifecycleState("mitigated", RESOLVE_AFTER_DAYS)).toBe("resolved");
    expect(ageLifecycleState("mitigated", RESOLVE_AFTER_DAYS - 1)).toBe("mitigated");
  });
  it("archives any non-active event after the archive window", () => {
    expect(ageLifecycleState("confirmed", ARCHIVE_AFTER_DAYS)).toBe("archived");
    expect(ageLifecycleState("resolved", ARCHIVE_AFTER_DAYS)).toBe("archived");
  });
  it("never auto-ages an actively_exploited event", () => {
    expect(ageLifecycleState("actively_exploited", ARCHIVE_AFTER_DAYS + 100)).toBe("actively_exploited");
  });
});

describe("isAuthoritativeSource", () => {
  it("recognizes authoritative sources case-insensitively", () => {
    expect(isAuthoritativeSource("NVD")).toBe(true);
    expect(isAuthoritativeSource("cisa_kev")).toBe(true);
    expect(isAuthoritativeSource("bleepingcomputer")).toBe(false);
  });
});
