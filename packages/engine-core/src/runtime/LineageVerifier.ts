import { hashLineage } from "../utils/lineageHasher.js";

export function verifyLineage(record: any): boolean {
  const { lineageHash, ...rest } = record;
  const recomputed = hashLineage(rest);
  return recomputed === lineageHash;
}
