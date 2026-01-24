import { describe, it, expect } from "vitest";
import { InMemoryTransparencyStore } from "../../runtime/transparency/memory/InMemoryTransparencyStore";
import { ReplicatedTransparencyStore } from "../../runtime/transparency/ReplicatedTransparencyStore";

class FakeReplication {
  entries: any[] = [];
  async broadcast(e: any) { this.entries.push(e); }
  async fetchAll() { return this.entries; }
}

describe("Replication", () => {
  it("replicates entries", async () => {
    const a = new InMemoryTransparencyStore();
    const b = new InMemoryTransparencyStore();

    const ra = new FakeReplication();
    const rb = new FakeReplication();

    const A = new ReplicatedTransparencyStore(a, ra);
    const B = new ReplicatedTransparencyStore(b, rb);

    await A.append({ root: "1", prev: null, value: "X" });

    await B.syncFromPeers();

    const all = await B.getAll();
    expect(all.length).toBe(1);
  });
});
