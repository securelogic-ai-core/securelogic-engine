/**
 * afterCommitHook.test.ts — withTenant's post-commit side-effect hook, over a REAL
 * transaction. registerAfterCommit queues a callback that withTenant fires ONLY after a
 * durable COMMIT and DISCARDS on rollback — the mechanism that makes a notification
 * transactionally correct (it can never fire for a write that did not land).
 *
 * DB-backed but table-free: it drives the mechanism directly (no seeded rows), like
 * asTenant.test.ts. TEST_DATABASE_URL provides a throwaway Postgres.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { withTenant, registerAfterCommit } from "../../src/api/infra/postgres.js";

let pool: Pool;
const ORG = "00000000-0000-0000-0000-0000000000aa";

/** Let queued microtasks (the detached, fire-and-forget callbacks) settle. */
const settle = () => new Promise((r) => setTimeout(r, 20));

beforeAll(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the afterCommit hook test.");
  pool = new Pool({ connectionString: url, ssl: false });
});

afterAll(async () => {
  await pool?.end();
});

describe("withTenant afterCommit hook", () => {
  it("runs registered callbacks AFTER commit — never inside the transaction", async () => {
    const order: string[] = [];
    await withTenant(ORG, async () => {
      registerAfterCommit(() => {
        order.push("callback");
      });
      order.push("body");
      // Deferred: the callback has not run while the transaction is still open.
      expect(order).toEqual(["body"]);
    });
    await settle();
    // COMMIT succeeded → the callback ran, after the body.
    expect(order).toEqual(["body", "callback"]);
  });

  it("DISCARDS callbacks when the transaction rolls back (handler throws)", async () => {
    const ran: string[] = [];
    await expect(
      withTenant(ORG, async () => {
        registerAfterCommit(() => {
          ran.push("callback");
        });
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    await settle();
    // Rollback path never reaches the drain — a rolled-back write announces nothing.
    expect(ran).toEqual([]);
  });

  it("isolates a throwing callback: siblings still run and the commit is unaffected", async () => {
    const ran: string[] = [];
    // withTenant must resolve normally even though the first callback throws.
    await expect(
      withTenant(ORG, async () => {
        registerAfterCommit(() => {
          throw new Error("callback 1 fails");
        });
        registerAfterCommit(() => {
          ran.push("callback 2");
        });
        return "committed";
      })
    ).resolves.toBe("committed");
    await settle();
    expect(ran).toEqual(["callback 2"]);
  });

  it("preserves order across multiple callbacks", async () => {
    const order: number[] = [];
    await withTenant(ORG, async () => {
      registerAfterCommit(() => order.push(1));
      registerAfterCommit(() => order.push(2));
      registerAfterCommit(() => order.push(3));
    });
    await settle();
    expect(order).toEqual([1, 2, 3]);
  });
});
