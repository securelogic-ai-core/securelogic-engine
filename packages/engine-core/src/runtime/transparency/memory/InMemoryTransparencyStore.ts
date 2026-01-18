import type { TransparencyStore } from "../../store/TransparencyStore.js";

export class InMemoryTransparencyStore implements TransparencyStore {
  entries: any[] = [];

  async append(entry: any) {
    this.entries.push(entry);
  }
}
