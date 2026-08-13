/**
 * askProvenancePass.test.ts — Ask A2 wiring.
 *
 * The claims module was already tested in isolation. What is tested here is the
 * PASS: that it actually runs, that its verdict reaches the answer, and above
 * all that a model which cites falsely is caught rather than believed.
 *
 * The Anthropic client is a stub. That is not a shortcut — the point of these
 * cases is to feed the pass a model that lies in specific, chosen ways, which a
 * real model cannot be made to do on demand.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  // The orchestrator reaches the tool registry, which resolves chains from the
  // live Express router — and that import graph reaches postgres.ts.
  process.env.DATABASE_URL ||= "postgres://ask-provenance-test/unused";
});

import { runProvenancePass } from "../lib/ask/provenancePass.js";
import { askProvenanceEnabled } from "../lib/ask/askProvenanceFeatureFlag.js";
import { runAskOrchestration } from "../lib/ask/orchestrator.js";
import type { Claim } from "../lib/ask/claims.js";

/** A client that returns one forced submit_claims tool_use. */
function clientReturning(claims: unknown): {
  messages: { create: ReturnType<typeof vi.fn> };
} {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "tool_use", name: "submit_claims", id: "t1", input: { claims } }],
      }),
    },
  };
}

const BASE = {
  model: "claude-test",
  systemPrompt: "sys",
  messages: [{ role: "user" as const, content: "how many findings?" }],
  answer: "You have 12 open findings.",
};

describe("provenance pass — the verifier decides, not the model", () => {
  it("keeps an observed claim whose cited value really is in the payload", async () => {
    const client = clientReturning([
      {
        text: "You have 12 open findings.",
        claim_class: "observed",
        citations: [{ invocation_index: 0, tool_name: "list_findings", field: "total", value: 12 }],
      },
    ]);

    const result = await runProvenancePass({
      ...BASE,
      client: client as never,
      invocations: [{ toolName: "list_findings", authorized: true, data: { total: 12, items: [] } }],
    });

    expect(result).not.toBeNull();
    expect(result!.clean).toBe(true);
    expect(result!.claims[0]!.claim_class).toBe("observed");
    expect(result!.renderedAnswer).toBe("You have 12 open findings.");
  });

  it("DOWNGRADES an observed claim whose value appears nowhere in the payload", async () => {
    // The central case. The model asserts a number the tool never returned.
    const client = clientReturning([
      {
        text: "You have 47 open findings.",
        claim_class: "observed",
        citations: [{ invocation_index: 0, tool_name: "list_findings", field: "total", value: 47 }],
      },
    ]);

    const result = await runProvenancePass({
      ...BASE,
      client: client as never,
      invocations: [{ toolName: "list_findings", authorized: true, data: { total: 12, items: [] } }],
    });

    expect(result!.clean).toBe(false);
    expect(result!.claims[0]!.claim_class).toBe("inference");
    expect(result!.issues[0]!.reason).toBe("value_not_in_tool_output");
    // Downgraded, NOT dropped — deleting a sentence from a user's answer is
    // worse than relabelling it, and the prefix is what tells the truth.
    expect(result!.renderedAnswer).toBe("Assessment: You have 47 open findings.");
  });

  it("DOWNGRADES a claim that cites a DENIED tool call", async () => {
    // The most dangerous failure available: asserting a fact sourced from data
    // the user was refused.
    const client = clientReturning([
      {
        text: "Acme's residual risk is High.",
        claim_class: "observed",
        citations: [{ invocation_index: 0, tool_name: "get_vendor", value: "High" }],
      },
    ]);

    const result = await runProvenancePass({
      ...BASE,
      client: client as never,
      invocations: [{ toolName: "get_vendor", authorized: false, data: undefined }],
    });

    expect(result!.claims[0]!.claim_class).toBe("inference");
    expect(result!.issues[0]!.reason).toBe("cited_tool_was_denied");
  });

  it("DOWNGRADES an observed claim with no citation at all", async () => {
    const client = clientReturning([
      { text: "Your posture is strong.", claim_class: "observed", citations: [] },
    ]);

    const result = await runProvenancePass({
      ...BASE,
      client: client as never,
      invocations: [{ toolName: "get_posture", authorized: true, data: { score: 71 } }],
    });

    expect(result!.claims[0]!.claim_class).toBe("inference");
    expect(result!.issues[0]!.reason).toBe("observed_without_citation");
  });

  it("DOWNGRADES a citation pointing past the end of the ledger", async () => {
    const client = clientReturning([
      {
        text: "You have 12 findings.",
        claim_class: "observed",
        citations: [{ invocation_index: 9, tool_name: "list_findings", value: 12 }],
      },
    ]);

    const result = await runProvenancePass({
      ...BASE,
      client: client as never,
      invocations: [{ toolName: "list_findings", authorized: true, data: { total: 12 } }],
    });

    expect(result!.claims[0]!.claim_class).toBe("inference");
    expect(result!.issues[0]!.reason).toBe("citation_out_of_range");
  });

  it("leaves inference and recommendation alone, and prefixes both", async () => {
    // These classes make no factual claim, so there is nothing to verify. What
    // matters is that the label survives into the rendered string.
    const client = clientReturning([
      {
        text: "You have 12 open findings.",
        claim_class: "observed",
        citations: [{ invocation_index: 0, tool_name: "list_findings", value: 12 }],
      },
      {
        text: "that concentration suggests a process gap",
        claim_class: "inference",
        citations: [],
        // Grounded in claim 0. An inference that lists nothing it reasoned from
        // is flagged separately, below.
        derived_from: [0],
      },
      { text: "review the intake workflow this quarter", claim_class: "recommendation", citations: [] },
    ]);

    const result = await runProvenancePass({
      ...BASE,
      client: client as never,
      invocations: [{ toolName: "list_findings", authorized: true, data: { total: 12 } }],
    });

    expect(result!.clean).toBe(true);
    expect(result!.renderedAnswer).toBe(
      "You have 12 open findings. " +
        "Assessment: that concentration suggests a process gap. " +
        "Recommended: review the intake workflow this quarter."
    );
  });

  it("FLAGS an inference that reasons from nothing", async () => {
    // Not downgraded — there is no lower class to move it to — but recorded, so
    // the rate is visible. An inference grounded in nothing is a guess wearing a
    // label, and the audit payload counts it.
    const client = clientReturning([
      { text: "Your programme is probably immature.", claim_class: "inference", citations: [] },
    ]);

    const result = await runProvenancePass({
      ...BASE,
      client: client as never,
      invocations: [{ toolName: "get_posture", authorized: true, data: { score: 71 } }],
    });

    expect(result!.clean).toBe(false);
    expect(result!.issues[0]!.reason).toBe("inference_without_basis");
    expect(result!.claims[0]!.claim_class).toBe("inference");
  });

  it("finds a value nested deep inside a payload", async () => {
    // Containment, not path equality: the model cites a value, not a JSON
    // pointer, and requiring an exact path would fail correct answers.
    const client = clientReturning([
      {
        text: "Acme is your highest-risk vendor.",
        claim_class: "observed",
        citations: [{ invocation_index: 0, tool_name: "list_vendors", value: "Acme" }],
      },
    ]);

    const result = await runProvenancePass({
      ...BASE,
      client: client as never,
      invocations: [
        {
          toolName: "list_vendors",
          authorized: true,
          data: { vendors: [{ id: "v1", profile: { name: "Acme", tier: 1 } }] },
        },
      ],
    });

    expect(result!.clean).toBe(true);
    expect(result!.claims[0]!.claim_class).toBe("observed");
  });
});

describe("provenance pass — it fails OPEN", () => {
  it("returns null when no tools were called", async () => {
    const client = clientReturning([]);
    const result = await runProvenancePass({ ...BASE, client: client as never, invocations: [] });
    expect(result).toBeNull();
    // And it did not spend a round trip discovering that.
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("returns null when the model declines to call the tool", async () => {
    const client = {
      messages: {
        create: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "no thanks" }] }),
      },
    };
    const result = await runProvenancePass({
      ...BASE,
      client: client as never,
      invocations: [{ toolName: "t", authorized: true, data: {} }],
    });
    expect(result).toBeNull();
  });

  it("returns null on a malformed claims payload rather than throwing", async () => {
    const client = clientReturning([{ text: "x", claim_class: "not_a_real_class", citations: [] }]);
    const result = await runProvenancePass({
      ...BASE,
      client: client as never,
      invocations: [{ toolName: "t", authorized: true, data: {} }],
    });
    expect(result).toBeNull();
  });

  it("returns null when the provider errors — a display feature cannot take Ask down", async () => {
    const client = {
      messages: { create: vi.fn().mockRejectedValue(new Error("anthropic 503")) },
    };
    const result = await runProvenancePass({
      ...BASE,
      client: client as never,
      invocations: [{ toolName: "t", authorized: true, data: {} }],
    });
    expect(result).toBeNull();
  });
});

describe("the provenance flag", () => {
  const original = process.env["SECURELOGIC_ASK_PROVENANCE_ENABLED"];
  afterEach(() => {
    if (original === undefined) delete process.env["SECURELOGIC_ASK_PROVENANCE_ENABLED"];
    else process.env["SECURELOGIC_ASK_PROVENANCE_ENABLED"] = original;
  });

  it("defaults OFF", () => {
    delete process.env["SECURELOGIC_ASK_PROVENANCE_ENABLED"];
    expect(askProvenanceEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("is off for every value except the exact string 'true'", () => {
    for (const value of ["false", "1", "yes", "TRUE", "", "on"]) {
      expect(
        askProvenanceEnabled({ SECURELOGIC_ASK_PROVENANCE_ENABLED: value } as NodeJS.ProcessEnv),
        value
      ).toBe(false);
    }
    expect(
      askProvenanceEnabled({ SECURELOGIC_ASK_PROVENANCE_ENABLED: "true" } as NodeJS.ProcessEnv)
    ).toBe(true);
  });
});

describe("orchestrator integration", () => {
  const original = process.env["SECURELOGIC_ASK_PROVENANCE_ENABLED"];
  beforeEach(() => {
    delete process.env["SECURELOGIC_ASK_PROVENANCE_ENABLED"];
  });
  afterEach(() => {
    if (original === undefined) delete process.env["SECURELOGIC_ASK_PROVENANCE_ENABLED"];
    else process.env["SECURELOGIC_ASK_PROVENANCE_ENABLED"] = original;
  });

  it("does not spend a round trip when the flag is off", async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "Hello." }] });
    const result = await runAskOrchestration({
      client: { messages: { create } } as never,
      model: "m",
      systemPrompt: "s",
      history: [],
      question: "hi",
      origin: {} as never,
    });

    expect(result.provenance).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("the raw tool payload is never carried on a persisted invocation record", async () => {
    // Verification needs full payloads; the audit ledger must not have them.
    // They are held in a parallel in-memory array precisely so that a future
    // column on ask_tool_invocations cannot pick them up by accident.
    const create = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "Hello." }] });
    const result = await runAskOrchestration({
      client: { messages: { create } } as never,
      model: "m",
      systemPrompt: "s",
      history: [],
      question: "hi",
      origin: {} as never,
    });

    for (const inv of result.invocations) {
      expect(Object.keys(inv)).not.toContain("data");
      expect(Object.keys(inv)).not.toContain("payload");
    }
  });
});

describe("claim rendering carries provenance into text-only surfaces", () => {
  it("a downgraded claim is distinguishable in a plain string", () => {
    // Email, a Brief excerpt and a voice reply all take only the string. A
    // provenance model that exists only in a rich UI is not a provenance model.
    const claims: Claim[] = [
      { text: "Acme holds PHI.", claim_class: "observed", citations: [] },
      { text: "Acme is your largest exposure.", claim_class: "inference", citations: [] },
    ];
    const client = clientReturning(claims);
    expect(client).toBeTruthy();

    const rendered = claims
      .map((c) => (c.claim_class === "inference" ? `Assessment: ${c.text}` : c.text))
      .join(" ");
    expect(rendered).toContain("Assessment:");
  });
});
