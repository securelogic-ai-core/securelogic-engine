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
  /** Required for non-read tools — see ToolDefinition.summarize. */
  summarize?: (input: Record<string, unknown>) => string;
  /** See ToolDefinition — LC-5b governed-tool contract fields. */
  fixedInput?: Record<string, unknown>;
  applyDefaults?: (
    input: Record<string, unknown>,
    ctx: { userId: string | null }
  ) => Record<string, unknown>;
  validateInput?: (input: Record<string, unknown>) => string | null;
  auditContext?: (
    input: Record<string, unknown>,
    resultData: unknown
  ) => Record<string, unknown>;
  proposalTtlMs?: number;
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
  // ── mutate (Stop Gate ASK-B, Launch Completion 5) ─────────────────────────
  //
  // A mutate tool call EXECUTES NOTHING. The orchestrator records a proposal;
  // the user confirms (or declines) it on a server-rendered card, and only the
  // confirm route — presenting a server-issued token the model never sees —
  // runs this binding's chain. Descriptions must say so, so the model narrates
  // "I've prepared this for your confirmation", never "done".
  //
  // v1 is deliberately bounded to the actions domain, create/update only, no
  // DELETE verbs, and excludes fields with side-channel reach (owner_user_id
  // assignment) or dependent-field semantics (the `blocked` status pair).
  {
    name: "actions.create",
    description:
      "PROPOSE creating a remediation action. Nothing is created until the user " +
      "explicitly confirms the proposal in the product UI — describe it as prepared " +
      "and awaiting their confirmation, never as done. Use when the user asks to " +
      "create, track, or schedule remediation work. source_type describes what " +
      "prompted the action; pass source_id only when you have the UUID of that " +
      "finding/risk/signal from a previous tool result.",
    actionClass: "mutate",
    method: "POST",
    path: "/actions",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short imperative title." },
        description: { type: "string", description: "What needs to be done and why." },
        source_type: {
          type: "string",
          enum: ["assessment", "finding", "signal", "manual", "risk"],
          description: "What prompted this action. Use 'manual' when the user simply asked.",
        },
        source_id: {
          type: "string",
          description: "UUID of the prompting object, from a prior tool result.",
        },
        priority: { type: "string", enum: ["immediate", "near_term", "planned", "watch"] },
        due_date: { type: "string", description: "YYYY-MM-DD." },
      },
      required: ["title", "source_type", "priority"],
      additionalProperties: false,
    },
    summarize: (input) => {
      const parts = [
        `Create remediation action: "${String(input.title ?? "")}"`,
        `priority ${String(input.priority ?? "")}`,
        `source ${String(input.source_type ?? "")}`,
      ];
      if (typeof input.due_date === "string") parts.push(`due ${input.due_date}`);
      if (typeof input.description === "string" && input.description.trim())
        parts.push(`— ${input.description.trim()}`);
      return parts.join(", ");
    },
  },
  {
    name: "actions.update",
    description:
      "PROPOSE updating an existing remediation action (status, priority, or due " +
      "date). Nothing changes until the user explicitly confirms in the product UI — " +
      "describe the update as prepared and awaiting their confirmation, never as " +
      "done. Use the action's UUID from a previous actions.search result. Closing " +
      "an action sets status 'closed'; a completion_note becomes part of the audit " +
      "record of the closure.",
    actionClass: "mutate",
    method: "PATCH",
    path: "/actions/:id",
    pathParams: ["id"],
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Action UUID." },
        status: {
          type: "string",
          enum: ["open", "in_progress", "closed", "accepted"],
          description: "New lifecycle status. ('blocked' requires details Ask does not manage.)",
        },
        priority: { type: "string", enum: ["immediate", "near_term", "planned", "watch"] },
        due_date: { type: "string", description: "YYYY-MM-DD." },
        completion_note: {
          type: "string",
          description: "Optional note recorded on the audit event when closing.",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    summarize: (input) => {
      const changes: string[] = [];
      if (typeof input.status === "string") changes.push(`status → ${input.status}`);
      if (typeof input.priority === "string") changes.push(`priority → ${input.priority}`);
      if (typeof input.due_date === "string") changes.push(`due date → ${input.due_date}`);
      if (typeof input.completion_note === "string" && input.completion_note.trim())
        changes.push(`completion note: "${input.completion_note.trim()}"`);
      return `Update action ${String(input.id ?? "")}: ${changes.length ? changes.join("; ") : "no changes specified"}`;
    },
  },
  // ── governed (Stop Gate ASK-B extension, LC-5b) ───────────────────────────
  //
  // Same propose-confirm mechanism as mutate, with the governed additions:
  // spec-pinned transition literals (fixedInput — the model cannot repoint the
  // tool at another transition), server-VALIDATED mandatory rationale
  // (validateInput), server-sourced object identity in the confirmation
  // summary (enriched in runAskToolTurn, org-scoped), and an auditContext
  // that lands proposal + confirmer + transition + rationale + resulting
  // state on one audit event. Execution re-runs the target route's own
  // workflow gates — state machine, SoD, remediation/measurement
  // preconditions — under the CONFIRMING user.
  {
    name: "findings.close",
    description:
      "PROPOSE closing a finding (governance decision_state → resolved). Nothing " +
      "changes until the user explicitly confirms in the product UI — describe the " +
      "closure as prepared and awaiting their confirmation, never as done. Requires " +
      "decision_note: the closure rationale, which becomes part of the audit " +
      "record — state WHY the finding is resolved. The platform's closure rules " +
      "(remediation completeness, separation of duties) are enforced when the user " +
      "confirms; a closure they forbid will be refused then. Use the finding's UUID " +
      "from a previous findings.search or findings.get result.",
    actionClass: "governed",
    method: "PATCH",
    path: "/findings/:id",
    pathParams: ["id"],
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Finding UUID." },
        decision_note: {
          type: "string",
          description:
            "Closure rationale (at least 10 characters). Becomes the lifecycle " +
            "event's comment and part of the audit record.",
        },
      },
      required: ["id", "decision_note"],
      additionalProperties: false,
    },
    // The transition literal is the SPEC's, not the model's: this tool can
    // only ever request decision_state=resolved. accepted_risk is explicitly
    // unreachable here — that is the risk-acceptance workflow's output.
    fixedInput: { decision_state: "resolved" },
    validateInput: (input) => {
      const note = typeof input.decision_note === "string" ? input.decision_note.trim() : "";
      if (note.length < 10) return "decision_note must be a substantive rationale (≥ 10 characters).";
      if (note.length > 2000) return "decision_note must be at most 2000 characters.";
      return null;
    },
    summarize: (input) => {
      const note = typeof input.decision_note === "string" ? input.decision_note.trim() : "";
      return `Close finding ${String(input.id ?? "")} (decision_state → resolved) — rationale: "${note}"`;
    },
    auditContext: (input, resultData) => {
      const finding =
        resultData && typeof resultData === "object"
          ? ((resultData as Record<string, unknown>).finding as Record<string, unknown> | undefined)
          : undefined;
      return {
        transition: "decision_state → resolved",
        rationale: typeof input.decision_note === "string" ? input.decision_note.trim() : null,
        resulting_state: finding
          ? {
              decision_state: finding.decision_state ?? null,
              operational_status: finding.operational_status ?? null,
              status: finding.status ?? null,
            }
          : null,
      };
    },
  },
  {
    name: "vendors.decide",
    description:
      "PROPOSE recording the governance decision on a vendor engagement " +
      "(approved / approved_with_conditions / rejected / terminated). Nothing is " +
      "recorded until the user explicitly confirms in the product UI — describe " +
      "the decision as prepared and awaiting their confirmation, never as done. " +
      "Requires rationale: the decision reasoning, which becomes part of the " +
      "audit record. The engagement must have a computed residual risk and be in " +
      "a decidable state — the platform enforces both when the user confirms. " +
      "The decision is attributed to the confirming user, and it never changes " +
      "the measured residual risk. Use the engagement's UUID from a previous " +
      "tool result.",
    actionClass: "governed",
    method: "POST",
    path: "/vendor-engagements/:id/decision",
    pathParams: ["id"],
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Vendor engagement UUID." },
        decision: {
          type: "string",
          enum: ["approved", "approved_with_conditions", "rejected", "terminated"],
        },
        rationale: {
          type: "string",
          description:
            "Decision reasoning (at least 10 characters). Recorded verbatim on " +
            "the engagement and in the audit record.",
        },
        expires_at: {
          type: "string",
          description: "Optional decision expiry, YYYY-MM-DD (e.g. an approval review date).",
        },
      },
      required: ["id", "decision", "rationale"],
      additionalProperties: false,
    },
    validateInput: (input) => {
      const rationale = typeof input.rationale === "string" ? input.rationale.trim() : "";
      if (rationale.length < 10) return "rationale must be a substantive reasoning (≥ 10 characters).";
      if (rationale.length > 2000) return "rationale must be at most 2000 characters.";
      if (
        input.expires_at !== undefined &&
        !(typeof input.expires_at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.expires_at))
      ) {
        return "expires_at must be YYYY-MM-DD.";
      }
      return null;
    },
    summarize: (input) => {
      const rationale = typeof input.rationale === "string" ? input.rationale.trim() : "";
      const expiry =
        typeof input.expires_at === "string" ? `, decision expires ${input.expires_at}` : "";
      return (
        `Record engagement decision "${String(input.decision ?? "")}" for engagement ` +
        `${String(input.id ?? "")}${expiry} — rationale: "${rationale}"`
      );
    },
    auditContext: (input, resultData) => {
      const data =
        resultData && typeof resultData === "object"
          ? (resultData as Record<string, unknown>)
          : {};
      return {
        transition: `status → decided (${String(input.decision ?? "")})`,
        rationale: typeof input.rationale === "string" ? input.rationale.trim() : null,
        resulting_state: {
          status: data.status ?? null,
          decision: data.decision ?? null,
          // Echoed from the route so the ledger shows the decision changed
          // NOTHING about the measurement.
          residual_score: data.residual_score ?? null,
          residual_rating: data.residual_rating ?? null,
        },
      };
    },
  },
  {
    name: "risks.accept",
    description:
      "PROPOSE formally accepting the risk of a finding, via the platform's " +
      "signed risk-acceptance workflow. This creates an acceptance PROPOSAL: " +
      "the finding stays fully active, and a DIFFERENT authorized user must " +
      "approve the acceptance in the product before anything closes — you " +
      "cannot approve it, the confirming user cannot approve their own " +
      "proposal, and acceptance never changes the finding's measured severity. " +
      "Requires rationale (why the risk is acceptable) and expires_at (the " +
      "review date — an acceptance without expiry is a permanent pardon and is " +
      "refused). The accountable owner is ALWAYS the asking user — assigning a " +
      "different owner is done in the product, not through you. Use the " +
      "finding's UUID from findings.search or findings.get.",
    actionClass: "governed",
    method: "POST",
    path: "/findings/:id/risk-acceptance",
    pathParams: ["id"],
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Finding UUID." },
        rationale: {
          type: "string",
          description:
            "Why this risk is acceptable (at least 10 characters). Recorded on " +
            "the durable acceptance record and in the audit trail.",
        },
        expires_at: {
          type: "string",
          description: "Acceptance review/expiry date, YYYY-MM-DD. Required — accepted risk comes back for review.",
        },
      },
      required: ["id", "rationale", "expires_at"],
      additionalProperties: false,
    },
    // The accountable owner is UNCONDITIONALLY the proposing user (== the
    // confirming user) — the schema exposes no identity argument (the ASK-A
    // guard forbids them), and anything the model smuggles in is overwritten
    // here, frozen at proposal time, and shown by name on the card.
    applyDefaults: (_input, ctx) => (ctx.userId ? { owner_user_id: ctx.userId } : {}),
    validateInput: (input) => {
      const rationale = typeof input.rationale === "string" ? input.rationale.trim() : "";
      if (rationale.length < 10) return "rationale must be a substantive reasoning (≥ 10 characters).";
      if (rationale.length > 2000) return "rationale must be at most 2000 characters.";
      if (!(typeof input.expires_at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.expires_at))) {
        return "expires_at must be YYYY-MM-DD.";
      }
      return null;
    },
    summarize: (input) => {
      const rationale = typeof input.rationale === "string" ? input.rationale.trim() : "";
      return (
        `Propose RISK ACCEPTANCE for finding ${String(input.id ?? "")} — expires ` +
        `${String(input.expires_at ?? "")}, requires approval by another authorized user — ` +
        `rationale: "${rationale}"`
      );
    },
    auditContext: (input, resultData) => {
      const acceptance =
        resultData && typeof resultData === "object"
          ? ((resultData as Record<string, unknown>).acceptance as
              | Record<string, unknown>
              | undefined)
          : undefined;
      return {
        transition: "finding_risk_acceptance → proposed (approval by another user required)",
        rationale: typeof input.rationale === "string" ? input.rationale.trim() : null,
        resulting_state: acceptance
          ? {
              acceptance_id: acceptance.id ?? null,
              state: acceptance.state ?? null,
              owner_user_id: acceptance.owner_user_id ?? null,
              expires_at: acceptance.expires_at ?? null,
            }
          : null,
      };
    },
    // Operator ruling: acceptance proposals confirm in a 5-minute window.
    proposalTtlMs: 5 * 60 * 1000,
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
    ...(spec.summarize ? { summarize: spec.summarize } : {}),
    ...(spec.fixedInput ? { fixedInput: spec.fixedInput } : {}),
    ...(spec.applyDefaults ? { applyDefaults: spec.applyDefaults } : {}),
    ...(spec.validateInput ? { validateInput: spec.validateInput } : {}),
    ...(spec.auditContext ? { auditContext: spec.auditContext } : {}),
    ...(spec.proposalTtlMs !== undefined ? { proposalTtlMs: spec.proposalTtlMs } : {}),
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

// ─── Wire names (Anthropic tool-name boundary) ────────────────────────────────
//
// The Anthropic API constrains tool names to `^[a-zA-Z0-9_-]{1,128}$`. Our
// canonical names are dotted (`findings.search`) because the dot carries real
// meaning — it is the resource.verb pairing that the audit ledger, citation
// targets, proposal rows, and the governed-action vocabulary all key on.
//
// So the dot is translated at the API boundary ONLY: schemas go out with `__`
// where the canonical name has `.`, and an inbound `tool_use.name` is mapped
// back before anything else in the platform sees it. Nothing downstream of
// `resolveWireToolName` ever observes a wire name — ask_tool_invocations,
// citations, and proposals keep storing `findings.search`.
//
// Sending a dotted name was a live P0: EVERY tool-path Ask request 400'd at the
// provider, and because the rejection escaped the orchestrator's catch it took
// the process into drain mode. `assertWireNamesValid` makes that class of defect
// a boot failure instead of a runtime one.

// Anthropic's documented constraint on a tool `name`. The 64-char ceiling is
// the real one — an earlier draft of this guard used 128, which would have let a
// too-long name pass boot and 400 at the provider, exactly the failure this is
// here to prevent. Longest name in the registry today is 19 chars.
const WIRE_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/** Canonical (`findings.search`) → wire (`findings__search`). */
export function toWireToolName(name: string): string {
  return name.replace(/\./g, "__");
}

/**
 * Wire → canonical, by lookup against the registry rather than by string
 * surgery, so a name that round-trips ambiguously can never silently resolve to
 * the wrong tool. Returns null for anything not in the registry — the caller
 * already handles "the model invented a tool".
 */
export function resolveWireToolName(wireName: string, tools: ToolDefinition[]): string | null {
  for (const t of tools) {
    if (t.name === wireName || toWireToolName(t.name) === wireName) return t.name;
  }
  return null;
}

/**
 * Fail at boot if any tool cannot be represented on the wire, or if two
 * canonical names collapse to the same wire name (which would make the inbound
 * mapping ambiguous).
 */
function assertWireNamesValid(tools: ToolDefinition[]): void {
  const seen = new Map<string, string>();
  for (const t of tools) {
    const wire = toWireToolName(t.name);
    if (!WIRE_NAME_PATTERN.test(wire)) {
      throw new Error(
        `Tool "${t.name}" produces wire name "${wire}", which violates the provider ` +
          `tool-name pattern ${WIRE_NAME_PATTERN}. Rename the tool.`,
      );
    }
    const prior = seen.get(wire);
    if (prior) {
      throw new Error(
        `Tools "${prior}" and "${t.name}" both map to wire name "${wire}". ` +
          `Wire names must be unique.`,
      );
    }
    seen.set(wire, t.name);
  }
}

/** The model-facing declaration. Never exposes the chain. */
export function toolSchemasFor(tools: ToolDefinition[]): Array<{
  name: string;
  description: string;
  input_schema: ToolInputSchema;
}> {
  assertWireNamesValid(tools);
  return tools.map((t) => ({
    name: toWireToolName(t.name),
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
