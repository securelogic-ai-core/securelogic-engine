import { createHash } from "crypto";
import type { MerkleNode } from "./MerkleNode";

export function hashMerkleNode(
  node: Omit<MerkleNode, "merkleHash">
): string {
  return createHash("sha256")
    .update(JSON.stringify(node))
    .digest("hex");
}
