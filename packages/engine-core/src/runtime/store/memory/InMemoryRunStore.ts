import type { RunStore } from "../RunStore.js";

export class InMemoryRunStore implements RunStore {
  private map = new Map<string, string>();

  async save(runId: string, recordJson: string) {
    this.map.set(runId, recordJson);
  }

  async getRecord(runId: string) {
    return this.map.get(runId) ?? null;
  }
}
