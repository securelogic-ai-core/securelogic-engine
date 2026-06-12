/**
 * rowStreamer.test.ts — ArrayRowStreamer (the test backing) + drainRows.
 * CursorRowStreamer needs a live pg connection and is exercised by integration
 * tests in a later PR; here we pin the batching/exhaustion/close contract that
 * both implementations share.
 */

import { describe, it, expect } from "vitest";
import { ArrayRowStreamer, drainRows } from "../rowStreamer";

type Row = { n: number };
const rows = (count: number): Row[] => Array.from({ length: count }, (_, i) => ({ n: i }));

describe("ArrayRowStreamer", () => {
  it("returns rows in batchSize slices, then [] at exhaustion", async () => {
    const s = new ArrayRowStreamer(rows(5));
    expect(await s.read(2)).toEqual([{ n: 0 }, { n: 1 }]);
    expect(await s.read(2)).toEqual([{ n: 2 }, { n: 3 }]);
    expect(await s.read(2)).toEqual([{ n: 4 }]); // partial final batch
    expect(await s.read(2)).toEqual([]); // exhausted
    expect(await s.read(2)).toEqual([]); // stays exhausted
  });

  it("handles an empty source", async () => {
    const s = new ArrayRowStreamer<Row>([]);
    expect(await s.read(10)).toEqual([]);
  });

  it("returns [] after close (idempotent)", async () => {
    const s = new ArrayRowStreamer(rows(3));
    await s.close();
    expect(await s.read(10)).toEqual([]);
    await expect(s.close()).resolves.toBeUndefined(); // close is idempotent
  });

  it("rejects a non-positive batchSize", async () => {
    const s = new ArrayRowStreamer(rows(3));
    await expect(s.read(0)).rejects.toBeInstanceOf(RangeError);
    await expect(s.read(-1)).rejects.toBeInstanceOf(RangeError);
  });

  it("returns a fresh array container, not the source array itself", async () => {
    const source = rows(2);
    const s = new ArrayRowStreamer(source);
    const batch = await s.read(2);
    batch.push({ n: 42 }); // mutate the returned container
    expect(source).toHaveLength(2); // source is not the same array
    expect(await s.read(2)).toEqual([]); // and the streamer is still correctly exhausted
  });
});

describe("drainRows", () => {
  it("invokes onRow for every row in order and returns the count", async () => {
    const s = new ArrayRowStreamer(rows(7));
    const seen: number[] = [];
    const total = await drainRows(s, (r) => void seen.push(r.n), 3);
    expect(total).toBe(7);
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("awaits async onRow handlers", async () => {
    const s = new ArrayRowStreamer(rows(3));
    const seen: number[] = [];
    await drainRows(s, async (r) => {
      await Promise.resolve();
      seen.push(r.n);
    });
    expect(seen).toEqual([0, 1, 2]);
  });

  it("closes the streamer even when onRow throws", async () => {
    let closed = false;
    const s = new ArrayRowStreamer(rows(3));
    const origClose = s.close.bind(s);
    s.close = async () => {
      closed = true;
      return origClose();
    };
    await expect(
      drainRows(s, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(closed).toBe(true);
  });
});
