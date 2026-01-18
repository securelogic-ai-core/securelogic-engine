export interface RunStore {
  save(runId: string, data: string): Promise<void>;
  getRecord(runId: string): Promise<string | null>;
}
