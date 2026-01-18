import { canonicalHash } from "../canonicalHash.js";

export type TransparencyEntry = {
  index: number;
  previousHash: string | null;
  payloadHash: string;
  entryHash: string;
  createdAt: string;
};

export function buildTransparencyEntry(
  previous: TransparencyEntry | null,
  payloadHash: string
): TransparencyEntry {
  const index = previous ? previous.index + 1 : 0;
  const previousHash = previous ? previous.entryHash : null;

  const entryCore = {
    index,
    previousHash,
    payloadHash,
    createdAt: new Date().toISOString(),
  };

  const entryHash = canonicalHash(entryCore);

  return {
    ...entryCore,
    entryHash,
  };
}
