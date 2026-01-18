export interface RunStore {
  save(runId: string, recordJson: string): Promise<void>;
  getRecord(runId: string): Promise<string | null>;
}
