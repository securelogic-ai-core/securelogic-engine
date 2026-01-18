import type { RunReceipt } from "../receipt/RunReceipt.js";

export interface ReceiptStore {
  save(receipt: RunReceipt): Promise<void>;
  getReceipt(runId: string): Promise<RunReceipt | null>;
}
