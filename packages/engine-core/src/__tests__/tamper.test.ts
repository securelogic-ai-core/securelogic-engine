import { describe, it, expect } from "vitest";
import { certifyExecution } from "../runtime/ReplayCertificationEngine.js";
import { canonicalHash } from "../runtime/canonicalHash.js";
import { generateKeypair, signExecution } from "../runtime/ExecutionCrypto.js";

async function makeExecution() {
  const { publicKey, privateKey } = await generateKeypair();

  const exec: any = {
    payload: { a: 1 },
    payloadHash: canonicalHash({ a: 1 }),
    policyBundleHash: "policy",
    signatures: [],
    signerPublicKey: publicKey,
  };

  const sig = await signExecution(exec, privateKey);
  exec.signatures.push(sig);

  return exec;
}

describe("Execution tamper resistance", () => {

  it("rejects payload tampering", async () => {
    const env = await makeExecution();
    const tampered = structuredClone(env);
    tampered.payload.a = 999;
    expect(await certifyExecution(tampered, null)).toBe(false);
  });

  it("rejects hash tampering", async () => {
    const env = await makeExecution();
    const tampered = structuredClone(env);
    tampered.payloadHash = "deadbeef";
    expect(await certifyExecution(tampered, null)).toBe(false);
  });

  it("rejects signature tampering", async () => {
    const env = await makeExecution();
    const tampered = structuredClone(env);
    tampered.signatures = ["bad"];
    expect(await certifyExecution(tampered, null)).toBe(false);
  });

  it("rejects chain tampering", async () => {
    const env1 = await makeExecution();
    const env2 = await makeExecution();

    const broken = structuredClone(env2);
    broken.previousHash = "not-the-real-previous";

    expect(await certifyExecution(broken, env1)).toBe(false);
  });

});
