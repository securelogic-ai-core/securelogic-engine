import type { ReceiptStore } from "../ReceiptStore.js";
import type { RunReceipt } from "../../receipt/RunReceipt.js";

export class InMemoryReceiptStore implements ReceiptStore {
  private map = new Map<string, RunReceipt>();

  async save(receipt: RunReceipt) {
    this.map.set(receipt.runId, receipt);
  }

  async getReceipt(runId: string) {
    return this.map.get(runId) ?? null;
  }
}
