/**
 * intelligenceLinks.test.ts — pure link/visibility helpers for the Intelligence
 * Event drill-through entry points (ERIP Package 3.3, PR-3). Covers href
 * construction, id extraction, and the queue-link gating without a DOM/RTL
 * harness (the app has none). The JSX call sites are thin wrappers over these.
 */

import { describe, it, expect } from "vitest";
import {
  intelligenceEventHref,
  findingEventId,
  queueIntelligenceHref,
} from "../intelligenceLinks";

describe("intelligenceEventHref", () => {
  it("builds the bare drill-through href", () => {
    expect(intelligenceEventHref("evt-1")).toBe("/intelligence/evt-1");
  });

  it("carries the originating finding when provided", () => {
    expect(intelligenceEventHref("evt-1", "find-9")).toBe("/intelligence/evt-1?finding=find-9");
  });

  it("URL-encodes both ids", () => {
    expect(intelligenceEventHref("a b/c", "f/1")).toBe("/intelligence/a%20b%2Fc?finding=f%2F1");
  });

  it("omits the finding param for null/undefined", () => {
    expect(intelligenceEventHref("evt-1", null)).toBe("/intelligence/evt-1");
    expect(intelligenceEventHref("evt-1", undefined)).toBe("/intelligence/evt-1");
  });
});

describe("findingEventId", () => {
  it("returns the id when present", () => {
    expect(findingEventId({ id: "evt-1", title: "x" })).toBe("evt-1");
  });

  it("returns null when the id is missing, blank, or non-string (renders plain text)", () => {
    expect(findingEventId({ title: "x" })).toBeNull();
    expect(findingEventId({ id: "" })).toBeNull();
    expect(findingEventId({ id: 123 })).toBeNull();
  });
});

describe("queueIntelligenceHref", () => {
  it("returns a drill-through href only in the workspace reskin with an event id", () => {
    expect(queueIntelligenceHref(true, "evt-1")).toBe("/intelligence/evt-1");
  });

  it("suppresses the link when the workspace reskin is off (legacy queue unchanged)", () => {
    expect(queueIntelligenceHref(false, "evt-1")).toBeNull();
  });

  it("suppresses the link when the row has no event id", () => {
    expect(queueIntelligenceHref(true, null)).toBeNull();
    expect(queueIntelligenceHref(true, undefined)).toBeNull();
    expect(queueIntelligenceHref(true, "")).toBeNull();
  });
});
