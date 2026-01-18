import type { TransparencyStore } from "../TransparencyStore.js";
import type { TransparencyEntry } from "../../transparency/TransparencyChain.js";

export class InMemoryTransparencyStore implements TransparencyStore {
  private entries: TransparencyEntry[] = [];

  async append(entry: TransparencyEntry) {
    this.entries.push(entry);
  }

  async getAll() {
    return [...this.entries];
  }
}
