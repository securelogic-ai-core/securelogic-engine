/**
 * askTruthPassEndToEnd.test.ts — the Ask Truth Pass walkthrough.
 *
 * Drives `POST /api/ask` through the real HTTP surface, with the real tool
 * registry executing real canonical routes against a real Postgres with RLS
 * live. Only the Anthropic client is scripted.
 *
 * ── Why the model is scripted rather than real ───────────────────────────────
 * That is not a shortcut here — it is the only way to test the property that
 * matters. The Truth Pass is not "does the model give good answers"; it is
 * "when the model asks for something it may not have, or claims something the
 * data does not support, what does the system do". A real model cannot be made
 * to attempt a cross-tenant read or cite a fabricated number on demand. A
 * scripted one can, every time.
 *
 * ── What this is NOT ─────────────────────────────────────────────────────────
 * Not the staging walkthrough. No deployed environment, no real model, no real
 * user. It proves the retrieval path, the authorization boundary, the ledger and
 * the provenance verifier are correct and connected. It does not prove answer
 * quality, and nothing here should be read as if it did.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";

/** Scripted turns, consumed in order by the mocked client. */
let script: Array<Array<Record<string, unknown>>> = [];
let calls: Array<Record<string, unknown>> = [];

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = {
      create: async (args: Record<string, unknown>) => {
        calls.push(args);
        const content = script.shift() ?? [{ type: "text", text: "No further response." }];
        return { content };
      },
    };
  }
  return { default: MockAnthropic };
});

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;
let orgAVendorId: string;
let orgBVendorId: string;

const asOrgA = (path: string) => request(app).post(path).set("X-Api-Key", seed.orgA.apiKey);
const asOrgB = (path: string) => request(app).post(path).set("X-Api-Key", seed.orgB.apiKey);

/** A scripted turn that calls one tool, then a scripted turn that answers. */
function toolThenAnswer(
  tool: string,
  input: Record<string, unknown>,
  answer: string
): Array<Array<Record<string, unknown>>> {
  return [
    [{ type: "tool_use", id: "t1", name: tool, input }],
    [{ type: "text", text: answer }],
  ];
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the Ask end-to-end test.");
  process.env.DATABASE_URL = url;
  pool = new Pool({ connectionString: url, ssl: false });

  orgAVendorId = await seedVendor(pool, seed.orgA.id, { name: "ORG-A-ACME" });
  orgBVendorId = await seedVendor(pool, seed.orgB.id, { name: "ORG-B-CONFIDENTIAL" });

  app = express();
  app.use(express.json());
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));
}, 180_000);

afterAll(async () => {
  await pool?.end();
});

beforeEach(() => {
  script = [];
  calls = [];
  process.env.ANTHROPIC_API_KEY = "sk-test-not-a-real-key";
  process.env.SECURELOGIC_ASK_ENABLED = "true";
  process.env.SECURELOGIC_ASK_TOOLS_ENABLED = "true";
  delete process.env.SECURELOGIC_ASK_PROVENANCE_ENABLED;
});

afterEach(() => {
  delete process.env.SECURELOGIC_ASK_TOOLS_ENABLED;
  delete process.env.SECURELOGIC_ASK_PROVENANCE_ENABLED;
});

describe("STEP 1 — authorized retrieval through the tool registry", () => {
  it("answers from a real tool call against a real route", async () => {
    script = toolThenAnswer("vendors.search", {}, "You have one vendor: ORG-A-ACME.");

    const res = await asOrgA("/api/ask").send({ question: "Which vendors do we have?" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.context_used.retrieval).toBe("tools");
    expect(res.body.context_used.tool_calls).toBe(1);
    expect(res.body.context_used.tools_denied).toBe(0);
  });

  it("the tool result the model saw contains this org's data and no other's", async () => {
    script = toolThenAnswer("vendors.search", {}, "One vendor.");
    await asOrgA("/api/ask").send({ question: "vendors?" });

    // The second call carries the tool_result the model was shown. This is the
    // load-bearing assertion of the whole Truth Pass: retrieval runs in the
    // CALLER's security context, so a cross-tenant row cannot be in the context
    // window in the first place.
    const withResult = JSON.stringify(calls[1]);
    expect(withResult).toContain("ORG-A-ACME");
    expect(withResult).not.toContain("ORG-B-CONFIDENTIAL");
    expect(withResult).not.toContain(seed.orgB.id);
  });

  it("org B asking the same question sees only org B's data", async () => {
    script = toolThenAnswer("vendors.search", {}, "One vendor.");
    await asOrgB("/api/ask").send({ question: "vendors?" });

    const withResult = JSON.stringify(calls[1]);
    expect(withResult).toContain("ORG-B-CONFIDENTIAL");
    expect(withResult).not.toContain("ORG-A-ACME");
  });
});

describe("STEP 2 — the authorization boundary under attack", () => {
  it("a cross-tenant id is DENIED, and the denial is non-disclosing", async () => {
    script = toolThenAnswer(
      "vendors.get",
      { id: orgBVendorId },
      "I could not find that vendor."
    );

    const res = await asOrgA("/api/ask").send({ question: "Tell me about that vendor." });
    expect(res.status).toBe(200);
    expect(res.body.context_used.tools_denied).toBe(1);

    // The model must not learn that the record EXISTS somewhere else. The
    // platform answers 404 for a cross-org read, and Ask must not leak through
    // a side channel what the API refuses to leak directly.
    const shown = JSON.stringify(calls[1]);
    expect(shown).toContain("not_found_or_not_accessible");
    expect(shown).not.toContain("ORG-B-CONFIDENTIAL");
    expect(shown).not.toMatch(/other (org|tenant)|belongs to|forbidden|not yours/i);
  });

  it("an organization_id passed as a tool ARGUMENT is ignored", async () => {
    // The most obvious attack against a tool-calling system: ask for someone
    // else's tenant by naming it. Identity comes from the request, never the
    // argument.
    script = toolThenAnswer("vendors.search", { organization_id: seed.orgB.id }, "Vendors listed.");
    await asOrgA("/api/ask").send({ question: "list vendors for the other org" });

    const shown = JSON.stringify(calls[1]);
    expect(shown).toContain("ORG-A-ACME");
    expect(shown).not.toContain("ORG-B-CONFIDENTIAL");
  });

  it("a tool the model invented is refused without guessing an intent", async () => {
    script = toolThenAnswer("findings.deleteAll", {}, "I cannot do that.");
    const res = await asOrgA("/api/ask").send({ question: "delete everything" });

    expect(res.status).toBe(200);
    expect(JSON.stringify(calls[1])).toContain("unknown_tool");
  });
});

describe("STEP 3 — the ledger", () => {
  it("records every invocation, including the DENIED one", async () => {
    script = toolThenAnswer("vendors.get", { id: orgBVendorId }, "Not found.");
    const res = await asOrgA("/api/ask").send({ question: "cross-tenant probe" });

    const rows = await pool.query<{ tool_name: string; authorized: boolean; output_digest: unknown }>(
      // The ledger hangs off the MESSAGE, not the conversation — an invocation
      // belongs to the specific answer it informed.
      `SELECT ti.tool_name, ti.authorized, ti.output_digest
         FROM ask_tool_invocations ti
         JOIN ask_messages m ON m.id = ti.message_id
        WHERE m.conversation_id = $1`,
      [res.body.conversation_id]
    );
    expect(rows.rowCount).toBe(1);
    // An audit trail that records only the successes is not an audit trail.
    expect(rows.rows[0]!.authorized).toBe(false);
  });

  it("stores the DIGEST, never the payload", async () => {
    script = toolThenAnswer("vendors.search", {}, "Vendors listed.");
    const res = await asOrgA("/api/ask").send({ question: "vendors?" });

    const rows = await pool.query<{ output_digest: Record<string, unknown> | null }>(
      `SELECT ti.output_digest
         FROM ask_tool_invocations ti
         JOIN ask_messages m ON m.id = ti.message_id
        WHERE m.conversation_id = $1`,
      [res.body.conversation_id]
    );
    const digest = JSON.stringify(rows.rows[0]!.output_digest ?? {});
    // Counts and ids, so an investigator can reconstruct WHAT was read — without
    // copying customer risk data into a second table and doubling the blast
    // radius of any future leak.
    expect(digest).not.toContain("ORG-A-ACME");
    expect(digest).toMatch(/_count|_ids/);
  });
});

describe("STEP 4 — conversation continuity", () => {
  it("persists the turn and reloads it as history on a follow-up", async () => {
    script = toolThenAnswer("vendors.search", {}, "You have one vendor: ORG-A-ACME.");
    const first = await asOrgA("/api/ask").send({ question: "Which vendors do we have?" });
    const conversationId = first.body.conversation_id;
    expect(conversationId).toBeTruthy();

    calls = [];
    script = [[{ type: "text", text: "It is a payments provider." }]];
    const second = await asOrgA("/api/ask").send({
      question: "What does it do?",
      conversation_id: conversationId,
    });

    expect(second.status).toBe(200);
    expect(second.body.conversation_id).toBe(conversationId);
    // The follow-up carries the earlier turns — "it" is only resolvable with
    // them.
    const sent = JSON.stringify(calls[0]);
    expect(sent).toContain("Which vendors do we have?");
    expect(sent).toContain("What does it do?");
  });

  it("another org's conversation id silently starts a fresh thread", async () => {
    script = toolThenAnswer("vendors.search", {}, "Vendors.");
    const orgB = await asOrgB("/api/ask").send({ question: "vendors?" });
    const orgBConversation = orgB.body.conversation_id;

    calls = [];
    script = [[{ type: "text", text: "Fresh." }]];
    const res = await asOrgA("/api/ask").send({
      question: "continue",
      conversation_id: orgBConversation,
    });

    expect(res.status).toBe(200);
    // Not-found and not-yours are indistinguishable: a probing caller must not
    // learn that a colleague's — or a stranger's — thread exists.
    expect(res.body.conversation_id).not.toBe(orgBConversation);
    expect(JSON.stringify(calls[0])).not.toContain("ORG-B-CONFIDENTIAL");
  });

  it("writes the ask.question.asked audit event", async () => {
    script = toolThenAnswer("vendors.search", {}, "Vendors.");
    await asOrgA("/api/ask").send({ question: "an audited question" });
    await new Promise((r) => setTimeout(r, 400));

    const events = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM security_audit_log
        WHERE organization_id = $1 AND event_type = 'ask.question.asked'
        ORDER BY created_at DESC LIMIT 1`,
      [seed.orgA.id]
    );
    expect(events.rowCount).toBe(1);
    expect(events.rows[0]!.payload.retrieval).toBe("tools");
    expect(events.rows[0]!.payload.question).toContain("an audited question");
  });
});

describe("STEP 4b — conversation reads (the A3 surface)", () => {
  const getOrgA = (path: string) => request(app).get(path).set("X-Api-Key", seed.orgA.apiKey);
  const getOrgB = (path: string) => request(app).get(path).set("X-Api-Key", seed.orgB.apiKey);

  it("lists the caller's own threads, titled from the opening question", async () => {
    script = toolThenAnswer("vendors.search", {}, "One vendor.");
    const asked = await asOrgA("/api/ask").send({ question: "A distinctly titled question?" });
    expect(asked.status).toBe(200);

    const res = await getOrgA("/api/ask/conversations");
    expect(res.status).toBe(200);
    const titles = res.body.conversations.map((c: { title: string | null }) => c.title);
    // Deterministic truncation of the first question — navigation, not analysis.
    expect(titles).toContain("A distinctly titled question?");
  });

  it("returns a thread's messages with their verified claims", async () => {
    const list = await getOrgA("/api/ask/conversations");
    const id = list.body.conversations[0].id;

    const res = await getOrgA(`/api/ask/conversations/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.conversation.id).toBe(id);
    const roles = res.body.messages.map((m: { role: string }) => m.role);
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
    // Provenance is replayed from the record, never recomputed: the claims
    // column rides along for the UI to render citations as verified at answer
    // time.
    for (const m of res.body.messages) {
      expect(m).toHaveProperty("claims");
    }
  });

  it("another org's read of the thread is a plain 404", async () => {
    const list = await getOrgA("/api/ask/conversations");
    const id = list.body.conversations[0].id;

    const res = await getOrgB(`/api/ask/conversations/${id}`);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("title");
  });

  it("org B's list does not contain org A's threads", async () => {
    const a = await getOrgA("/api/ask/conversations");
    const b = await getOrgB("/api/ask/conversations");
    const bIds = new Set(b.body.conversations.map((c: { id: string }) => c.id));
    for (const c of a.body.conversations) {
      expect(bIds.has(c.id)).toBe(false);
    }
  });

  it("a malformed conversation id is a 404, not a 500", async () => {
    const res = await getOrgA("/api/ask/conversations/not-a-uuid");
    expect(res.status).toBe(404);
  });

  it("a provenance-verified answer's claims are STORED, so a reloaded thread keeps its citations", async () => {
    process.env.SECURELOGIC_ASK_PROVENANCE_ENABLED = "true";
    script = [
      [{ type: "tool_use", id: "t1", name: "vendors.search", input: {} }],
      [{ type: "text", text: "You have one vendor." }],
      // The provenance pass turn: the model decomposes into claims.
      [
        {
          type: "tool_use",
          id: "p1",
          name: "submit_claims",
          input: {
            claims: [
              {
                text: "You have one vendor.",
                claim_class: "observed",
                citations: [{ invocation_index: 0, tool_name: "vendors.search" }],
              },
            ],
          },
        },
      ],
    ];
    const asked = await asOrgA("/api/ask").send({ question: "Stored claims check?" });
    expect(asked.status).toBe(200);

    const read = await getOrgA(`/api/ask/conversations/${asked.body.conversation_id}`);
    const assistant = read.body.messages.filter((m: { role: string }) => m.role === "assistant").pop();
    // Regression: recordAssistantMessage was called WITHOUT claims, so the
    // stored column was always NULL and every reloaded transcript lost its
    // citations while live responses showed them — two truths for one answer.
    expect(assistant.claims).not.toBeNull();
    expect(JSON.stringify(assistant.claims)).toContain("vendors.search");
  });
});

describe("STEP 5 — provenance", () => {
  it("DOWNGRADES a claim the tool output does not support", async () => {
    process.env.SECURELOGIC_ASK_PROVENANCE_ENABLED = "true";

    script = [
      [{ type: "tool_use", id: "t1", name: "vendors.search", input: {} }],
      [{ type: "text", text: "You have 47 vendors." }],
      // The provenance pass: the model claims a number it did not read.
      [
        {
          type: "tool_use",
          id: "p1",
          name: "submit_claims",
          input: {
            claims: [
              {
                text: "You have 47 vendors.",
                claim_class: "observed",
                citations: [{ invocation_index: 0, tool_name: "vendors.search", value: 47 }],
              },
            ],
          },
        },
      ],
    ];

    const res = await asOrgA("/api/ask").send({ question: "How many vendors?" });

    expect(res.status).toBe(200);
    expect(res.body.provenance).toBeTruthy();
    expect(res.body.provenance.verified).toBe(false);
    expect(res.body.provenance.claims[0].claim_class).toBe("inference");
    // The rendered answer tells the truth about what the sentence is.
    expect(res.body.answer).toMatch(/^Assessment: /);
  });

  it("keeps a claim the tool output DOES support", async () => {
    process.env.SECURELOGIC_ASK_PROVENANCE_ENABLED = "true";

    script = [
      [{ type: "tool_use", id: "t1", name: "vendors.search", input: {} }],
      [{ type: "text", text: "ORG-A-ACME is your vendor." }],
      [
        {
          type: "tool_use",
          id: "p1",
          name: "submit_claims",
          input: {
            claims: [
              {
                text: "ORG-A-ACME is your vendor.",
                claim_class: "observed",
                citations: [
                  { invocation_index: 0, tool_name: "vendors.search", value: "ORG-A-ACME" },
                ],
              },
            ],
          },
        },
      ],
    ];

    const res = await asOrgA("/api/ask").send({ question: "Who is our vendor?" });
    expect(res.body.provenance.verified).toBe(true);
    expect(res.body.provenance.claims[0].claim_class).toBe("observed");
    expect(res.body.answer).toBe("ORG-A-ACME is your vendor.");
  });

  it("is absent — not empty — when the flag is off", async () => {
    // A client must be able to tell "no provenance available" from "provenance
    // says nothing was observed".
    script = toolThenAnswer("vendors.search", {}, "Vendors.");
    const res = await asOrgA("/api/ask").send({ question: "vendors?" });
    expect(res.body.provenance).toBeUndefined();
  });
});

describe("STEP 6 — degradation", () => {
  it("returns ask_unavailable, not a 500, when no model is configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await asOrgA("/api/ask").send({ question: "anything" });

    expect(res.status).not.toBe(500);
    expect(JSON.stringify(res.body)).toMatch(/unavailable/i);
  });

  it("the kill switch 404s the route", async () => {
    process.env.SECURELOGIC_ASK_ENABLED = "false";
    const res = await asOrgA("/api/ask").send({ question: "anything" });
    expect(res.status).toBe(404);
  });

  it("the tools flag falls back to the snapshot path without erroring", async () => {
    // Rollback is the flag alone: no migration, no data change. Both paths share
    // the route, the authorization and the audit event.
    process.env.SECURELOGIC_ASK_TOOLS_ENABLED = "false";
    script = [[{ type: "text", text: "Snapshot answer." }]];

    const res = await asOrgA("/api/ask").send({ question: "vendors?" });
    expect(res.status).toBe(200);
    expect(res.body.context_used.retrieval).not.toBe("tools");
  });

  it("an empty question is refused before any model call", async () => {
    script = [];
    calls = [];
    const res = await asOrgA("/api/ask").send({ question: "   " });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
