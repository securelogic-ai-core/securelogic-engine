import type { MerkleNode } from "./MerkleNode";
import { hashMerkleNode } from "./hashMerkleNode";

export class MerkleLedger {
  private chain: MerkleNode[] = [];

  append(envelopeHash: string): MerkleNode {
    const previous = this.chain[this.chain.length - 1];

    const base = {
      index: this.chain.length,
      envelopeHash,
      previousHash: previous?.merkleHash ?? null,
      timestamp: new Date().toISOString()
    };

    const node: MerkleNode = Object.freeze({
      ...base,
      merkleHash: hashMerkleNode(base)
    });

    this.chain.push(node);
    return node;
  }

  root(): string | null {
    return this.chain.at(-1)?.merkleHash ?? null;
  }
}
