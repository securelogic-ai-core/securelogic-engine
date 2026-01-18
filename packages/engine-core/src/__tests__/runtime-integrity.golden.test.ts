import { describe, it, expect } from "vitest";
import { InMemoryRunStore } from "../runtime/store/memory/InMemoryRunStore.js";
import { InMemoryReceiptStore } from "../runtime/store/memory/InMemoryReceiptStore.js";
import { InMemoryTransparencyStore } from "../runtime/transparency/memory/InMemoryTransparencyStore.js";
import { InMemoryTrustStore } from "../runtime/trust/memory/InMemoryTrustStore.js";
import { ExecutionPipeline } from "../runtime/run/ExecutionPipeline.js";
import { RuntimeExecutionService } from "../runtime/service/RuntimeExecutionService.js";
import { RuntimeRunVerificationService } from "../runtime/verify/RuntimeRunVerificationService.js";
import { generateTestKeypair } from "./helpers/testCrypto.js";

describe("Runtime integrity (golden path)", () => {
  it("creates a run + receipt + transparency that verify", async () => {
    const kp = generateTestKeypair();

    const runStore = new InMemoryRunStore();
    const receiptStore = new InMemoryReceiptStore();
    const transparencyStore = new InMemoryTransparencyStore();
    const trustStore = new InMemoryTrustStore();

    await trustStore.addKey({
      keyId: "test",
      publicKey: kp.publicKey,
      status: "active",
      createdAt: new Date().toISOString()
    });

    const pipeline = new ExecutionPipeline("1.0.0", "policy-hash-123");
    pipeline.addStage("stage1", { a: 1 }, { b: 2 });

    const svc = new RuntimeExecutionService(
      "1.0.0",
      { keyId: "test", privateKey: kp.privateKey },
      runStore,
      receiptStore,
      transparencyStore
    );

    const result = await svc.execute(pipeline, { ok: true });

    const verify = await RuntimeRunVerificationService.verify(
      trustStore,
      result.run,
      result.receipt,
      result.transparency
    );

    expect(verify.ok).toBe(true);
  });

  it("fails verification if run is tampered", async () => {
    const kp = generateTestKeypair();

    const runStore = new InMemoryRunStore();
    const receiptStore = new InMemoryReceiptStore();
    const transparencyStore = new InMemoryTransparencyStore();
    const trustStore = new InMemoryTrustStore();

    await trustStore.addKey({
      keyId: "test",
      publicKey: kp.publicKey,
      status: "active",
      createdAt: new Date().toISOString()
    });

    const pipeline = new ExecutionPipeline("1.0.0", "policy-hash-123");
    pipeline.addStage("stage1", { a: 1 }, { b: 2 });

    const svc = new RuntimeExecutionService(
      "1.0.0",
      { keyId: "test", privateKey: kp.privateKey },
      runStore,
      receiptStore,
      transparencyStore
    );

    const result = await svc.execute(pipeline, { ok: true });

    const badRun = { ...result.run, finalOutputHash: "EVIL" };

    const verify = await RuntimeRunVerificationService.verify(
      trustStore,
      badRun,
      result.receipt,
      result.transparency
    );

    expect(verify.ok).toBe(false);
  });
});
