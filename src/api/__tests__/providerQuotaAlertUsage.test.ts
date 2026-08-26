/**
 * providerQuotaAlertUsage.test.ts — the SDK wrapper's SUCCESS-path telemetry.
 *
 * The wrapper previously observed only throws (quota/credit alerting) and never
 * read `message.usage`, so spend was unmeasurable. It now records tokens and
 * latency on success too — while preserving the property that made the original
 * wrapper correct: it must NOT replace the object `messages.create` returns.
 * The SDK's own `messages.stream()` calls `.withResponse()` on that object, and
 * an earlier async wrapper here broke every streaming turn by returning a plain
 * Promise. These tests pin both halves.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../infra/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));
vi.mock("../infra/alerting.js", () => ({ sendSecurityAlert: vi.fn(async () => {}) }));
vi.mock("../lib/sentry.js", () => ({ captureException: vi.fn() }));

import { instrumentAnthropicClient } from "../infra/providerQuotaAlert.js";
import {
  beginLlmRunAccumulation,
  endLlmRunAccumulation,
  resetLlmRunAccumulationForTest,
  withLlmCallContext
} from "../lib/llm/llmTelemetry.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

const fakeClient = (impl: () => unknown) => ({ messages: { create: vi.fn(impl) } });

describe("instrumentAnthropicClient — usage capture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLlmRunAccumulationForTest();
  });

  it("records tokens and latency from a successful response", async () => {
    const client = fakeClient(async () => ({
      usage: {
        input_tokens: 1500,
        output_tokens: 300,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 50
      }
    }));
    instrumentAnthropicClient(client as never);

    beginLlmRunAccumulation();
    await withLlmCallContext({ purpose: "brief_headline", organizationId: "org-1" }, () =>
      client.messages.create({ model: "claude-sonnet-4-6" })
    );
    await flush();
    const totals = endLlmRunAccumulation();

    expect(totals.calls).toBe(1);
    expect(totals.input_tokens).toBe(1500);
    expect(totals.output_tokens).toBe(300);
    expect(totals.cache_read_tokens).toBe(100);
    expect(totals.cache_write_tokens).toBe(50);
    expect(totals.cost_usd).toBeGreaterThan(0);
    expect(totals.by_purpose["brief_headline"]?.calls).toBe(1);
  });

  it("records a failed call (latency, no cost) and still re-throws the original error", async () => {
    const boom = new Error("upstream exploded");
    const client = fakeClient(async () => {
      throw boom;
    });
    instrumentAnthropicClient(client as never);

    beginLlmRunAccumulation();
    await expect(client.messages.create({ model: "claude-sonnet-4-6" })).rejects.toBe(boom);
    await flush();
    const totals = endLlmRunAccumulation();

    expect(totals.calls).toBe(1);
    expect(totals.failed_calls).toBe(1);
    expect(totals.cost_usd).toBe(0);
  });

  it("does NOT replace the returned object — SDK helper methods survive", async () => {
    // messages.stream() calls .withResponse() on what create() returns.
    const apiPromise = Object.assign(Promise.resolve({ usage: { input_tokens: 1 } }), {
      withResponse: () => "sdk-helper-intact"
    });
    const client = fakeClient(() => apiPromise);
    instrumentAnthropicClient(client as never);

    const returned = client.messages.create({ model: "claude-sonnet-4-6" }) as typeof apiPromise;

    expect(returned).toBe(apiPromise);
    expect(returned.withResponse()).toBe("sdk-helper-intact");
    await flush();
  });

  it("tolerates a result with no usage (streaming handle) without recording a call", async () => {
    const client = fakeClient(async () => ({ on: () => {} }));
    instrumentAnthropicClient(client as never);

    beginLlmRunAccumulation();
    await client.messages.create({ model: "claude-sonnet-4-6" });
    await flush();

    expect(endLlmRunAccumulation().calls).toBe(0);
  });

  it("attributes an unknown model as unpriced rather than free", async () => {
    const client = fakeClient(async () => ({
      usage: { input_tokens: 1000, output_tokens: 100 }
    }));
    instrumentAnthropicClient(client as never);

    beginLlmRunAccumulation();
    await client.messages.create({ model: "model-we-do-not-price" });
    await flush();
    const totals = endLlmRunAccumulation();

    expect(totals.calls).toBe(1);
    expect(totals.unpriced_calls).toBe(1);
    expect(totals.cost_usd).toBe(0);
  });
});
