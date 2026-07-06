/**
 * orchestrationExecutors.ts — ERIP E6a: the REAL outbound executors for
 * approved orchestration proposals. Each executor performs the genuine action
 * against the org's configured integration through the SSRF-safe connector HTTP
 * client (assertSafeWebhookUrl on every request) or the shared email sender.
 * Runs ONLY after a different human approves (ERIP-AD-24/25) — this module is
 * the execute step, never the approve step.
 *
 * Every executor: (orgId, payload, ctx) → { ok: true, result } | { ok:false,
 * error }. `ctx` injects the HttpClient (a fake in tests, the SSRF-safe client
 * in prod) + the decrypted integration config, so tests never hit the network.
 */

import { pg } from "../infra/postgres.js";
import { sendEmail } from "../infra/email.js";
import { buildConnectorHttpClient } from "./connectorHttpClient.js";
import type { HttpClient } from "./connectors/types.js";
import {
  getIntegrationRow,
  decryptIntegrationConfig,
  type IntegrationId
} from "./orchestrationIntegrationStore.js";

export type ExecutorResult =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: string };

export interface ExecutorCtx {
  http: HttpClient;
  /** Decrypted integration config for the proposal's channel (null when none). */
  config: Record<string, string> | null;
}

/** Which integration a proposal type requires (undefined = internal, no config). */
export const PROPOSAL_INTEGRATION: Record<string, IntegrationId | undefined> = {
  create_action: undefined,
  evidence_request: undefined,
  servicenow_incident: "servicenow",
  jira_issue: "jira",
  teams_message: "teams",
  slack_message: "slack",
  send_email: "email",
  escalate: "slack" // escalation notifies via the configured Slack channel
};

// ─── Internal executors (no outbound integration) ─────────────────────────────

async function insertAction(
  orgId: string,
  title: string,
  description: string | null,
  actionType: string,
  priority: string
): Promise<{ action_id: string }> {
  const r = await pg.query<{ id: string }>(
    `INSERT INTO actions (organization_id, title, description, action_type, source_type, priority, status)
     VALUES ($1, $2, $3, $4, 'manual', $5, 'open') RETURNING id`,
    [orgId, title, description, actionType, priority]
  );
  return { action_id: r.rows[0]!.id };
}

async function execCreateAction(orgId: string, p: Record<string, unknown>): Promise<ExecutorResult> {
  return { ok: true, result: await insertAction(orgId, String(p.title), (p.description as string) ?? null, "orchestration:create_action", String(p.priority)) };
}

async function execEvidenceRequest(orgId: string, p: Record<string, unknown>): Promise<ExecutorResult> {
  // An evidence request is an internal action the owner fulfils (title = what's needed).
  return { ok: true, result: await insertAction(orgId, `Evidence: ${String(p.title)}`, (p.description as string) ?? null, "orchestration:evidence_request", String(p.priority ?? "near_term")) };
}

// ─── External executors (via the SSRF-safe client / email) ────────────────────

async function execServiceNow(p: Record<string, unknown>, ctx: ExecutorCtx): Promise<ExecutorResult> {
  const c = ctx.config;
  if (!c?.instance_url || !c.username || !c.password) return { ok: false, error: "servicenow_not_configured" };
  if (!ctx.http.postJson) return { ok: false, error: "http_post_unavailable" };
  const url = `${c.instance_url.replace(/\/+$/, "")}/api/now/table/incident`;
  const auth = Buffer.from(`${c.username}:${c.password}`).toString("base64");
  const body = { short_description: String(p.title), description: (p.description as string) ?? "", urgency: String(p.urgency ?? "3") };
  try {
    const resp = (await ctx.http.postJson(url, { Authorization: `Basic ${auth}`, Accept: "application/json" }, body)) as {
      result?: { sys_id?: unknown; number?: unknown };
    };
    return { ok: true, result: { sys_id: resp?.result?.sys_id ?? null, number: resp?.result?.number ?? null } };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message?.slice(0, 300) ?? "servicenow_failed" };
  }
}

async function execJira(p: Record<string, unknown>, ctx: ExecutorCtx): Promise<ExecutorResult> {
  const c = ctx.config;
  if (!c?.base_url || !c.email || !c.api_token || !c.project_key) return { ok: false, error: "jira_not_configured" };
  if (!ctx.http.postJson) return { ok: false, error: "http_post_unavailable" };
  const url = `${c.base_url.replace(/\/+$/, "")}/rest/api/3/issue`;
  const auth = Buffer.from(`${c.email}:${c.api_token}`).toString("base64");
  const body = {
    fields: {
      project: { key: c.project_key },
      summary: String(p.title),
      description: (p.description as string) ?? "",
      issuetype: { name: String(p.issue_type ?? "Task") }
    }
  };
  try {
    const resp = (await ctx.http.postJson(url, { Authorization: `Basic ${auth}`, Accept: "application/json" }, body)) as {
      id?: unknown;
      key?: unknown;
    };
    return { ok: true, result: { id: resp?.id ?? null, key: resp?.key ?? null } };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message?.slice(0, 300) ?? "jira_failed" };
  }
}

async function execWebhookMessage(channel: "teams" | "slack", p: Record<string, unknown>, ctx: ExecutorCtx): Promise<ExecutorResult> {
  const c = ctx.config;
  if (!c?.webhook_url) return { ok: false, error: `${channel}_not_configured` };
  if (!ctx.http.postJson) return { ok: false, error: "http_post_unavailable" };
  const text = `${String(p.title)}${p.description ? `\n${String(p.description)}` : ""}`;
  // Teams uses { text }; Slack also accepts { text }.
  try {
    await ctx.http.postJson(c.webhook_url, { Accept: "application/json" }, { text });
    return { ok: true, result: { delivered: true } };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message?.slice(0, 300) ?? `${channel}_failed` };
  }
}

async function execSendEmail(p: Record<string, unknown>): Promise<ExecutorResult> {
  const to = String(p.to ?? "");
  const subject = String(p.title ?? "");
  const html = `<p>${String(p.description ?? p.title ?? "")}</p>`;
  const res = await sendEmail({ to, subject, html });
  if (res.ok) return { ok: true, result: { email_id: res.id } };
  return { ok: false, error: `email_${res.reason}${res.detail ? `: ${res.detail}` : ""}` };
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

export interface DispatchDeps {
  http?: HttpClient;
  /** Test override: skip loading config from the DB. */
  config?: Record<string, string> | null;
}

/**
 * Execute a proposal by type. Loads + decrypts the required integration config
 * (unless the executor is internal, or a test supplies `config`), then runs the
 * real executor with the SSRF-safe client. Never throws — returns a typed
 * result the approval flow persists. Tenant-scoped (runs in the approve tx).
 */
export async function dispatchExecutor(
  orgId: string,
  proposalType: string,
  payload: Record<string, unknown>,
  deps: DispatchDeps = {}
): Promise<ExecutorResult> {
  const integration = PROPOSAL_INTEGRATION[proposalType];

  let config: Record<string, string> | null = null;
  if (integration !== undefined) {
    if (deps.config !== undefined) {
      config = deps.config;
    } else {
      const row = await getIntegrationRow(orgId, integration);
      if (!row) return { ok: false, error: `${integration}_not_configured` };
      if (!row.enabled) return { ok: false, error: `${integration}_disabled` };
      config = decryptIntegrationConfig(row);
      if (!config) return { ok: false, error: `${integration}_config_undecryptable` };
    }
  }

  const ctx: ExecutorCtx = { http: deps.http ?? buildConnectorHttpClient(), config };

  switch (proposalType) {
    case "create_action":
      return execCreateAction(orgId, payload);
    case "evidence_request":
      return execEvidenceRequest(orgId, payload);
    case "servicenow_incident":
      return execServiceNow(payload, ctx);
    case "jira_issue":
      return execJira(payload, ctx);
    case "teams_message":
      return execWebhookMessage("teams", payload, ctx);
    case "slack_message":
    case "escalate":
      return execWebhookMessage("slack", payload, ctx);
    case "send_email":
      return execSendEmail(payload);
    default:
      return { ok: false, error: `unknown_proposal_type:${proposalType}` };
  }
}
