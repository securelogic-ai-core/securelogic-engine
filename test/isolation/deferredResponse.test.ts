/**
 * deferredResponse.test.ts — A04-G1 PR β1.5: unit tests for the
 * commit-before-respond buffering shim (src/api/middleware/deferredResponse.ts).
 *
 * Pure unit — NO database, NO HTTP. Drives the proxy directly against a fake
 * Express response and asserts the five contracts from design §5.2:
 *
 *   1. status()/json() are buffered; nothing reaches the real res until commit().
 *   2. discard() flushes nothing.
 *   3. Streaming / early-flush methods throw TenantWrapStreamingError.
 *   4. Unsupported methods throw TenantWrapUnsupportedResponseError (named).
 *   5. A second json() throws TenantWrapDoubleResponseError.
 */

import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";

import {
  createDeferredResponse,
  TenantWrapStreamingError,
  TenantWrapUnsupportedResponseError,
  TenantWrapDoubleResponseError,
} from "../../src/api/middleware/deferredResponse.js";

interface FakeRes extends Response {
  statusCode: number;
  body?: unknown;
  headersSent: boolean;
}

/** Minimal fake of the real res the shim replays onto. */
function fakeRes(): FakeRes {
  const res = {} as FakeRes;
  res.statusCode = 0;
  res.body = undefined;
  res.headersSent = false;
  res.locals = { tenant: "probe" } as Response["locals"];
  res.status = ((code: number) => {
    res.statusCode = code;
    return res;
  }) as Response["status"];
  res.json = ((body: unknown) => {
    res.body = body;
    res.headersSent = true;
    return res;
  }) as Response["json"];
  res.getHeader = ((name: string) =>
    name === "X-Probe" ? "probe-value" : undefined) as Response["getHeader"];
  return res;
}

describe("A04-G1 PR β1.5 — deferredResponse shim", () => {
  it("buffers status()+json() and only flushes them on commit()", () => {
    const real = fakeRes();
    const statusSpy = vi.spyOn(real, "status");
    const jsonSpy = vi.spyOn(real, "json");

    const { proxy, commit } = createDeferredResponse(real);

    // Handler runs: chains status().json() on the proxy.
    const chained = proxy.status(201).json({ finding: { id: "abc" } });
    expect(chained).toBe(proxy); // chainable, returns the proxy

    // Nothing has reached the real response yet.
    expect(statusSpy).not.toHaveBeenCalled();
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(real.statusCode).toBe(0);
    expect(real.body).toBeUndefined();
    expect(real.headersSent).toBe(false);

    // COMMIT succeeded → replay.
    commit();

    expect(statusSpy).toHaveBeenCalledWith(201);
    expect(jsonSpy).toHaveBeenCalledWith({ finding: { id: "abc" } });
    expect(real.statusCode).toBe(201);
    expect(real.body).toEqual({ finding: { id: "abc" } });
    expect(real.headersSent).toBe(true);
  });

  it("discard() flushes nothing to the real response", () => {
    const real = fakeRes();
    const statusSpy = vi.spyOn(real, "status");
    const jsonSpy = vi.spyOn(real, "json");

    const { proxy, discard } = createDeferredResponse(real);
    proxy.status(200).json({ ok: true });

    discard();

    expect(statusSpy).not.toHaveBeenCalled();
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(real.statusCode).toBe(0);
    expect(real.body).toBeUndefined();
    expect(real.headersSent).toBe(false);
  });

  it("passes through safe read-only accessors (getHeader, locals)", () => {
    const real = fakeRes();
    const { proxy } = createDeferredResponse(real);

    expect(proxy.getHeader("X-Probe")).toBe("probe-value");
    expect((proxy.locals as { tenant?: string }).tenant).toBe("probe");
  });

  it("throws TenantWrapStreamingError on streaming / early-flush methods", () => {
    const real = fakeRes();
    const { proxy } = createDeferredResponse(real);

    const streamingCalls: Array<() => unknown> = [
      () => (proxy as unknown as { write: (c: string) => void }).write("chunk"),
      () => (proxy as unknown as { end: (c: string) => void }).end("chunk"),
      () => (proxy as unknown as { pipe: (s: unknown) => void }).pipe({}),
      () => (proxy as unknown as { send: (b: unknown) => void }).send("x"),
      () => (proxy as unknown as { sendFile: (p: string) => void }).sendFile("/x"),
      () => (proxy as unknown as { download: (p: string) => void }).download("/x"),
    ];

    for (const call of streamingCalls) {
      expect(call).toThrow(TenantWrapStreamingError);
    }

    // Message references the design doc.
    expect(() =>
      (proxy as unknown as { write: (c: string) => void }).write("x")
    ).toThrow(/A04-G1-pr-beta1\.5-design\.md/);

    // Nothing leaked to the real response.
    expect(real.headersSent).toBe(false);
  });

  it("throws TenantWrapUnsupportedResponseError (named) on header setters & friends", () => {
    const real = fakeRes();
    const { proxy } = createDeferredResponse(real);

    expect(() =>
      (proxy as unknown as { setHeader: (k: string, v: string) => void }).setHeader("a", "b")
    ).toThrow(TenantWrapUnsupportedResponseError);
    expect(() =>
      (proxy as unknown as { set: (k: string, v: string) => void }).set("a", "b")
    ).toThrow(TenantWrapUnsupportedResponseError);
    expect(() =>
      (proxy as unknown as { cookie: (k: string, v: string) => void }).cookie("a", "b")
    ).toThrow(TenantWrapUnsupportedResponseError);
    expect(() =>
      (proxy as unknown as { redirect: (u: string) => void }).redirect("/x")
    ).toThrow(TenantWrapUnsupportedResponseError);
    expect(() =>
      (proxy as unknown as { type: (t: string) => void }).type("text/html")
    ).toThrow(TenantWrapUnsupportedResponseError);

    // The thrown message names the offending method.
    expect(() =>
      (proxy as unknown as { setHeader: (k: string, v: string) => void }).setHeader("a", "b")
    ).toThrow(/res\.setHeader\(\)/);
  });

  it("throws TenantWrapDoubleResponseError when json() is called twice", () => {
    const real = fakeRes();
    const { proxy } = createDeferredResponse(real);

    proxy.status(200).json({ first: true });
    expect(() => proxy.json({ second: true })).toThrow(TenantWrapDoubleResponseError);
  });

  it("is non-thenable: Promise.resolve(proxy) does not throw and resolves to the proxy", async () => {
    // A handler written `return res.json(...)` returns the proxy (json() is
    // chainable). asTenant does `Promise.resolve(handlerResult)`, which probes
    // `.then`. If `.then` were the loud-reject function, Promise resolution would
    // treat the proxy as a thenable, CALL `then(resolve, reject)`, and reject the
    // wrap with TenantWrapUnsupportedResponseError. then/catch/finally must read
    // back as undefined so the proxy is a plain value that resolves to itself.
    const real = fakeRes();
    const { proxy } = createDeferredResponse(real);

    // The thenable trio is undefined, not a (throwing) function.
    expect((proxy as unknown as { then?: unknown }).then).toBeUndefined();
    expect((proxy as unknown as { catch?: unknown }).catch).toBeUndefined();
    expect((proxy as unknown as { finally?: unknown }).finally).toBeUndefined();

    // The `return res.json(...)` idiom: handler returns the proxy.
    const handlerResult = proxy.status(201).json({ created: true });
    expect(handlerResult).toBe(proxy);

    // Promise.resolve must NOT throw and must resolve to the proxy itself —
    // not adopt it as a thenable. Nothing flushed to the real response.
    await expect(Promise.resolve(handlerResult)).resolves.toBe(proxy);
    expect(real.headersSent).toBe(false);
  });
});
