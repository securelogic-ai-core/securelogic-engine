/**
 * askToolFailureLogging.test.ts — every non-2xx tool result emits exactly one
 * log line.
 *
 * WHY THIS EXISTS. Until this test, a failed tool call produced no log output
 * at all: `tool_execution_failed` fires only on a THROWN exception, and a 400
 * or a 403 is not one. The DB ledger recorded the error code, but a degraded
 * Ask was undiagnosable from logs — which is precisely how the defects fixed in
 * 256015b7 and 1f8da416 stayed hidden. Both presented as an answer that was
 * merely wrong; both were non-2xx tool results the process never mentioned, and
 * each needed a live staging reproduction to find.
 *
 * So the assertions here are about OBSERVABILITY, and the two negative ones —
 * no argument values, no response body — are about not paying for it with a
 * customer-data leak into the log stream.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// hoisted: vi.mock is lifted above the const declarations otherwise.
const { warn, info, error } = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));
vi.mock("../infra/logger.js", () => ({ logger: { info, warn, error } }));

import type { Request, RequestHandler } from "express";

import { executeTool } from "../tools/executor.js";
import type { ToolDefinition } from "../tools/types.js";

/** A tool whose whole chain is one handler answering with a fixed status. */
function toolReturning(status: number, body: unknown): ToolDefinition {
  const handler: RequestHandler = (_req, res) => {
    res.status(status).json(body);
  };
  return {
    name: "findings.search",
    description: "test double",
    inputSchema: { type: "object", properties: {} },
    actionClass: "read",
    binding: { method: "GET", path: "/findings" },
    chain: [handler],
  };
}

/** Minimal originating request — the executor inherits from it prototypally. */
const origin = { headers: {} } as unknown as Request;

function lastWarn(): Record<string, unknown> {
  expect(warn).toHaveBeenCalledTimes(1);
  return warn.mock.calls[0]![0] as Record<string, unknown>;
}

describe("executeTool — non-2xx results are logged", () => {
  beforeEach(() => {
    warn.mockClear();
    info.mockClear();
    error.mockClear();
  });

  it("logs a 400 with the route's own error code, so the cause is readable", async () => {
    const result = await executeTool(
      origin,
      toolReturning(400, { error: "invalid_status_filter" }),
      { status: "active", severity: "Critical" }
    );

    expect(result).toMatchObject({ ok: false, error: "invalid_arguments", status: 400 });

    const logged = lastWarn();
    expect(logged).toMatchObject({
      event: "ask_tool_result_failed",
      tool: "findings.search",
      action_class: "read",
      status: 400,
      error: "invalid_arguments",
      // THE line that would have saved a live reproduction in 1f8da416.
      route_error: "invalid_status_filter",
    });
    expect(logged.arg_keys).toEqual(["status", "severity"]);
    expect(typeof logged.latency_ms).toBe("number");
  });

  it("logs a denial as warn — a refusal is diagnosable but must not page anyone", async () => {
    const result = await executeTool(origin, toolReturning(403, { error: "forbidden" }), {});

    expect(result).toMatchObject({ ok: false, error: "denied", status: 403 });
    expect(lastWarn()).toMatchObject({
      event: "ask_tool_result_failed",
      status: 403,
      error: "denied",
    });
    // Denials are an expected outcome of the authorization model.
    expect(error).not.toHaveBeenCalled();
  });

  it("logs a 409 workflow refusal with the route's reason", async () => {
    const result = await executeTool(origin, toolReturning(409, { error: "cannot_decide" }), {});

    expect(result).toMatchObject({ ok: false, error: "unavailable", status: 409 });
    expect(lastWarn()).toMatchObject({
      status: 409,
      error: "unavailable",
      route_error: "cannot_decide",
    });
  });

  it("logs a chain that never responded, which would otherwise be silent twice over", async () => {
    const noop: RequestHandler = (_req, _res, next) => {
      next();
    };
    const result = await executeTool(
      origin,
      { ...toolReturning(200, {}), chain: [noop] },
      {}
    );

    expect(result).toMatchObject({ ok: false, error: "unavailable", status: 500 });
    expect(lastWarn()).toMatchObject({ event: "ask_tool_result_failed", status: 500 });
  });

  it("stays SILENT on success — the log is a failure channel, not a trace", async () => {
    const result = await executeTool(origin, toolReturning(200, { findings: [] }), {});

    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(warn).not.toHaveBeenCalled();
  });

  it("never logs argument VALUES or the response body", async () => {
    await executeTool(
      origin,
      toolReturning(400, { error: "bad", findings: [{ title: "CVE-2026-1 on payroll" }] }),
      { vendor_name: "Acme Payroll Ltd", note: "breach suspected" }
    );

    // Keys are diagnostic; values and bodies are customer risk data, and the
    // ledger is already the system of record for the invocation itself.
    const serialized = JSON.stringify(lastWarn());
    expect(serialized).not.toContain("Acme Payroll Ltd");
    expect(serialized).not.toContain("breach suspected");
    expect(serialized).not.toContain("CVE-2026-1");
    expect(lastWarn().arg_keys).toEqual(["vendor_name", "note"]);
  });
});
