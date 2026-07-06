/**
 * orchestrationPolicy.test.ts — ERIP Epic 6: the pure approval + state-machine
 * policy (ERIP-AD-24/25/26) + migration lockstep.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  canTransition,
  approvalAllowed,
  isProposalType,
  validateProposalPayload
} from "../lib/orchestrationPolicy.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.resolve(HERE, "../../../db/migrations/20260815_orchestration_proposals.sql");

describe("canTransition — forward-only (ERIP-AD-26)", () => {
  it("allows the legal forward edges", () => {
    expect(canTransition("proposed", "approved")).toBe(true);
    expect(canTransition("proposed", "rejected")).toBe(true);
    expect(canTransition("approved", "executed")).toBe(true);
    expect(canTransition("approved", "failed")).toBe(true);
  });
  it("forbids backward / terminal transitions", () => {
    expect(canTransition("approved", "proposed")).toBe(false);
    expect(canTransition("executed", "approved")).toBe(false);
    expect(canTransition("rejected", "approved")).toBe(false);
    expect(canTransition("proposed", "executed")).toBe(false); // must pass through approved
  });
});

describe("approvalAllowed — separation of duties (ERIP-AD-25)", () => {
  it("requires an approver", () => {
    expect(approvalAllowed("u1", null)).toEqual({ ok: false, error: "approver_required" });
  });
  it("refuses self-approval", () => {
    expect(approvalAllowed("u1", "u1")).toEqual({ ok: false, error: "separation_of_duties" });
  });
  it("allows a different approver", () => {
    expect(approvalAllowed("u1", "u2")).toEqual({ ok: true });
  });
});

describe("validateProposalPayload — create_action", () => {
  it("accepts a valid payload", () => {
    const r = validateProposalPayload("create_action", { title: "Patch CVE", priority: "immediate", description: "x" });
    expect("payload" in r && r.payload).toMatchObject({ title: "Patch CVE", priority: "immediate", description: "x" });
  });
  it("requires a title and a canonical priority", () => {
    expect(validateProposalPayload("create_action", { priority: "immediate" })).toMatchObject({ error: "payload_invalid" });
    expect(validateProposalPayload("create_action", { title: "x", priority: "someday" })).toMatchObject({ error: "payload_invalid" });
  });
  it("rejects non-object payloads", () => {
    expect(validateProposalPayload("create_action", null)).toMatchObject({ error: "payload_must_be_object" });
  });
});

describe("isProposalType", () => {
  it("admits only known types", () => {
    expect(isProposalType("create_action")).toBe(true);
    expect(isProposalType("delete_everything")).toBe(false);
  });
});

describe("migration lockstep (20260815)", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  it("creates the ledger with RLS + grant + forward-only status CHECK", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS orchestration_proposals");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON orchestration_proposals TO app_request");
    for (const s of ["proposed", "approved", "rejected", "executed", "failed"]) expect(sql).toContain(`'${s}'`);
    expect(sql).toContain("proposal_type IN ('create_action')");
  });
});
