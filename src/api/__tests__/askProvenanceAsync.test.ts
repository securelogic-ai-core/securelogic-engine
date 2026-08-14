/**
 * askProvenanceAsync.test.ts — deferred provenance: the worker, its
 * authorization property, and its idempotency.
 *
 * WHAT THIS IS FOR. Decomposition costs ~11x the answer in output tokens at
 * ~85-100 tok/s (measured on staging), so a long answer can never be cited
 * inside the interactive budget. The work moved off the request path; these
 * cases hold the two properties that make moving it safe.
 *
 *   1. The worker must not out-read the user who asked. It issues NO canonical
 *      query — it decomposes the frozen tool results the answer was already
 *      built from. That is asserted here by watching every statement the worker
 *      runs, not by reading the code and believing it.
 *
 *   2. A retried or duplicated job must not double-cite. Claims are attached by
 *      an UPDATE guarded on the pending state, so the second run is a no-op.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ||= "postgres://ask-provenance-async-test/unused";
});

const queries: Array<{ sql: string; params: unknown[] }> = [];
/** Per-test SQL responder: first matching entry wins. */
let responder: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number };

vi.mock("../infra/postgres.js", () => ({
  pg: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      return responder(sql, params);
    }),
  },
  // The real withTenant opens a transaction and sets app.current_org_id; here it
  // only has to preserve the "everything inside runs in the scope" shape.
  withTenant: vi.fn(async (_org: string, fn: () => Promise<unknown>) => fn()),
  pgElevated: { query: vi.fn() },
}));

import { processClaimedProvenanceJob } from "../workers/askProvenanceWorker.js";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const MESSAGE = "33333333-3333-4333-8333-333333333333";

const JOB = {
  id: "job-1",
  organization_id: ORG,
  requested_by_user_id: "user-1",
  job_type: "ask_provenance",
  status: "processing",
  attempts: 1,
  max_attempts: 5,
  payload: { messageId: MESSAGE },
};

/** The frozen authorized tool results — the ONLY data the worker may read. */
const FROZEN = [
  { toolName: "list_findings", authorized: true, data: { total: 12, items: [] } },
];

function contextRow(overrides: Record<string, unknown> = {}) {
  return {
    message_id: MESSAGE,
    answer: "You have 12 open findings.",
    model_id: "claude-test",
    tool_payloads: FROZEN,
    provenance_status: "pending",
    question: "how many findings?",
    ...overrides,
  };
}

/** A model that returns one well-formed, verifiable claim. */
function clientReturning(claims: unknown) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "tool_use", name: "submit_claims", id: "t1", input: { claims } }],
        usage: { output_tokens: 100 },
      }),
    },
  };
}

const GOOD_CLAIMS = [
  {
    text: "You have 12 open findings.",
    claim_class: "observed",
    citations: [{ invocation_index: 0, tool_name: "list_findings", field: "total", value: 12 }],
  },
];

/** Default responder: context found, all writes report one affected row. */
function defaultResponder(sql: string): { rows: unknown[]; rowCount: number } {
  if (/FROM ask_provenance_contexts/i.test(sql)) return { rows: [contextRow()], rowCount: 1 };
  return { rows: [], rowCount: 1 };
}

beforeEach(() => {
  queries.length = 0;
  responder = defaultResponder;
});

describe("deferred provenance — the worker cannot out-read the asking user", () => {
  it("issues NO canonical query: it reads its own context and writes its own result, nothing else", async () => {
    const client = clientReturning(GOOD_CLAIMS);
    await processClaimedProvenanceJob(JOB, { client: client as never });

    // Every table the worker touched, extracted from the SQL it actually ran.
    const tables = new Set<string>();
    for (const { sql } of queries) {
      for (const m of sql.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_][a-z0-9_]*)/gi)) {
        tables.add(m[1]!.toLowerCase());
      }
    }

    // The allowed set is exactly: its own frozen context, the message it is
    // attaching to, and the job row. Anything else would be a NEW read of
    // customer data under the worker's identity rather than the user's.
    expect([...tables].sort()).toEqual(
      ["ask_messages", "ask_provenance_contexts", "jobs"].sort()
    );

    // Named explicitly so the intent survives a refactor of the assertion above.
    for (const forbidden of ["findings", "vendors", "risks", "assets", "ai_systems", "controls"]) {
      expect(tables.has(forbidden), `worker queried ${forbidden}`).toBe(false);
    }
  });

  it("scopes every statement to the job's own organization", async () => {
    const client = clientReturning(GOOD_CLAIMS);
    await processClaimedProvenanceJob(JOB, { client: client as never });

    const orgScoped = queries.filter((q) => /ask_(messages|provenance_contexts)/i.test(q.sql));
    expect(orgScoped.length).toBeGreaterThan(0);
    for (const q of orgScoped) {
      expect(q.params, q.sql).toContain(ORG);
      expect(q.params, q.sql).not.toContain(OTHER_ORG);
    }
  });

  it("decomposes ONLY the frozen payloads — the model never receives a fresh read", async () => {
    const client = clientReturning(GOOD_CLAIMS);
    await processClaimedProvenanceJob(JOB, { client: client as never });

    const [body] = client.messages.create.mock.calls[0]!;
    const serialized = JSON.stringify(body);
    // The frozen value reaches the model...
    expect(serialized).toContain("list_findings");
    // ...and the worker asked the database for nothing else to put there.
    const canonicalReads = queries.filter((q) =>
      /FROM\s+(findings|vendors|risks|assets)/i.test(q.sql)
    );
    expect(canonicalReads).toHaveLength(0);
  });
});

describe("deferred provenance — idempotency", () => {
  it("attaches claims under a guard on the pending state", async () => {
    const client = clientReturning(GOOD_CLAIMS);
    await processClaimedProvenanceJob(JOB, { client: client as never });

    const attach = queries.find((q) => /UPDATE ask_messages/i.test(q.sql) && /claims/i.test(q.sql));
    expect(attach).toBeDefined();
    // Without this predicate a retry would overwrite a finalized turn — and a
    // concurrent pair could each attach a full claim set to one answer.
    expect(attach!.sql).toMatch(/provenance_status\s*=\s*'pending'/i);
  });

  it("does not call the model at all when the turn is already finalized", async () => {
    responder = (sql) => {
      if (/FROM ask_provenance_contexts/i.test(sql)) {
        return { rows: [contextRow({ provenance_status: "complete" })], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    };
    const client = clientReturning(GOOD_CLAIMS);

    await processClaimedProvenanceJob(JOB, { client: client as never });

    expect(client.messages.create).not.toHaveBeenCalled();
    // And it settles the job rather than leaving it to be reclaimed forever.
    expect(queries.some((q) => /UPDATE jobs/i.test(q.sql) && /succeeded/i.test(q.sql))).toBe(true);
  });

  it("purges the frozen payloads on success — the buffer must not become a record", async () => {
    const client = clientReturning(GOOD_CLAIMS);
    await processClaimedProvenanceJob(JOB, { client: client as never });

    const purge = queries.find((q) => /UPDATE ask_provenance_contexts/i.test(q.sql));
    expect(purge).toBeDefined();
    expect(purge!.sql).toMatch(/tool_payloads\s*=\s*NULL/i);
    expect(purge!.sql).toMatch(/purged_at/i);
  });
});

describe("deferred provenance — failure is visible, never silently uncited", () => {
  it("marks the turn failed when the model produces nothing usable", async () => {
    // No tool_use block: the pass fails open and returns null.
    const client = {
      messages: { create: vi.fn().mockResolvedValue({ content: [], usage: {} }) },
    };

    await processClaimedProvenanceJob(JOB, { client: client as never });

    const attach = queries.find((q) => /UPDATE ask_messages/i.test(q.sql));
    expect(attach).toBeDefined();
    expect(attach!.params).toContain("failed");
    // Still purged — a failed job's buffer is no less sensitive.
    expect(queries.some((q) => /UPDATE ask_provenance_contexts/i.test(q.sql))).toBe(true);
  });

  it("marks the turn failed when there was no authorized retrieval to cite", async () => {
    responder = (sql) => {
      if (/FROM ask_provenance_contexts/i.test(sql)) {
        return { rows: [contextRow({ tool_payloads: [] })], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    };
    const client = clientReturning(GOOD_CLAIMS);

    await processClaimedProvenanceJob(JOB, { client: client as never });

    expect(client.messages.create).not.toHaveBeenCalled();
    const attach = queries.find((q) => /UPDATE ask_messages/i.test(q.sql));
    expect(attach!.params).toContain("failed");
  });

  it("records a downgraded decomposition as PARTIAL, not complete", async () => {
    // The cited value is not in the payload, so the verifier downgrades it —
    // the answer is cited but not clean, and must not read as fully verified.
    const client = clientReturning([
      {
        text: "You have 99 open findings.",
        claim_class: "observed",
        citations: [
          { invocation_index: 0, tool_name: "list_findings", field: "total", value: 99 },
        ],
      },
    ]);

    await processClaimedProvenanceJob(JOB, { client: client as never });

    const attach = queries.find((q) => /UPDATE ask_messages/i.test(q.sql));
    expect(attach!.params).toContain("partial");
    expect(attach!.params).not.toContain("complete");
  });

  it("survives a vanished turn without retrying forever", async () => {
    responder = (sql) => {
      if (/FROM ask_provenance_contexts/i.test(sql)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    };

    await processClaimedProvenanceJob(JOB, { client: clientReturning(GOOD_CLAIMS) as never });

    expect(queries.some((q) => /UPDATE jobs/i.test(q.sql) && /succeeded/i.test(q.sql))).toBe(true);
  });

  it("refuses a job whose payload has no message id, without a model call", async () => {
    const client = clientReturning(GOOD_CLAIMS);
    await processClaimedProvenanceJob({ ...JOB, payload: {} }, { client: client as never });

    expect(client.messages.create).not.toHaveBeenCalled();
    // Terminal, not retried: a malformed payload will never become well-formed.
    expect(queries.some((q) => /UPDATE jobs/i.test(q.sql))).toBe(true);
  });
});
