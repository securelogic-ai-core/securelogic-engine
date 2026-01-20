import type { TransparencyStore } from "../../store/TransparencyStore.js";

export class InMemoryTransparencyStore implements TransparencyStore<any> {
  private entries: any[] = [];

  async append(entry: any): Promise<void> {
    this.entries.push(entry);
  }

  async getLatest(): Promise<any | null> {
    if (this.entries.length === 0) return null;
    return this.entries[this.entries.length - 1];
  }
}
