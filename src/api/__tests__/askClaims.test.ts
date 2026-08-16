/**
 * askClaims.test.ts — provenance and citation verification.
 *
 * The property under test is that verification is a CHECK, not a request. Ask's
 * previous defence against invention was a prompt paragraph; these tests hold
 * the mechanism that replaces it.
 */
import { describe, it, expect } from "vitest";
import {
  CLAIM_CLASSES,
  parseClaims,
  renderClaims,
  valueAppearsIn,
  verifyClaims,
  type Claim,
  type InvocationForVerification,
} from "../lib/ask/claims.js";

const inv = (over: Partial<InvocationForVerification> = {}): InvocationForVerification => ({
  toolName: "findings.search",
  authorized: true,
  data: { findings: [{ id: "f-1", title: "Unpatched RCE", severity: "Critical" }], total: 1 },
  ...over,
});

const claim = (over: Partial<Claim> = {}): Claim => ({
  text: "You have 1 Critical finding.",
  claim_class: "observed",
  citations: [{ invocation_index: 0, tool_name: "findings.search", field: "total", value: 1 }],
  ...over,
});

// ─── Value containment ──────────────────────────────────────────────────────

describe("citation verification — value containment", () => {
  it("finds a value nested anywhere in the tool output", () => {
    expect(valueAppearsIn({ a: { b: [{ c: "Critical" }] } }, "Critical")).toBe(true);
    expect(valueAppearsIn({ total: 1 }, 1)).toBe(true);
  });

  it("does NOT find a value that is absent", () => {
    // The failure that matters: a number the model produced from nowhere.
    expect(valueAppearsIn({ total: 1 }, 47)).toBe(false);
    expect(valueAppearsIn({ findings: [] }, "Acme Corp")).toBe(false);
  });

  it("compares loosely across string/number, because JSON round-trips do", () => {
    expect(valueAppearsIn({ total: 1 }, "1")).toBe(true);
    expect(valueAppearsIn({ total: "1" }, 1)).toBe(true);
  });

  it("treats an absent assertion as nothing to verify", () => {
    expect(valueAppearsIn({}, undefined)).toBe(true);
    expect(valueAppearsIn({}, null)).toBe(true);
  });
});

// ─── Observed claims ────────────────────────────────────────────────────────

describe("verification — observed claims must be grounded", () => {
  it("passes a claim whose value appears in its cited output", () => {
    const r = verifyClaims([claim()], [inv()]);
    expect(r.clean).toBe(true);
    expect(r.claims[0]!.claim_class).toBe("observed");
  });

  it("DOWNGRADES an observed claim with no citation", () => {
    const r = verifyClaims([claim({ citations: [] })], [inv()]);
    expect(r.clean).toBe(false);
    expect(r.claims[0]!.claim_class).toBe("inference");
    expect(r.issues[0]!.reason).toBe("observed_without_citation");
  });

  it("DOWNGRADES a claim asserting a value that is not in the data", () => {
    // The invention case. Previously this shipped as fact.
    const fabricated = claim({
      text: "You have 47 Critical findings.",
      citations: [{ invocation_index: 0, tool_name: "findings.search", field: "total", value: 47 }],
    });
    const r = verifyClaims([fabricated], [inv()]);
    expect(r.claims[0]!.claim_class).toBe("inference");
    expect(r.issues[0]!.reason).toBe("value_not_in_tool_output");
    expect(r.issues[0]!.detail).toMatch(/47/);
  });

  it("DOWNGRADES a claim citing an invocation that does not exist", () => {
    const r = verifyClaims([claim({ citations: [{ invocation_index: 9, tool_name: "x" }] })], [inv()]);
    expect(r.issues[0]!.reason).toBe("citation_out_of_range");
  });

  it("DOWNGRADES a claim citing a DENIED tool call", () => {
    // The most dangerous failure available: asserting a fact sourced from data
    // the user was refused. It must never render as observed.
    const r = verifyClaims(
      [claim({ citations: [{ invocation_index: 0, tool_name: "vendors.get", value: "Acme" }] })],
      [inv({ toolName: "vendors.get", authorized: false, data: undefined })]
    );
    expect(r.claims[0]!.claim_class).toBe("inference");
    expect(r.issues[0]!.reason).toBe("cited_tool_was_denied");
  });

  it("DOWNGRADES rather than deletes — the sentence survives, correctly labelled", () => {
    // Silently dropping it would leave an answer that reads as complete while
    // missing the part the model actually wanted to say.
    const r = verifyClaims([claim({ citations: [] })], [inv()]);
    expect(r.claims).toHaveLength(1);
    expect(r.claims[0]!.text).toBe("You have 1 Critical finding.");
  });
});

// ─── Other classes ──────────────────────────────────────────────────────────

describe("verification — the other three classes", () => {
  it("derived claims pass through (their basis is the persisted record)", () => {
    const r = verifyClaims(
      [claim({ claim_class: "derived", text: "Residual is High because effectiveness credit was 31.5." })],
      [inv()]
    );
    expect(r.claims[0]!.claim_class).toBe("derived");
    expect(r.clean).toBe(true);
  });

  it("flags an inference grounded in nothing", () => {
    // An inference with no basis is a guess wearing a label.
    const r = verifyClaims(
      [{ text: "You are probably fine.", claim_class: "inference", citations: [] }],
      [inv()]
    );
    expect(r.clean).toBe(false);
    expect(r.issues[0]!.reason).toBe("inference_without_basis");
    // Still rendered — labelled, not hidden.
    expect(r.claims).toHaveLength(1);
  });

  it("accepts an inference that lists what it reasoned from", () => {
    const r = verifyClaims(
      [
        claim(),
        { text: "This concentration looks material.", claim_class: "inference", citations: [], derived_from: [0] },
      ],
      [inv()]
    );
    expect(r.clean).toBe(true);
  });

  it("recommendations pass through", () => {
    const r = verifyClaims(
      [{ text: "Request an updated SOC 2 report.", claim_class: "recommendation", citations: [] }],
      [inv()]
    );
    expect(r.clean).toBe(true);
  });
});

// ─── Rendering ──────────────────────────────────────────────────────────────

describe("provenance survives into plain text", () => {
  it("prefixes inference and recommendation so the distinction is not UI-only", () => {
    // A provenance model that only exists in a rich UI is not a provenance
    // model — the same answer travels to email, a Brief excerpt, and voice.
    const text = renderClaims([
      claim(),
      { text: "Exposure is concentrated.", claim_class: "inference", citations: [], derived_from: [0] },
      { text: "Request an updated report.", claim_class: "recommendation", citations: [] },
    ]);
    expect(text).toMatch(/You have 1 Critical finding\./);
    expect(text).toMatch(/Assessment: Exposure is concentrated\./);
    expect(text).toMatch(/Recommended: Request an updated report\./);
  });

  it("observed claims are rendered plainly, with no decoration", () => {
    expect(renderClaims([claim()])).toBe("You have 1 Critical finding.");
  });

  it("puts each claim on its own line instead of one run-on paragraph", () => {
    // renderClaims REPLACES the model's prose, and the Ask UI renders the answer
    // `white-space: pre-wrap`. Space-joining collapsed a structured, bulleted
    // answer into a single wall of text on the final streaming frame, so the
    // answer visibly degraded at the moment it completed. Regression guard: the
    // separator is a newline, and no two claims share a line.
    const text = renderClaims([
      claim(),
      { text: "Exposure is concentrated.", claim_class: "inference", citations: [], derived_from: [0] },
      { text: "Request an updated report.", claim_class: "recommendation", citations: [] },
    ]);
    expect(text.split("\n")).toEqual([
      "You have 1 Critical finding.",
      "Assessment: Exposure is concentrated.",
      "Recommended: Request an updated report.",
    ]);
  });
});

// ─── Parsing ────────────────────────────────────────────────────────────────

describe("claim parsing tolerates a plain-prose answer", () => {
  it("returns null for a non-array, so the caller can fall back to prose", () => {
    // The model may answer without claim blocks; that must degrade to plain text
    // rather than failing the turn.
    expect(parseClaims("just prose")).toBeNull();
    expect(parseClaims(null)).toBeNull();
  });

  it("rejects an unknown claim class rather than coercing it", () => {
    expect(parseClaims([{ text: "x", claim_class: "fact" }])).toBeNull();
  });

  it("parses a well-formed block", () => {
    const parsed = parseClaims([
      { text: "x", claim_class: "observed", citations: [{ invocation_index: 0, tool_name: "t" }] },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed![0]!.claim_class).toBe("observed");
  });

  it("covers every declared class", () => {
    for (const cls of CLAIM_CLASSES) {
      expect(parseClaims([{ text: "x", claim_class: cls }])).toHaveLength(1);
    }
  });
});
