/**
 * orchestrationExecutors.test.ts — ERIP E6a: the real external executors with a
 * fake HttpClient (never the network) + the widened payload validation. Config
 * is injected via deps.config so this stays a pure unit test (DB-free).
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn().mockResolvedValue({ rows: [{ id: "act-1" }], rowCount: 1 }) }
}));
vi.mock("../infra/email.js", () => ({ sendEmail: vi.fn().mockResolvedValue({ ok: true, id: "email-1" }) }));

import { dispatchExecutor, PROPOSAL_INTEGRATION } from "../lib/orchestrationExecutors.js";
import { validateProposalPayload, PROPOSAL_TYPES } from "../lib/orchestrationPolicy.js";
import type { HttpClient } from "../lib/connectors/types.js";

function captureHttp(): { http: HttpClient; calls: Array<{ url: string; body: unknown }> } {
  const calls: Array<{ url: string; body: unknown }> = [];
  const http: HttpClient = {
    async getJson() { throw new Error("unexpected getJson"); },
    async postJson(url, _headers, body) {
      calls.push({ url, body });
      // Emulate ServiceNow / Jira response shapes.
      if (url.includes("/api/now/table/incident")) return { result: { sys_id: "sn-1", number: "INC001" } };
      if (url.includes("/rest/api/3/issue")) return { id: "10001", key: "SEC-1" };
      return {};
    }
  };
  return { http, calls };
}

describe("dispatchExecutor — external channels", () => {
  it("ServiceNow creates an incident via the injected client + config", async () => {
    const { http, calls } = captureHttp();
    const r = await dispatchExecutor("org", "servicenow_incident", { title: "Breach", description: "d", urgency: "1" }, {
      http,
      config: { instance_url: "https://corp.service-now.com", username: "u", password: "p" }
    });
    expect(r).toMatchObject({ ok: true, result: { sys_id: "sn-1", number: "INC001" } });
    expect(calls[0]!.url).toContain("/api/now/table/incident");
    expect(calls[0]!.body).toMatchObject({ short_description: "Breach", urgency: "1" });
  });

  it("Jira creates an issue via the injected client + config", async () => {
    const { http, calls } = captureHttp();
    const r = await dispatchExecutor("org", "jira_issue", { title: "Fix", issue_type: "Bug" }, {
      http,
      config: { base_url: "https://corp.atlassian.net", email: "e@x.com", api_token: "t", project_key: "SEC" }
    });
    expect(r).toMatchObject({ ok: true, result: { key: "SEC-1" } });
    expect(calls[0]!.body).toMatchObject({ fields: { project: { key: "SEC" }, summary: "Fix", issuetype: { name: "Bug" } } });
  });

  it("Teams / Slack post a webhook message", async () => {
    const { http, calls } = captureHttp();
    const teams = await dispatchExecutor("org", "teams_message", { title: "Alert", description: "body" }, {
      http,
      config: { webhook_url: "https://outlook.office.com/webhook/x" }
    });
    expect(teams).toMatchObject({ ok: true, result: { delivered: true } });
    expect(calls[0]!.body).toMatchObject({ text: "Alert\nbody" });

    const slack = await dispatchExecutor("org", "slack_message", { title: "Alert" }, {
      http,
      config: { webhook_url: "https://hooks.slack.com/services/x" }
    });
    expect(slack).toMatchObject({ ok: true });
  });

  it("Email uses the shared sender", async () => {
    const r = await dispatchExecutor("org", "send_email", { title: "Subject", to: "user@corp.com", description: "hi" }, { config: {} });
    expect(r).toMatchObject({ ok: true, result: { email_id: "email-1" } });
  });

  it("missing config for an external channel is a typed error, not a throw", async () => {
    const r = await dispatchExecutor("org", "servicenow_incident", { title: "x" }, { http: captureHttp().http, config: {} });
    expect(r).toMatchObject({ ok: false, error: "servicenow_not_configured" });
  });

  it("a webhook failure degrades to a typed error", async () => {
    const http: HttpClient = { async getJson() { throw new Error("x"); }, async postJson() { throw new Error("502"); } };
    const r = await dispatchExecutor("org", "slack_message", { title: "x" }, { http, config: { webhook_url: "https://hooks.slack.com/x" } });
    expect(r).toMatchObject({ ok: false });
  });

  it("internal executors (create_action, evidence_request) need no integration", async () => {
    expect(PROPOSAL_INTEGRATION.create_action).toBeUndefined();
    expect(PROPOSAL_INTEGRATION.evidence_request).toBeUndefined();
    const a = await dispatchExecutor("org", "create_action", { title: "t", priority: "immediate" }, {});
    expect(a).toMatchObject({ ok: true, result: { action_id: "act-1" } });
    const e = await dispatchExecutor("org", "evidence_request", { title: "SOC 2 report" }, {});
    expect(e).toMatchObject({ ok: true, result: { action_id: "act-1" } });
  });
});

describe("validateProposalPayload — widened types", () => {
  it("every proposal type has an integration mapping", () => {
    for (const t of PROPOSAL_TYPES) expect(t in PROPOSAL_INTEGRATION).toBe(true);
  });
  it("send_email requires an address", () => {
    expect(validateProposalPayload("send_email", { title: "x" })).toMatchObject({ error: "payload_invalid" });
    expect(validateProposalPayload("send_email", { title: "x", to: "u@x.com" })).toMatchObject({ payload: { to: "u@x.com" } });
  });
  it("slack/teams just need a title", () => {
    expect(validateProposalPayload("slack_message", { title: "Alert" })).toMatchObject({ payload: { title: "Alert" } });
    expect(validateProposalPayload("teams_message", {})).toMatchObject({ error: "payload_invalid" });
  });
  it("evidence_request defaults priority when omitted", () => {
    const r = validateProposalPayload("evidence_request", { title: "Need SOC 2" });
    expect("payload" in r && r.payload.priority).toBe("near_term");
  });
});
