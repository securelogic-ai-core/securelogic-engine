/**
 * registry.ts — the platform tool registry.
 *
 * A tool declares WHAT it is (name, description, schema, action class) and WHICH
 * ROUTE it binds to. It does NOT declare a middleware chain: the chain is
 * resolved from the live router at construction, so there is exactly one
 * definition of "what runs for GET /findings" and it lives in the route file.
 * See routeResolver.ts for why that matters.
 *
 * The registry is built once, lazily, from the same `buildRoutes()` the server
 * mounts. Binding to a route that does not exist throws at construction — at
 * boot, not when a customer asks a question.
 */

import type { Router } from "express";

import { buildRoutes } from "../routes/index.js";
import { flattenRoutes, resolveRouteChain, type ResolvedRoute } from "./routeResolver.js";
import type { ToolActionClass, ToolDefinition, ToolInputSchema } from "./types.js";

/** A tool declaration BEFORE its chain is resolved from the router. */
type ToolSpec = {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  actionClass: ToolActionClass;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Path exactly as the route file registers it (no /api prefix). */
  path: string;
  pathParams?: string[];
};

/**
 * September 15 read tools.
 *
 * Every one binds to a shipped route. No tool executes SQL of its own — the
 * `noDirectDbAccess` test enforces that for the whole src/api/tools/ tree, which
 * is what makes "Ask cannot answer differently from the product" structural
 * rather than aspirational.
 *
 * Descriptions are written FOR THE MODEL: they say what the tool returns, when
 * to reach for it, and — where it matters — which vocabulary to use, because a
 * model that guesses 'critical' instead of 'Critical' gets an empty result and
 * then narrates a clean posture. (That was a real shipped defect; see
 * askTruthPass.test.ts.)
 */
const TOOL_SPECS: ToolSpec[] = [
  {
    name: "findings.search",
    description:
      "Search this organization's findings. Returns the same rows, and the same " +
      "ACTIVE-vs-closed population, that the Findings surface shows this user. Use it " +
      "for open work, severity breakdowns, or findings from a particular source. " +
      "Severity values are PascalCase: Critical, High, Moderate, Low.",
    actionClass: "read",
    method: "GET",
    path: "/findings",
    inputSchema: {
      type: "object",
      properties: {
        severity: { type: "string", enum: ["Critical", "High", "Moderate", "Low"] },
        status: { type: "string", description: "Lifecycle status filter." },
        source_type: {
          type: "string",
          description:
            "Provenance filter, e.g. vendor_review, vendor_cycle_review, cyber_signal, intelligence_event.",
        },
        domain: { type: "string", description: "Risk domain, e.g. 'Vendor Risk'." },
        limit: { type: "number", description: "Max rows; the server caps this." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "findings.get",
    description:
      "Fetch one finding by id with its full detail. If the caller may not see it the " +
      "result is 'not found or not accessible' — report that plainly and do not " +
      "speculate about whether the record exists.",
    actionClass: "read",
    method: "GET",
    path: "/findings/:id",
    pathParams: ["id"],
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Finding UUID." } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "findings.summary",
    description:
      "Aggregate finding counts for the organization — active total, breakdown by " +
      "severity, and closed. Prefer this over counting search results: it uses the " +
      "platform's ratified metric definitions, so the numbers match every other surface.",
    actionClass: "read",
    method: "GET",
    path: "/findings/summary",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "vendors.search",
    description:
      "List this organization's vendors with criticality, risk score and assessment " +
      "state. Defaults to ACTIVE vendors — archived ones are excluded, matching the " +
      "vendor register the user sees.",
    actionClass: "read",
    method: "GET",
    path: "/vendors",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["active", "archived"] },
        criticality: { type: "string", enum: ["critical", "high", "medium", "low"] },
        search: { type: "string", description: "Name substring." },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "vendors.get",
    description: "Fetch one vendor by id, with its profile and current risk score.",
    actionClass: "read",
    method: "GET",
    path: "/vendors/:id",
    pathParams: ["id"],
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Vendor UUID." } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "vendors.findings",
    description:
      "Findings attributable to one vendor, across its assessment and review-cycle " +
      "workflows. Use when asked what is wrong with a specific vendor.",
    actionClass: "read",
    method: "GET",
    path: "/vendors/:id/findings",
    pathParams: ["id"],
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Vendor UUID." },
        status: { type: "string" },
        limit: { type: "number" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "risks.search",
    description:
      "Search the risk register. Each risk carries BOTH an inherent rating " +
      "(pre-controls) and a residual rating (post-controls). Default to residual " +
      "unless asked about inherent, and label them explicitly when you quote one.",
    actionClass: "read",
    method: "GET",
    path: "/risks",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string" },
        domain: { type: "string" },
        risk_rating: { type: "string", enum: ["Critical", "High", "Moderate", "Low"] },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "actions.search",
    description:
      "Search remediation actions. Use for questions about outstanding or overdue work. " +
      "Overdue means active AND due before today.",
    actionClass: "read",
    method: "GET",
    path: "/actions",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string" },
        priority: { type: "string", enum: ["immediate", "near_term", "planned", "watch"] },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "posture.current",
    description:
      "The organization's latest posture snapshot: overall score and severity, per-domain " +
      "scores, and open finding/action counts, as of the snapshot date. Always state the " +
      "as-of date — posture is a snapshot, not a live figure.",
    actionClass: "read",
    method: "GET",
    path: "/posture/latest",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "controls.search",
    description:
      "List the organization's controls inventory — the controls it has defined and owns. " +
      "Use for questions about what controls exist or who owns them. Control EFFECTIVENESS " +
      "is assessed separately; this tool returns the inventory, not test results.",
    actionClass: "read",
    method: "GET",
    path: "/controls",
    inputSchema: {
      type: "object",
      properties: { search: { type: "string" }, limit: { type: "number" } },
      additionalProperties: false,
    },
  },
  {
    name: "obligations.search",
    description:
      "List regulatory obligations with jurisdiction, priority and due date. Use for " +
      "questions about regulatory exposure and upcoming compliance deadlines.",
    actionClass: "read",
    method: "GET",
    path: "/obligations",
    inputSchema: {
      type: "object",
      properties: { status: { type: "string" }, priority: { type: "string" }, limit: { type: "number" } },
      additionalProperties: false,
    },
  },
  {
    name: "evidence.search",
    description:
      "Search evidence records by the workflow object they support. Use when asked what " +
      "evidence supports a conclusion.",
    actionClass: "read",
    method: "GET",
    path: "/evidence",
    inputSchema: {
      type: "object",
      properties: {
        source_type: { type: "string", description: "e.g. control_test, vendor_review, risk." },
        source_id: { type: "string", description: "The workflow object's UUID." },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
  },
];

let cached: ToolDefinition[] | null = null;
let cachedByName: Map<string, ToolDefinition> | null = null;

/**
 * Build the registry, resolving every chain from the live router.
 *
 * `routerOverride` exists for tests that want to bind against a purpose-built
 * router; production always uses buildRoutes().
 */
export function buildToolRegistry(routerOverride?: Router): ToolDefinition[] {
  // isDev/publicApiDisabled affect only which DEV-only and public routes are
  // mounted; every route a tool binds to is an authenticated platform route that
  // is registered regardless. Building with the production-shaped options keeps
  // the resolved chains identical to what the server serves.
  const router =
    routerOverride ?? (buildRoutes({ isDev: false, publicApiDisabled: false }) as unknown as Router);
  const routes: ResolvedRoute[] = flattenRoutes(router);

  return TOOL_SPECS.map((spec) => ({
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    actionClass: spec.actionClass,
    binding: {
      method: spec.method,
      path: spec.path,
      ...(spec.pathParams ? { pathParams: spec.pathParams } : {}),
    },
    // Resolved from the router — throws at boot if the route is gone.
    chain: resolveRouteChain(routes, spec.method, spec.path),
  }));
}

/** Lazily-built singleton. */
export function platformTools(): ToolDefinition[] {
  if (!cached) {
    cached = buildToolRegistry();
    cachedByName = new Map(cached.map((t) => [t.name, t]));
  }
  return cached;
}

export function getTool(name: string): ToolDefinition | null {
  platformTools();
  return cachedByName?.get(name) ?? null;
}

/** Tools of the given action classes. September 15 exposes `read` only. */
export function toolsForActionClasses(
  classes: ReadonlyArray<ToolActionClass>
): ToolDefinition[] {
  return platformTools().filter((t) => classes.includes(t.actionClass));
}

/** The model-facing declaration. Never exposes the chain. */
export function toolSchemasFor(tools: ToolDefinition[]): Array<{
  name: string;
  description: string;
  input_schema: ToolInputSchema;
}> {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}

/** Test seam. */
export function __resetToolRegistryForTests(): void {
  cached = null;
  cachedByName = null;
}

export { TOOL_SPECS };
