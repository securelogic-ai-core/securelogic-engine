/**
 * types.ts — the SecureLogic platform tool contract.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS A PLATFORM CAPABILITY, NOT AN ASK MODULE.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Ask is the FIRST consumer. The Intelligence Brief and the structured
 * workspaces are intended to read through the same registry, which is why this
 * lives at `src/api/tools/` and not `src/api/lib/askTools.ts`. Today the
 * difference is a directory name; once three surfaces depend on it, retrofitting
 * means touching all three at once.
 *
 * ── Why tools bind to ROUTES, not to the database ───────────────────────────
 *
 * Ask shipped with a parallel data-access layer: eight hand-written queries
 * duplicating what the canonical routes already compute. Git records five
 * separate corrections for drift between the two (88bf1254, df05d81b, 455966e0,
 * a71af3c6, fe70510d) and the September audit still found five more live
 * defects, including a severity filter that matched nothing so the model was
 * shown an empty critical-findings list.
 *
 * The durable fix is not better SQL. It is removing the second data path. A tool
 * binds to an existing route handler TOGETHER WITH ITS FULL MIDDLEWARE CHAIN and
 * executes in the requesting user's security context, so:
 *
 *   - entitlement, seat, capability, contributor row-scoping and RLS all apply
 *     automatically and unchanged;
 *   - metric definitions cannot drift, because there is only one query;
 *   - Ask is INCAPABLE of returning something the product would not, rather than
 *     merely being careful not to.
 *
 * That is the ratified ASK-A invariant expressed structurally: "a user must
 * never obtain information through Ask that they cannot obtain through their
 * authorized product access."
 *
 * ── Action classes ──────────────────────────────────────────────────────────
 *
 * read    executes immediately. GET handlers only.
 * draft   produces a proposal; persists nothing, or persists as an existing
 *         suggestion row. Never commits a change to a canonical object.
 * mutate  requires a server-issued confirmation token bound to the user and a
 *         rendered diff. The token is issued to the CLIENT and never placed in
 *         the model's context, so no amount of prompt injection can cause one.
 * governed
 *         mutate + mandatory rationale + audit evidence + the existing SoD and
 *         approval gates (risk acceptance, vendor decision, finding closure).
 *
 * September 15 ships READ only. draft is P1; mutate and governed are P2 behind
 * Stop Gate ASK-B.
 */

import type { RequestHandler } from "express";

export const TOOL_ACTION_CLASSES = ["read", "draft", "mutate", "governed"] as const;
export type ToolActionClass = (typeof TOOL_ACTION_CLASSES)[number];

/** JSON Schema fragment describing a tool's inputs, passed to the model verbatim. */
export type ToolInputSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

/**
 * How the tool's arguments map onto the bound route.
 *
 * `pathParams` names which arguments fill `:id`-style segments; everything else
 * goes to the query string for GETs or the body for writes.
 *
 * NOTE the deliberate absence of any way to supply organization_id, or to
 * override the caller's identity. Tenant identity comes from the executing
 * request's own authenticated context, never from tool arguments — a tool that
 * accepted an org id would be exactly the privileged bypass ASK-A forbids.
 */
export type ToolBinding = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Express-style path as registered on the router, e.g. "/findings/:id". */
  path: string;
  /** Argument names that fill path segments, in order of appearance. */
  pathParams?: string[];
};

export type ToolDefinition = {
  /** Stable identifier the model calls, e.g. "findings.search". */
  name: string;
  /** Shown to the model. Describes WHAT it returns and WHEN to use it. */
  description: string;
  inputSchema: ToolInputSchema;
  actionClass: ToolActionClass;
  binding: ToolBinding;
  /**
   * The FULL middleware chain, in order, exactly as the route registers it.
   *
   * This is the load-bearing field. It must be the same array reference (or a
   * deep-equal copy) the router uses — a tool that ran only the final handler
   * would skip requireApiKey / requireEntitlement / denyContributor and become a
   * privileged path. `toolChainParity.test.ts` asserts parity against the
   * registered routes.
   */
  chain: RequestHandler[];
};

/** What the executor returns. Never throws for an application-level failure. */
export type ToolInvocationResult =
  | {
      ok: true;
      status: number;
      /** The route's JSON body, unmodified. */
      data: unknown;
      latencyMs: number;
    }
  | {
      ok: false;
      /**
       * `denied` covers every authorization outcome — 401/403/404 alike.
       * Collapsing them is deliberate: a 404 from a canonical handler is the
       * platform's non-disclosure posture (cross-org reads return 404, not 403),
       * and the model must not be able to distinguish "does not exist" from
       * "exists but is not yours". Preserving that distinction in the tool layer
       * would leak existence through the assistant that the API refuses to leak.
       */
      error: "denied" | "invalid_arguments" | "unavailable" | "internal";
      status: number;
      message: string;
      latencyMs: number;
    };
