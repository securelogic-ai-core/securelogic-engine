import { describe, it, expect } from "vitest";
import { InMemoryTransparencyStore } from "../runtime/transparency/memory/InMemoryTransparencyStore";
import { buildTransparencyEntry } from "../runtime/transparency/TransparencyChain";
import { RuntimeBootVerifier } from "../runtime/service/RuntimeBootVerifier";

describe("Boot integrity", () => {
  it("fails on corrupted chain", async () => {
    const store = new InMemoryTransparencyStore();

    const a = buildTransparencyEntry(null, "A");
    const b = buildTransparencyEntry(a, "B");

    b.prev = "EVIL";

    await store.append(a);
    await store.append(b);

    await expect(RuntimeBootVerifier.verify(store)).rejects.toThrow();
  });
});
