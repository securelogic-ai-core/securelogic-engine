import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  webhookEventCatalog,
  webhookEventTypes,
} from "../lib/webhookEventCatalog.js";
import { WAVE1_EVENT_TYPES } from "../lib/webhookWave1FeatureFlag.js";

const FLAG = "SECURELOGIC_WEBHOOK_WAVE1_ENABLED";

const BASE_TYPES = [
  "finding.created",
  "finding.updated",
  "risk.created",
  "vendor.assessed",
  "posture.snapshot_created",
  "action.created",
  "action.updated",
];

describe("webhookEventCatalog", () => {
  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env[FLAG];
    delete process.env[FLAG];
  });

  afterEach(() => {
    if (previous === undefined) delete process.env[FLAG];
    else process.env[FLAG] = previous;
  });

  it("flag-off: exposes exactly the seven pre-wave-1 event types", () => {
    expect(webhookEventTypes()).toEqual(BASE_TYPES);
  });

  it("flag-off: never reveals a wave-1 event type", () => {
    const types = webhookEventTypes();
    for (const t of WAVE1_EVENT_TYPES) {
      expect(types).not.toContain(t);
    }
  });

  it("flag-on: appends every wave-1 type after the base types", () => {
    process.env[FLAG] = "true";
    expect(webhookEventTypes()).toEqual([...BASE_TYPES, ...WAVE1_EVENT_TYPES]);
  });

  it("only the exact string 'true' enables wave-1 entries", () => {
    for (const v of ["", "false", "1", "TRUE", "yes"]) {
      process.env[FLAG] = v;
      expect(webhookEventTypes()).toEqual(BASE_TYPES);
    }
  });

  it("every catalog entry carries a non-empty description", () => {
    process.env[FLAG] = "true";
    for (const entry of webhookEventCatalog()) {
      expect(entry.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("every wave-1 type has real prose, not the fallback echo", () => {
    process.env[FLAG] = "true";
    const byType = new Map(
      webhookEventCatalog().map((e) => [e.event_type, e.description])
    );
    for (const t of WAVE1_EVENT_TYPES) {
      expect(byType.get(t)).toBeDefined();
      // A description equal to the type name means WAVE1_DESCRIPTIONS drifted
      // from the flag module's vocabulary and hit the fallback.
      expect(byType.get(t)).not.toBe(t);
    }
  });

  it("the wildcard is not a catalog entry (it is a subscription shape)", () => {
    process.env[FLAG] = "true";
    expect(webhookEventTypes()).not.toContain("*");
  });

  it("reads the flag at call time, so no restart is needed", () => {
    expect(webhookEventTypes()).toEqual(BASE_TYPES);
    process.env[FLAG] = "true";
    expect(webhookEventTypes().length).toBe(
      BASE_TYPES.length + WAVE1_EVENT_TYPES.length
    );
    delete process.env[FLAG];
    expect(webhookEventTypes()).toEqual(BASE_TYPES);
  });
});
