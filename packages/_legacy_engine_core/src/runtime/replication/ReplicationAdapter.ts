import type { TransparencyEntry } from "../transparency/TransparencyChain";

export interface ReplicationAdapter {
  broadcast(entry: TransparencyEntry): Promise<void>;
  fetchAll(): Promise<TransparencyEntry[]>;
}
