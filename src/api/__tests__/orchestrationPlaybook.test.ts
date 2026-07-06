/**
 * orchestrationPlaybook.test.ts — ERIP E6b: the pure playbook-step validator +
 * migration lockstep. Pure — no DB.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validatePlaybookSteps } from "../lib/orchestrationPolicy.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.resolve(HERE, "../../../db/migrations/20260819_orchestration_playbooks.sql");

describe("validatePlaybookSteps", () => {
  it("validates a multi-step playbook of mixed executor types", () => {
    const r = validatePlaybookSteps([
      { proposal_type: "slack_message", payload: { title: "Notify SOC" } },
      { proposal_type: "create_action", payload: { title: "Remediate", priority: "immediate" } },
      { proposal_type: "servicenow_incident", payload: { title: "Open incident" } }
    ]);
    expect("steps" in r && r.steps).toHaveLength(3);
    if ("steps" in r) {
      expect(r.steps[0]).toMatchObject({ proposal_type: "slack_message", title: "Notify SOC" });
      expect(r.steps[1]!.payload.priority).toBe("immediate");
    }
  });

  it("rejects a non-array, empty, and over-long steps", () => {
    expect(validatePlaybookSteps({} as unknown)).toMatchObject({ error: "steps_must_be_array" });
    expect(validatePlaybookSteps([])).toMatchObject({ error: "steps_invalid" });
    expect(validatePlaybookSteps(Array.from({ length: 21 }, () => ({ proposal_type: "create_action", payload: { title: "x", priority: "watch" } })))).toMatchObject({ error: "steps_invalid" });
  });

  it("rejects an unknown proposal type or an invalid step payload", () => {
    expect(validatePlaybookSteps([{ proposal_type: "nope", payload: { title: "x" } }])).toMatchObject({ error: "steps_invalid", detail: expect.stringContaining("unknown proposal_type") });
    expect(validatePlaybookSteps([{ proposal_type: "send_email", payload: { title: "x" } }])).toMatchObject({ error: "steps_invalid" }); // missing 'to'
  });
});

describe("migration lockstep (20260819)", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  it("creates the playbooks table with RLS + grant + schedule floor", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS orchestration_playbooks");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON orchestration_playbooks TO app_request");
    expect(sql).toContain("schedule_interval_minutes >= 60");
    expect(sql.replace(/^--.*$/gm, "")).not.toMatch(/DROP\s+TABLE\s+orchestration_playbooks/i);
  });
});
