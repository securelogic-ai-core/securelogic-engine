import type { ReceiptStore } from "../ReceiptStore.js";
import type { RunReceipt } from "../../receipt/RunReceipt.js";

export class InMemoryReceiptStore implements ReceiptStore {
  private receipts = new Map<string, RunReceipt>();

  async save(receipt: RunReceipt): Promise<void> {
    this.receipts.set(receipt.runId, receipt);
  }

  async getReceipt(runId: string): Promise<RunReceipt | null> {
    return this.receipts.get(runId) ?? null;
  }
}
