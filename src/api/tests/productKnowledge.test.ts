import { describe, it, expect, vi } from "vitest";

// ask.ts (transitively, via its middleware) imports infra/postgres.js, which
// throws at import time when DATABASE_URL is unset — the CI `test` lane runs
// database-free. Mock it the same way the other route-importing unit tests do
// (see the note in routes/dashboard.ts) so we can import the pure prompt
// builder without a database.
vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn() },
  pgRaw: { query: vi.fn() },
  pgElevated: { query: vi.fn() },
  withTenant: vi.fn(),
}));

import {
  WORKFLOWS,
  KNOWLEDGE_INDEX,
  NOT_USER_ACTIONS,
  PLATFORM_OVERVIEW,
  renderProductKnowledge,
} from "../lib/productKnowledge.js";
import { buildAskSystemPrompt } from "../routes/ask.js";

describe("product knowledge content", () => {
  it("covers the core platform how-to workflows", () => {
    const ids = WORKFLOWS.map((w) => w.id);
    // These are the workflows a premium platform user is most likely to ask
    // about. The whole point of this module is that "How do I add a vendor?"
    // is answerable — assert the anchor workflows exist.
    for (const id of [
      "add-vendor",
      "add-ai-system",
      "add-risk",
      "treat-risk",
      "add-control",
      "add-obligation",
      "link-evidence",
      "activate-framework",
      "view-brief",
      "understand-posture",
      "get-started",
    ]) {
      expect(ids, `missing workflow ${id}`).toContain(id);
    }
  });

  it("answers the canonical 'How do I add a vendor?' question with the real path", () => {
    const addVendor = WORKFLOWS.find((w) => w.id === "add-vendor");
    expect(addVendor).toBeDefined();
    // Grounded in the real UI: Vendors nav → /vendors/new.
    expect(addVendor!.answer).toMatch(/\/vendors/);
    expect(addVendor!.answer.toLowerCase()).toContain("add vendor");
    expect(addVendor!.keywords).toContain("add vendor");
  });

  it("every workflow answer references a real in-app path or a navigation label", () => {
    const labels = KNOWLEDGE_INDEX.destinations.map((d) => d.label.toLowerCase());
    for (const w of WORKFLOWS) {
      const mentionsPath = /\/[a-z]/.test(w.answer);
      const mentionsLabel = labels.some((l) => w.answer.toLowerCase().includes(l));
      expect(
        mentionsPath || mentionsLabel,
        `workflow ${w.id} cites no concrete path/label`
      ).toBe(true);
    }
  });

  it("each workflow has non-empty intent, answer, and keywords", () => {
    for (const w of WORKFLOWS) {
      expect(w.intent.trim().length, w.id).toBeGreaterThan(0);
      expect(w.answer.trim().length, w.id).toBeGreaterThan(0);
      expect(w.keywords.length, w.id).toBeGreaterThan(0);
    }
  });

  it("frames the platform as the product and the Brief as one output", () => {
    expect(PLATFORM_OVERVIEW.toLowerCase()).toContain("platform");
    expect(PLATFORM_OVERVIEW.toLowerCase()).toContain("intelligence brief");
  });

  it("records honest limits so the assistant does not invent non-existent UIs", () => {
    expect(NOT_USER_ACTIONS.length).toBeGreaterThan(0);
    const joined = NOT_USER_ACTIONS.join(" ").toLowerCase();
    expect(joined).toContain("posture"); // posture is derived, not authored
    expect(joined).toContain("brief"); // briefs are generated, not authored
  });
});

describe("renderProductKnowledge", () => {
  const rendered = renderProductKnowledge();

  it("includes the navigation map and the workflows", () => {
    expect(rendered).toContain("Top navigation");
    expect(rendered).toContain("/vendors");
    expect(rendered).toContain("How do I add a vendor?");
    expect(rendered).toContain("Common workflows");
  });

  it("is deterministic (stable for prompt caching)", () => {
    expect(renderProductKnowledge()).toBe(rendered);
  });
});

describe("buildAskSystemPrompt (routing + guardrails)", () => {
  const prompt = buildAskSystemPrompt();

  it("embeds the product knowledge so how-to questions are answerable", () => {
    expect(prompt).toContain("SECURELOGIC PRODUCT KNOWLEDGE");
    expect(prompt).toContain("How do I add a vendor?");
  });

  it("instructs the model NOT to claim a lack of access when the answer exists", () => {
    const lower = prompt.toLowerCase();
    expect(lower).toContain("don't have access");
    // Explicitly tells it to answer how-to from product knowledge.
    expect(lower).toContain("how-to");
    expect(lower).toContain("product knowledge");
  });

  it("still scopes the no-invented-data guardrail to organization data only", () => {
    // The CRITICAL rule must protect org data (vendor names etc.) but must NOT
    // gag the model on product navigation labels.
    expect(prompt).toContain("ORGANIZATION DATA only");
    expect(prompt.toLowerCase()).toContain("does not restrict the product knowledge");
  });

  it("keeps the two-source routing distinction (product vs posture data)", () => {
    const lower = prompt.toLowerCase();
    expect(lower).toContain("posture");
    expect(lower).toContain("genuinely absent from both");
  });
});
