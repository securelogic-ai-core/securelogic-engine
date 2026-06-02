/**
 * deferredResponse.ts — A04-G1 PR β1.5: the commit-before-respond buffering shim.
 *
 * See docs/A04-G1-pr-beta1.5-design.md (Approach B, §3).
 *
 * Problem this closes: `withTenant` (src/api/infra/postgres.ts) runs
 * BEGIN → handler → COMMIT → release. A wrapped handler that ends with
 * `res.status(n).json(body)` flushes the success response BEFORE `withTenant`
 * issues COMMIT. If COMMIT then fails (connection death, failover, deferred
 * constraint, timeout) the row is rolled back but the client already holds a
 * 2xx — an acknowledged-but-lost write. PR β1 made the window reachable by
 * wrapping the findings writes; β1.5 closes it.
 *
 * Mechanism: `asTenant` hands the route handler this PROXY instead of the real
 * `res`. The proxy BUFFERS `status()`/`json()` (it never touches the socket).
 * After `withTenant` resolves — i.e. after COMMIT has succeeded — `asTenant`
 * calls `commit()`, which replays the buffered status+body onto the real `res`.
 * If `withTenant` rejects (COMMIT failed, or the handler threw), `asTenant`
 * calls `discard()` (a wire no-op — nothing was ever flushed) and forwards the
 * error, so the existing `internalError(res)` path produces a clean 500 because
 * `res.headersSent` is still false.
 *
 * Resolved design decisions this implements (design §4):
 *   - 4.1/4.4: supported surface is STRICTLY `status` + `json`. Streaming /
 *     early-flush methods throw TenantWrapStreamingError; every other method
 *     throws TenantWrapUnsupportedResponseError naming the method. No defensive
 *     buffering of `send` or header setters — fail loud, not silent.
 *   - 4.3: applied uniformly to every asTenant-wrapped route (reads pay only a
 *     single buffered replay; writes get the correctness guarantee).
 *
 * Every thrown error references this design doc so the next engineer lands on
 * the rationale rather than a bare stack trace.
 */

import type { Response } from "express";

const DESIGN_DOC = "docs/A04-G1-pr-beta1.5-design.md";

/**
 * Thrown when a wrapped handler calls a streaming / early-flush response method
 * (res.write, res.end with a chunk, res.pipe, res.send, res.sendFile, …). Such
 * routes cannot be buffered for commit-before-respond and must stream outside
 * the tenant transaction (commit-then-stream).
 */
export class TenantWrapStreamingError extends Error {
  constructor(method: string) {
    super(
      `asTenant-wrapped handler called res.${method}() — streaming or early-flush ` +
        `responses cannot be buffered for commit-before-respond. Stream outside the ` +
        `tenant transaction (commit-then-stream). See ${DESIGN_DOC} §3.2/§3.6.`
    );
    this.name = "TenantWrapStreamingError";
  }
}

/**
 * Thrown when a wrapped handler calls any response method other than
 * status()/json() (e.g. set/setHeader/header/cookie/redirect/type). These are
 * deliberately not buffered; a route that needs them extends the shim with its
 * own test rather than getting silent best-effort behaviour.
 */
export class TenantWrapUnsupportedResponseError extends Error {
  constructor(method: string) {
    super(
      `asTenant-wrapped handler called res.${method}() — only res.status() and ` +
        `res.json() are supported inside the tenant wrap. Header setters and other ` +
        `response methods are not buffered; extend the shim deliberately (with a test) ` +
        `if a route genuinely needs them. See ${DESIGN_DOC} §3.2.`
    );
    this.name = "TenantWrapUnsupportedResponseError";
  }
}

/**
 * Thrown when a wrapped handler calls res.json() more than once — a buffered
 * handler must produce exactly one terminal response (usually a missing
 * `return` after an early error response).
 */
export class TenantWrapDoubleResponseError extends Error {
  constructor() {
    super(
      `asTenant-wrapped handler called res.json() twice — a buffered handler must ` +
        `produce exactly one terminal response (likely a missing 'return' after an ` +
        `error response). See ${DESIGN_DOC} §3.3.`
    );
    this.name = "TenantWrapDoubleResponseError";
  }
}

/**
 * Thrown at commit() if the real response was somehow flushed outside the
 * proxy (res.headersSent === true) so the buffered response cannot be replayed.
 * Should be unreachable in practice — the handler only ever sees the proxy.
 */
export class TenantWrapAlreadySentError extends Error {
  constructor() {
    super(
      `asTenant deferred-response commit found res.headersSent === true — the real ` +
        `response was flushed outside the buffering proxy and cannot be replayed. ` +
        `See ${DESIGN_DOC} §3.5.`
    );
    this.name = "TenantWrapAlreadySentError";
  }
}

/** Methods that stream or flush early — cannot be buffered. */
const STREAMING_METHODS = new Set<string>([
  "write",
  "end",
  "send",
  "sendFile",
  "sendfile",
  "download",
  "pipe",
  "writeHead",
  "flushHeaders",
  "sendStatus",
]);

/** Read-only properties safe to delegate to the real response. */
const PASS_THROUGH_READS = new Set<string>(["getHeader", "locals", "req"]);

export interface DeferredResponse {
  /** Pass this to the route handler INSTEAD of the real res. */
  proxy: Response;
  /** Replay the buffered status+body onto the real res. Call AFTER COMMIT succeeds. */
  commit: () => void;
  /** Drop the buffer without touching the wire. Call when the transaction fails. */
  discard: () => void;
}

/**
 * Build a buffering proxy around `realRes`. The proxy captures status()/json()
 * and replays them on commit(); every other response method throws.
 */
export function createDeferredResponse(realRes: Response): DeferredResponse {
  let statusCode: number | undefined;
  let terminalBody: unknown;
  let hasTerminal = false;

  const proxy = new Proxy(
    {},
    {
      get(_target, prop): unknown {
        // Symbol access (Symbol.toPrimitive, util.inspect, iterator…): return
        // undefined so the proxy is never mistaken for an iterable/primitive.
        if (typeof prop === "symbol") return undefined;

        // Thenable trio (then/catch/finally): also return undefined. A handler
        // written `return res.json(...)` returns this proxy; `asTenant` does
        // `Promise.resolve(handlerResult)`, which probes `.then`. If `.then`
        // were the loud-reject function below, Promise resolution would treat
        // the proxy as a thenable, CALL `then(resolve, reject)`, and reject the
        // wrap with TenantWrapUnsupportedResponseError instead of running the
        // transaction. Returning undefined makes Promise.resolve treat the
        // proxy as a plain (non-thenable) value that resolves to itself.
        if (prop === "then" || prop === "catch" || prop === "finally") {
          return undefined;
        }

        if (prop === "status") {
          return (code: number): Response => {
            statusCode = code;
            return proxy;
          };
        }

        if (prop === "json") {
          return (body: unknown): Response => {
            if (hasTerminal) throw new TenantWrapDoubleResponseError();
            hasTerminal = true;
            terminalBody = body;
            return proxy;
          };
        }

        if (PASS_THROUGH_READS.has(prop)) {
          const value = (realRes as unknown as Record<string, unknown>)[prop];
          return typeof value === "function"
            ? (value as (...args: unknown[]) => unknown).bind(realRes)
            : value;
        }

        if (STREAMING_METHODS.has(prop)) {
          return (): never => {
            throw new TenantWrapStreamingError(prop);
          };
        }

        // Anything else (set/setHeader/header/cookie/redirect/type/…): loud-reject,
        // naming the method, rather than silently delegating to realRes (which would
        // flush and reintroduce the respond-before-commit bug).
        return (): never => {
          throw new TenantWrapUnsupportedResponseError(prop);
        };
      },
    }
  ) as unknown as Response;

  function commit(): void {
    if (!hasTerminal) {
      // Handler resolved without responding — a bug. Surfacing it as an error
      // turns a hung socket into a clean 500 via the error handler.
      throw new Error(
        `asTenant-wrapped handler resolved without calling res.json() — no buffered ` +
          `response to replay. See ${DESIGN_DOC} §3.3.`
      );
    }
    if (realRes.headersSent) {
      throw new TenantWrapAlreadySentError();
    }
    if (statusCode !== undefined) {
      realRes.status(statusCode);
    }
    realRes.json(terminalBody);
  }

  function discard(): void {
    // No-op on the wire: nothing was ever flushed to the socket, so dropping the
    // buffered status/json is all that's required. See design §3.3.
  }

  return { proxy, commit, discard };
}
