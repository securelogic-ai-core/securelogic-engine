/**
 * executor.ts — runs a bound tool by executing the canonical route's FULL
 * middleware chain in the requesting user's security context.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SECURITY MODEL IS "WE RUN THE PRODUCT'S CODE", NOT "WE CHECK THE SAME
 * THINGS THE PRODUCT CHECKS".
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The synthetic request INHERITS the real request's authenticated state by
 * reference — the same apiKey row, the same organizationContext, the same
 * userId, the same seat scope. It does not reconstruct them, and there is no
 * code path here that can widen them. So requireApiKey, attachOrganizationContext,
 * requireEntitlement, denyContributor, requireCapability, ownerCondition,
 * mayAccessOwned and asTenant/RLS all evaluate exactly as they would for a
 * direct HTTP call from that same user.
 *
 * Consequences worth stating, because they are the point:
 *
 *   - A Contributor seat gets Contributor-scoped rows, automatically, because
 *     `isAssignedScope(req)` reads the inherited seat scope.
 *   - A cross-org id returns the handler's own 404, because the handler's own
 *     org predicate runs.
 *   - A capability the user lacks 403s inside requireCapability, not here.
 *
 * ── What is deliberately NOT possible ───────────────────────────────────────
 *
 * There is no parameter, option or escape hatch for supplying an organization
 * id, impersonating a user, or skipping middleware. Tool arguments fill path
 * params, query and body — never identity. A tool that could name a tenant would
 * be precisely the privileged bypass ASK-A forbids.
 *
 * This module also never imports `pg`, `pgElevated` or `withTenant`. A static
 * test asserts that for the whole `src/api/tools/` tree: the tool layer must be
 * physically incapable of reaching the database except through a route.
 */

import type { Request, RequestHandler, Response } from "express";

import { logger } from "../infra/logger.js";
import type { ToolDefinition, ToolInvocationResult } from "./types.js";

/** Hard ceiling on a single tool call, so one slow route cannot hang a turn. */
const TOOL_TIMEOUT_MS = 15_000;

/**
 * Build the synthetic request. Auth-bearing fields are copied from the ORIGINATING
 * request; only the routing surface (method/path/params/query/body) comes from the
 * tool call.
 */
function buildToolRequest(
  origin: Request,
  tool: ToolDefinition,
  args: Record<string, unknown>
): Request {
  const pathParams: Record<string, string> = {};
  const rest: Record<string, unknown> = { ...args };

  for (const name of tool.binding.pathParams ?? []) {
    const value = rest[name];
    if (value !== undefined && value !== null) pathParams[name] = String(value);
    delete rest[name];
  }

  const isRead = tool.binding.method === "GET";

  // Query values must be strings — Express would have parsed them from a URL,
  // and handlers use isNonEmptyString()/parseLimit() on that assumption.
  const query: Record<string, string> = {};
  if (isRead) {
    for (const [k, v] of Object.entries(rest)) {
      if (v === undefined || v === null) continue;
      query[k] = String(v);
    }
  }

  const proto = Object.create(Object.getPrototypeOf(origin) as object) as Request;

  return Object.assign(proto, origin, {
    method: tool.binding.method,
    url: tool.binding.path,
    originalUrl: tool.binding.path,
    path: tool.binding.path,
    params: pathParams,
    query,
    body: isRead ? {} : rest,
    // A tool call is not a browser navigation; drop anything route code might
    // read from headers that would be misleading in this context.
    headers: { ...origin.headers, "content-type": "application/json" },
  }) as Request;
}

/**
 * A capturing Response. Handlers call status()/json() as normal; nothing is
 * written to a socket.
 *
 * Streaming and header-setting handlers are NOT supported: a tool must be bound
 * to a JSON route. setHeader/redirect/write throw loudly rather than silently
 * producing an empty result, which is the same posture asTenant's buffering
 * proxy takes for the same reason.
 */
type Captured = { status: number; body: unknown; settled: boolean };

function buildToolResponse(captured: Captured): Response {
  const unsupported = (op: string) => () => {
    throw new Error(
      `tool_route_not_json: a bound tool route called res.${op}(). Tools may only ` +
        `bind to handlers that respond with status()+json().`
    );
  };

  const res = {
    statusCode: 200,
    headersSent: false,
    status(code: number) {
      captured.status = code;
      (this as unknown as { statusCode: number }).statusCode = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload;
      captured.settled = true;
      return this;
    },
    send(payload: unknown) {
      captured.body = payload;
      captured.settled = true;
      return this;
    },
    setHeader: unsupported("setHeader"),
    writeHead: unsupported("writeHead"),
    write: unsupported("write"),
    redirect: unsupported("redirect"),
    end() {
      captured.settled = true;
      return this;
    },
  };

  return res as unknown as Response;
}

/**
 * Run an Express middleware chain to completion.
 *
 * Resolves when a handler settles the response OR the chain is exhausted.
 * Rejects only on a thrown error / next(err) — i.e. a genuine fault, not a
 * denial. A middleware that denies (403/404) settles the response normally and
 * simply never calls next(), which ends the walk.
 */
async function runChain(
  chain: RequestHandler[],
  req: Request,
  res: Response,
  captured: Captured
): Promise<void> {
  let index = 0;

  return new Promise<void>((resolve, reject) => {
    const next = (err?: unknown): void => {
      if (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      // A middleware settled the response (denial or success) — stop walking.
      if (captured.settled) {
        resolve();
        return;
      }
      const handler = chain[index++];
      if (!handler) {
        resolve();
        return;
      }
      try {
        const maybe = (handler as unknown as (
          r: Request,
          s: Response,
          n: (e?: unknown) => void
        ) => unknown)(req, res, next);
        // Async handlers that reject must not become unhandled rejections.
        if (maybe && typeof (maybe as Promise<unknown>).then === "function") {
          (maybe as Promise<unknown>).then(
            () => {
              if (captured.settled) resolve();
            },
            (e: unknown) => next(e)
          );
        } else if (captured.settled) {
          resolve();
        }
      } catch (e) {
        next(e);
      }
    };

    next();
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`tool_timeout:${label}`)), ms);
    timer.unref?.();
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * Execute a tool in the security context of `origin`.
 *
 * NEVER throws for an application outcome. A denial is a typed result, so the
 * orchestration loop can hand the model "you are not authorized to see that"
 * without the turn collapsing.
 */
export async function executeTool(
  origin: Request,
  tool: ToolDefinition,
  args: Record<string, unknown>
): Promise<ToolInvocationResult> {
  const startedAt = Date.now();
  const captured: Captured = { status: 200, body: undefined, settled: false };

  try {
    const req = buildToolRequest(origin, tool, args);
    const res = buildToolResponse(captured);

    await withTimeout(runChain(tool.chain, req, res, captured), TOOL_TIMEOUT_MS, tool.name);

    const latencyMs = Date.now() - startedAt;

    if (!captured.settled) {
      // The chain ran out without responding. Treat as unavailable rather than
      // inventing an empty success — a tool that silently returns nothing would
      // let the model narrate "you have no findings" from a plumbing bug.
      return {
        ok: false,
        error: "unavailable",
        status: 500,
        message: "The tool route did not produce a response.",
        latencyMs,
      };
    }

    if (captured.status >= 200 && captured.status < 300) {
      return { ok: true, status: captured.status, data: captured.body, latencyMs };
    }

    // 401 / 403 / 404 all collapse to `denied`. The platform's non-disclosure
    // posture returns 404 for a cross-org read; distinguishing it here would leak
    // existence through Ask that the API deliberately refuses to leak.
    if (captured.status === 401 || captured.status === 403 || captured.status === 404) {
      return {
        ok: false,
        error: "denied",
        status: captured.status,
        message: "Not found, or not accessible to this user.",
        latencyMs,
      };
    }

    if (captured.status === 400 || captured.status === 422) {
      return {
        ok: false,
        error: "invalid_arguments",
        status: captured.status,
        message: describeError(captured.body) ?? "The tool arguments were rejected.",
        latencyMs,
      };
    }

    return {
      ok: false,
      error: "unavailable",
      status: captured.status,
      message: "The tool route reported an error.",
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    logger.error(
      { event: "tool_execution_failed", tool: tool.name, err },
      "Platform tool execution failed"
    );
    return {
      ok: false,
      error: "internal",
      status: 500,
      message: "The tool failed to execute.",
      latencyMs,
    };
  }
}

/**
 * Surface a route's own `error` code for argument faults only. Deliberately not
 * used for denials: those must stay indistinguishable.
 */
function describeError(body: unknown): string | null {
  if (body && typeof body === "object" && "error" in body) {
    const e = (body as { error?: unknown }).error;
    if (typeof e === "string") return e;
  }
  return null;
}
