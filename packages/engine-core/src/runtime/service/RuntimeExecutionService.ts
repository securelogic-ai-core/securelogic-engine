import { buildExecutionRecordV1, serializeExecutionRecord } from "../record/ExecutionRecordSerializer.js";
import { canonicalHash } from "../canonicalHash.js";
import { buildTransparencyEntry } from "../transparency/TransparencyChain.js";
import type { RunReceipt } from "../receipt/RunReceipt.js";
import { signHash } from "../ExecutionCrypto.js";
import type { RunStore } from "../store/RunStore.js";
import type { ReceiptStore } from "../store/ReceiptStore.js";
import type { TransparencyStore } from "../store/TransparencyStore.js";
import type { ExecutionPipeline } from "../run/ExecutionPipeline.js";
import type { ExecutionRun } from "../run/ExecutionRun.js";
import { hashRun } from "../run/RunHasher.js";
import crypto from "crypto";

export type SigningKey = {
  keyId: string;
  privateKeyPem: string;
};

export class RuntimeExecutionService {
  constructor(
    private engineVersion: string,
    private signingKey: SigningKey,
    private runStore: RunStore,
    private receiptStore: ReceiptStore,
    private transparencyStore: TransparencyStore
  ) {}

  async execute(
    pipeline: ExecutionPipeline,
    finalOutput: unknown
  ) {
    const runId = crypto.randomUUID();

    const pipelineHash = canonicalHash(pipeline);
    const finalOutputHash = canonicalHash(finalOutput);

    const record = buildExecutionRecordV1(runId, pipelineHash, finalOutputHash);
    const recordJson = serializeExecutionRecord(record);
    const recordHash = canonicalHash(record);

    const run: ExecutionRun = {
      runId,
      pipelineHash,
      finalOutputHash,
      recordHash,
      keyId: this.signingKey.keyId,
      createdAt: new Date().toISOString()
    };

    const runHash = hashRun(run);

    const signature = signHash(runHash, this.signingKey.privateKeyPem);

    await this.runStore.save(runId, recordJson);

    const previous = await this.transparencyStore.getLatest();
    const transparency = buildTransparencyEntry(previous, runHash);
    await this.transparencyStore.append(transparency);

    const receipt: RunReceipt = {
      runId,
      runHash,
      transparencyRoot: transparency.root,
      signedBy: this.signingKey.keyId,
      signedPayload: runHash,
      signature,
      createdAt: new Date().toISOString()
    };

    await this.receiptStore.save(receipt);

    return { run, receipt, transparency };
  }
}
