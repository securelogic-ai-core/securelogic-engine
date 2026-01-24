import crypto from "node:crypto";
import { KeyStore } from "../crypto/KeyStore.js";

export type LedgerEntry = {
  timestamp: string;
  inputPayload: unknown;
  outputPayload: unknown;
  inputHash: string;
  outputHash: string;
  previousHash: string | null;
  entryHash: string;
  signature: string;
  publicKey: string;
};

export class ExecutionLedger {
  private chain: LedgerEntry[] = [];
  private keys = KeyStore.loadOrCreate(); // load ONCE

  private hash(data: unknown): string {
    return crypto
      .createHash("sha256")
      .update(JSON.stringify(data))
      .digest("hex");
  }

  append(input: unknown, output: unknown): string {
    const timestamp = new Date().toISOString();
    const inputPayload = input;
    const outputPayload = output;

    const inputHash = this.hash(inputPayload);

    // 🔒 Only hash deterministic decision
    const decision = (outputPayload as any).decision;
    const outputHash = this.hash(decision);

    const last = this.chain.length > 0 ? this.chain[this.chain.length - 1]! : null;
    const previousHash = last ? last.entryHash : null;

    const entryHash = this.hash({
      timestamp,
      inputHash,
      outputHash,
      previousHash
    });

    const payloadToSign = JSON.stringify({
      timestamp,
      inputHash,
      outputHash,
      previousHash,
      entryHash
    });

    const signature = crypto
      .sign(null, Buffer.from(payloadToSign), this.keys.privateKey)
      .toString("base64");

    const publicKey = this.keys.publicKey;

    const entry: LedgerEntry = {
      timestamp,
      inputPayload,
      outputPayload,
      inputHash,
      outputHash,
      previousHash,
      entryHash,
      signature,
      publicKey
    };

    this.chain.push(entry);

    return entryHash;
  }

  getChain(): LedgerEntry[] {
    return [...this.chain];
  }

  verify(): boolean {
    for (let i = 0; i < this.chain.length; i++) {
      const entry = this.chain[i]!;
      const prev = i > 0 ? this.chain[i - 1]! : null;

      const recomputed = this.hash({
        timestamp: entry.timestamp,
        inputHash: entry.inputHash,
        outputHash: entry.outputHash,
        previousHash: entry.previousHash
      });

      if (recomputed !== entry.entryHash) return false;

      const verifyPayload = JSON.stringify({
        timestamp: entry.timestamp,
        inputHash: entry.inputHash,
        outputHash: entry.outputHash,
        previousHash: entry.previousHash,
        entryHash: entry.entryHash
      });

      const ok = crypto.verify(
        null,
        Buffer.from(verifyPayload),
        entry.publicKey,
        Buffer.from(entry.signature, "base64")
      );

      if (!ok) return false;

      if (i === 0) {
        if (entry.previousHash !== null) return false;
      } else {
        if (!prev || entry.previousHash !== prev.entryHash) return false;
      }
    }

    return true;
  }
}