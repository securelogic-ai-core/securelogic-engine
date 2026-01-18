import type { TransparencyEntry } from "../transparency/TransparencyChain.js";

export interface TransparencyStore {
  append(entry: TransparencyEntry): Promise<void>;
  getAll(): Promise<TransparencyEntry[]>;
}
