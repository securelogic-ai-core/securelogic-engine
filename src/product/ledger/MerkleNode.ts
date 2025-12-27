export interface MerkleNode {
  index: number;
  envelopeHash: string;
  previousHash: string | null;
  merkleHash: string;
  timestamp: string;
}
