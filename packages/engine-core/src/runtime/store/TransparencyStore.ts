import type { TransparencyEntry } from "../transparency/TransparencyChain";

export interface TransparencyStore {
  append(entry: TransparencyEntry): Promise<void>;
  getLatest(): Promise<TransparencyEntry | null>;
  getAll(): Promise<TransparencyEntry[]>;
}
