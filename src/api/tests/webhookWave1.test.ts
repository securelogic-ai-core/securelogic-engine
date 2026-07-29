import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(), connect: vi.fn() },
  pgElevated: { query: vi.fn(), connect: vi.fn() },
}));
vi.mock("../infra/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../lib/webhookDispatcher.js", () => ({
  dispatchWebhookEvent: vi.fn().mockResolvedValue(undefined),
}));

import { dispatchWebhookEvent } from "../lib/webhookDispatcher.js";
import {
  webhookWave1Enabled,
  WAVE1_EVENT_TYPES,
} from "../lib/webhookWave1FeatureFlag.js";
import {
  createSignalWebhookBatcher,
  emitSuggestionCreated,
} from "../lib/signalWebhookEmitter.js";
import { emitBriefPublished } from "../lib/briefWebhookEmitter.js";
import { emitAcceptanceEvent } from "../lib/acceptanceWebhookEmitter.js";
import type { MatcherResult } from "../lib/cyberSignalProcessingService.js";

const dispatch = dispatchWebhookEvent as unknown as ReturnType<typeof vi.fn>;

const FLAG = "SECURELOGIC_WEBHOOK_WAVE1_ENABLED";

/** The emitters import the dispatcher lazily (dynamic import) — settle the
 * microtask queue before asserting on dispatch calls. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function matchResult(overrides: Partial<MatcherResult> = {}): MatcherResult {
  return {
    matched_vendor_id: "v1",
    matched_ai_system_id: null,
    finding: { id: "f1" },
    suggestion_id: "s1",
    match_score: 80,
    domain: "Vendor Risk",
    matched_branch: "vendor_name_ilike",
    obligation_suggestion_ids: [],
    risks_flagged: 0,
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  process.env[FLAG] = "true";
  // The emitters dynamic-import the dispatcher; preload the (mocked) module so
  // every import() inside them is a cache hit and one settle() tick suffices.
  await import("../lib/webhookDispatcher.js");
});

afterEach(() => {
  delete process.env[FLAG];
});

describe("webhookWave1Enabled — dark by default", () => {
  it("only the literal string 'true' enables", () => {
    delete process.env[FLAG];
    expect(webhookWave1Enabled()).toBe(false);
    process.env[FLAG] = "1";
    expect(webhookWave1Enabled()).toBe(false);
    process.env[FLAG] = "true";
    expect(webhookWave1Enabled()).toBe(true);
  });

  it("exports exactly the six DS-15 wave-1 event types", () => {
    expect([...WAVE1_EVENT_TYPES].sort()).toEqual([
      "acceptance.approved",
      "acceptance.expiring",
      "brief.published",
      "risk.promoted",
      "signal.matched",
      "suggestion.created",
    ]);
  });
});

describe("signal batcher — one signal.matched per org, batched", () => {
  it("N matches for one org → ONE signal.matched carrying N matches", async () => {
    const b = createSignalWebhookBatcher("pipeline");
    b.add("org-1", "sig-1", matchResult());
    b.add("org-1", "sig-2", matchResult({ suggestion_id: "s2" }));
    b.flush();
    await settle();

    const matched = dispatch.mock.calls.filter(
      (c) => c[0].event_type === "signal.matched"
    );
    expect(matched).toHaveLength(1);
    expect(matched[0][0].organization_id).toBe("org-1");
    expect(matched[0][0].data.count).toBe(2);
    expect(matched[0][0].data.matches).toHaveLength(2);
    expect(matched[0][0].data.source).toBe("pipeline");
  });

  it("two orgs → two events, each org seeing ONLY its own matches", async () => {
    const b = createSignalWebhookBatcher("kev");
    b.add("org-a", "sig-1", matchResult());
    b.add("org-b", "sig-1", matchResult({ suggestion_id: "sb" }));
    b.flush();
    await settle();

    const matched = dispatch.mock.calls.filter(
      (c) => c[0].event_type === "signal.matched"
    );
    expect(matched).toHaveLength(2);
    const byOrg = Object.fromEntries(matched.map((c) => [c[0].organization_id, c[0].data]));
    expect(byOrg["org-a"].matches[0].suggestion_id).toBe("s1");
    expect(byOrg["org-b"].matches[0].suggestion_id).toBe("sb");
  });

  it("emits suggestion.created for the vendor suggestion AND each obligation suggestion", async () => {
    const b = createSignalWebhookBatcher("pipeline");
    b.add("org-1", "sig-1", matchResult({ obligation_suggestion_ids: ["ob1", "ob2"] }));
    b.flush();
    await settle();

    const created = dispatch.mock.calls.filter(
      (c) => c[0].event_type === "suggestion.created"
    );
    expect(created.map((c) => c[0].data.suggestion_id).sort()).toEqual(["ob1", "ob2", "s1"]);
    for (const c of created) expect(c[0].organization_id).toBe("org-1");
  });

  it("no-match results are dropped; an all-no-match run emits nothing", async () => {
    const b = createSignalWebhookBatcher("pipeline");
    b.add("org-1", "sig-1", matchResult({
      matched_branch: "no_match",
      finding: null,
      suggestion_id: null,
      match_score: null,
      obligation_suggestion_ids: [],
    }));
    b.flush();
    await settle();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("payloads carry canonical IDs only — no raw signal internals", async () => {
    const b = createSignalWebhookBatcher("pipeline");
    b.add("org-1", "sig-1", matchResult());
    b.flush();
    await settle();
    const match = dispatch.mock.calls[0][0].data.matches[0];
    expect(Object.keys(match).sort()).toEqual([
      "domain",
      "finding_id",
      "match_score",
      "matched_branch",
      "obligation_suggestion_ids",
      "signal_id",
      "suggestion_id",
    ]);
  });

  it("flush is idempotent — a second flush emits nothing", async () => {
    const b = createSignalWebhookBatcher("pipeline");
    b.add("org-1", "sig-1", matchResult());
    b.flush();
    await settle();
    dispatch.mockClear();
    b.flush();
    await settle();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("flag off → add() and flush() are pure no-ops", async () => {
    delete process.env[FLAG];
    const b = createSignalWebhookBatcher("pipeline");
    b.add("org-1", "sig-1", matchResult());
    b.flush();
    await settle();
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("standalone emitters — flag-gated, org-scoped", () => {
  it("emitSuggestionCreated dispatches when on, silent when off", async () => {
    emitSuggestionCreated("org-1", {
      suggestion_id: "s9",
      signal_id: "sig-9",
      match_score: 70,
      domain: "Compliance",
      source: "applicability_engine",
    });
    await settle();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "suggestion.created",
        organization_id: "org-1",
      })
    );

    dispatch.mockClear();
    delete process.env[FLAG];
    emitSuggestionCreated("org-1", {
      suggestion_id: "s9",
      signal_id: "sig-9",
      match_score: 70,
      domain: "Compliance",
      source: "applicability_engine",
    });
    await settle();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("emitBriefPublished carries ids/counts/trigger and never brief content", () => {
    emitBriefPublished("org-1", {
      brief_id: "b1",
      signal_count: 12,
      item_count: 6,
      trigger: "scheduler",
    });
    const call = dispatch.mock.calls[0][0];
    expect(call.event_type).toBe("brief.published");
    expect(Object.keys(call.data).sort()).toEqual([
      "brief_id",
      "item_count",
      "signal_count",
      "trigger",
    ]);
  });

  it("emitAcceptanceEvent covers the three governance event names", () => {
    emitAcceptanceEvent("acceptance.approved", "org-1", { acceptance_id: "a1" });
    emitAcceptanceEvent("acceptance.expiring", "org-1", { acceptance_id: "a1" });
    emitAcceptanceEvent("risk.promoted", "org-1", { risk_id: "r1" });
    expect(dispatch.mock.calls.map((c) => c[0].event_type)).toEqual([
      "acceptance.approved",
      "acceptance.expiring",
      "risk.promoted",
    ]);
  });
});
