import type { TransparencyStore } from "../../store/TransparencyStore";
import type { TransparencyEntry } from "../TransparencyChain";

export class InMemoryTransparencyStore implements TransparencyStore {
  private entries: TransparencyEntry[] = [];

  async append(entry: TransparencyEntry) {
    this.entries.push(entry);
  }

  async getLatest(): Promise<TransparencyEntry | null> {
    return this.entries.length ? this.entries[this.entries.length - 1] : null;
  }

  async getAll(): Promise<TransparencyEntry[]> {
    return [...this.entries];
  }
}
