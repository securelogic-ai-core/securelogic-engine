import { describe, it, expect, vi } from "vitest";

// ask.ts (transitively, via its middleware) imports infra/postgres.js, which
// throws at import time when DATABASE_URL is unset — the CI `test` lane runs
// database-free. Mock it the same way the other route-importing unit tests do.
vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn() },
  pgRaw: { query: vi.fn() },
  pgElevated: { query: vi.fn() },
  withTenant: vi.fn(),
}));

import {
  KNOWLEDGE_INDEX,
  NOT_USER_ACTIONS,
  PLATFORM_OVERVIEW,
  renderProductKnowledge,
} from "../lib/productKnowledge.js";
import { WORKFLOW_REGISTRY } from "../productKnowledge/workflows.generated.js";
import { buildAskSystemPrompt } from "../routes/ask.js";

describe("product knowledge content", () => {
  it("frames the platform as the product and the Brief as one output", () => {
    expect(PLATFORM_OVERVIEW.toLowerCase()).toContain("platform");
    expect(PLATFORM_OVERVIEW.toLowerCase()).toContain("intelligence brief");
  });

  it("records honest limits so the assistant does not invent non-existent UIs", () => {
    expect(NOT_USER_ACTIONS.length).toBeGreaterThan(0);
    const joined = NOT_USER_ACTIONS.join(" ").toLowerCase();
    expect(joined).toContain("posture");
    expect(joined).toContain("brief");
  });

  it("renders navigation from the index (not hand-written) and includes the menu", () => {
    const rendered = renderProductKnowledge();
    expect(rendered).toContain("auto-generated from the live app menu");
    for (const item of KNOWLEDGE_INDEX.navigation) {
      if (item.type === "link") {
        expect(rendered).toContain(`${item.label} → ${item.href}`);
      }
    }
  });

  it("renders workflows from the structured registry (title + steps)", () => {
    const rendered = renderProductKnowledge();
    const addVendor = WORKFLOW_REGISTRY.find((w) => w.id === "add_vendor");
    expect(addVendor).toBeDefined();
    expect(rendered).toContain(`Workflow: ${addVendor!.title} (id: add_vendor)`);
    expect(rendered).toContain("Steps:");
    // The how-to answer for "add a vendor" is grounded in the real route.
    expect(rendered).toContain("/vendors/new");
  });
});

describe("buildAskSystemPrompt (routing + guardrails)", () => {
  const prompt = buildAskSystemPrompt();

  it("embeds the product knowledge so how-to questions are answerable", () => {
    expect(prompt).toContain("SECURELOGIC PRODUCT KNOWLEDGE");
    expect(prompt).toContain("Workflow: Add a vendor");
  });

  it("instructs the model NOT to claim a lack of access when the answer exists", () => {
    const lower = prompt.toLowerCase();
    expect(lower).toContain("don't have access");
    expect(lower).toContain("how-to");
    expect(lower).toContain("product knowledge");
  });

  it("still scopes the no-invented-data guardrail to organization data only", () => {
    expect(prompt).toContain("ORGANIZATION DATA only");
    expect(prompt.toLowerCase()).toContain("does not restrict the product knowledge");
  });

  it("keeps the two-source routing distinction (product vs posture data)", () => {
    const lower = prompt.toLowerCase();
    expect(lower).toContain("posture");
    expect(lower).toContain("genuinely absent from both");
  });
});
