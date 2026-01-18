import { buildExecutionRecordV1, serializeExecutionRecord } from "../record/ExecutionRecordSerializer.js";
import { canonicalHash } from "../canonicalHash.js";
import { buildTransparencyEntry } from "../transparency/TransparencyChain.js";
import type { RunReceipt } from "../receipt/RunReceipt.js";
import { signBytes } from "../ExecutionCrypto.js";
import type { RunStore } from "../store/RunStore.js";
import type { ReceiptStore } from "../store/ReceiptStore.js";
import type { TransparencyStore } from "../store/TransparencyStore.js";
import type { ExecutionPipeline } from "../run/ExecutionPipeline.js";
import type { ExecutionRun } from "../run/ExecutionRun.js";

export type SigningKey = {
  keyId: string;
  privateKey: string;
};

export class RuntimeExecutionService {
  constructor(
    private engineVersion: string,
    private signingKey: SigningKey,
    private runStore: RunStore,
    private receiptStore: ReceiptStore,
    private transparencyStore: TransparencyStore
  ) {}

  async execute(pipeline: ExecutionPipeline, finalOutput: unknown): Promise<{
    run: ExecutionRun;
    receipt: RunReceipt;
    transparency: unknown;
  }> {
    const runId = crypto.randomUUID();
    const pipelineHash = canonicalHash(pipeline);
    const finalOutputHash = canonicalHash(finalOutput);

    const record = buildExecutionRecordV1(runId, pipelineHash, finalOutputHash);
    const recordJson = serializeExecutionRecord(record);
    const recordHash = canonicalHash(record);

    const signature = signBytes(this.signingKey.privateKey, recordHash);

    const run: ExecutionRun = {
      runId,
      pipelineHash,
      finalOutputHash,
      recordHash,
      signature,
      keyId: this.signingKey.keyId,
      createdAt: new Date().toISOString(),
    };

    await this.runStore.save(runId, recordJson);

    const receipt: RunReceipt = {
      runId,
      recordHash,
      signature,
      keyId: this.signingKey.keyId,
      createdAt: new Date().toISOString(),
    };

    await this.receiptStore.save(receipt);

    const previous = (await this.transparencyStore.getAll()).slice(-1)[0] ?? null;
    const transparency = buildTransparencyEntry(previous, recordHash);
    await this.transparencyStore.append(transparency);

    return { run, receipt, transparency };
  }
}
