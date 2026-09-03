/**
 * questionContent.test.ts — the hash is the identity an issued questionnaire
 * is addressed by (ADR-0013 R3), so its determinism is a contract, not a
 * convenience. These pin the canonical form byte-for-byte.
 */
import { describe, it, expect } from "vitest";
import {
  validateQuestionContent,
  canonicalQuestionContent,
  questionContentHash,
  bridgeContentForRequirement,
  bridgeQuestionKey,
  RESPONSE_STATUSES,
  type QuestionContent,
} from "../lib/questionnaire/questionContent.js";

const base: QuestionContent = {
  prompt: "Do you encrypt customer data at rest?",
  guidance: "AES-256 or equivalent.",
  answer_type: "attest",
  options: null,
  evidence_policy: "optional",
};

describe("questionContentHash — determinism", () => {
  it("is 64 lowercase hex chars and stable across calls", () => {
    const a = questionContentHash(base);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(questionContentHash({ ...base })).toBe(a);
  });

  it("ignores key order and trailing whitespace; treats absent, null and empty guidance alike", () => {
    const h = questionContentHash(base);
    expect(questionContentHash({ ...base, prompt: "  " + base.prompt + "\n" })).toBe(h);
    const noGuidance = questionContentHash({ ...base, guidance: null });
    expect(questionContentHash({ ...base, guidance: "" })).toBe(noGuidance);
    expect(questionContentHash({ ...base, guidance: "   " })).toBe(noGuidance);
    expect(noGuidance).not.toBe(h);
  });

  it("changes when any content field changes", () => {
    const h = questionContentHash(base);
    expect(questionContentHash({ ...base, prompt: base.prompt + "?" })).not.toBe(h);
    expect(questionContentHash({ ...base, evidence_policy: "required_always" })).not.toBe(h);
    expect(questionContentHash({ ...base, answer_type: "text" })).not.toBe(h);
  });

  it("option ORDER is content (the vendor sees it), so reordering changes the hash", () => {
    const opts = [
      { value: "yes", label: "Yes", maps_to_status: "pass" as const },
      { value: "no", label: "No", maps_to_status: "fail" as const },
    ];
    const a = questionContentHash({ ...base, answer_type: "select_one", options: opts });
    const b = questionContentHash({ ...base, answer_type: "select_one", options: [opts[1]!, opts[0]!] });
    expect(a).not.toBe(b);
  });

  it("canonical form has a fixed key order regardless of input object shape", () => {
    const c = canonicalQuestionContent(base);
    expect(c.indexOf('"prompt"')).toBeLessThan(c.indexOf('"guidance"'));
    expect(c.indexOf('"guidance"')).toBeLessThan(c.indexOf('"answer_type"'));
    expect(c.indexOf('"answer_type"')).toBeLessThan(c.indexOf('"options"'));
    expect(c.indexOf('"options"')).toBeLessThan(c.indexOf('"evidence_policy"'));
  });
});

describe("validateQuestionContent — every failure names its field", () => {
  it("accepts a minimal attest question and defaults evidence_policy to optional", () => {
    const r = validateQuestionContent({ prompt: "Do you have an IR plan?", answer_type: "attest" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.content.evidence_policy).toBe("optional");
  });

  it("rejects missing prompt, bad answer_type and bad evidence_policy, naming each", () => {
    const r = validateQuestionContent({ answer_type: "essay", evidence_policy: "always" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const fields = r.fields.map((f) => f.field);
      expect(fields).toContain("prompt");
      expect(fields).toContain("answer_type");
      expect(fields).toContain("evidence_policy");
    }
  });

  it("select answers need ≥2 options with unique machine values and a shipped status", () => {
    const r = validateQuestionContent({
      prompt: "MFA?",
      answer_type: "select_one",
      options: [
        { value: "yes", label: "Yes", maps_to_status: "pass" },
        { value: "yes", label: "Also yes", maps_to_status: "maybe" },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const fields = r.fields.map((f) => f.field);
      expect(fields).toContain("options[1].value");
      expect(fields).toContain("options[1].maps_to_status");
    }
  });

  it("refuses options on a non-select answer type (they would be dead content)", () => {
    const r = validateQuestionContent({ prompt: "x", answer_type: "attest", options: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fields[0]!.field).toBe("options");
  });

  it("caps prompt and guidance length", () => {
    const r = validateQuestionContent({ prompt: "p".repeat(2001), guidance: "g".repeat(8001), answer_type: "text" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fields.map((f) => f.field)).toEqual(expect.arrayContaining(["prompt", "guidance"]));
  });

  it("maps_to_status vocabulary is exactly the shipped requirement_responses CHECK", () => {
    expect([...RESPONSE_STATUSES].sort()).toEqual(
      ["fail", "not_applicable", "not_assessed", "partial", "pass"].sort()
    );
  });
});

describe("bridge — a requirement rendered as the question it is today", () => {
  it("produces attest/optional with title as prompt and description as guidance", () => {
    const c = bridgeContentForRequirement({ title: "  Access is reviewed quarterly ", description: null });
    expect(c).toEqual({
      prompt: "Access is reviewed quarterly",
      guidance: null,
      answer_type: "attest",
      options: null,
      evidence_policy: "optional",
    });
  });

  it("hashes identically for the same requirement text every time (the P3 equivalence contract)", () => {
    const a = questionContentHash(bridgeContentForRequirement({ title: "T", description: "D" }));
    const b = questionContentHash(bridgeContentForRequirement({ title: "T ", description: "D\n" }));
    expect(a).toBe(b);
  });

  it("bridge keys are namespaced, deterministic and inside the key grammar", () => {
    const k = bridgeQuestionKey("11111111-1111-1111-1111-111111111111", "PR.AA-05 (b)");
    expect(k).toMatch(/^req:11111111-1111-1111-1111-111111111111:pr\.aa-05-b$/);
    expect(k).toMatch(/^[a-z0-9][a-z0-9._:-]{1,199}$/);
    expect(bridgeQuestionKey("f", "CC6.1")).toBe(bridgeQuestionKey("f", "cc6.1"));
  });
});
