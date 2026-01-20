import type { RunStore } from "../RunStore.js";

export class InMemoryRunStore implements RunStore {
  private records = new Map<string, string>();

  async save(runId: string, recordJson: string): Promise<void> {
    this.records.set(runId, recordJson);
  }

  async getRecord(runId: string): Promise<string | null> {
    return this.records.get(runId) ?? null;
  }
}
