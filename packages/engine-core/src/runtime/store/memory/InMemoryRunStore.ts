import type { RunStore } from "../RunStore.js";

export class InMemoryRunStore implements RunStore {
  private map = new Map<string, string>();

  async save(runId: string, data: string) {
    this.map.set(runId, data);
  }

  async getRecord(runId: string) {
    return this.map.get(runId) ?? null;
  }
}
