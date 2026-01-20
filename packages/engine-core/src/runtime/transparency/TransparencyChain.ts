import { canonicalHash } from "../canonicalHash.js";

export type TransparencyEntry = {
  root: string;
  runHash: string;
  previousRoot: string | null;
};

/**
 * Builds the next transparency entry
 */
export function buildTransparencyEntry(
  previous: TransparencyEntry | null,
  runHash: string
): TransparencyEntry {
  const previousRoot = previous ? previous.root : null;

  const root = canonicalHash({
    previousRoot,
    runHash
  });

  return {
    root,
    runHash,
    previousRoot
  };
}

/**
 * Verifies a full transparency chain
 */
export function verifyChain(entries: TransparencyEntry[]): boolean {
  let prev: TransparencyEntry | null = null;

  for (const e of entries) {
    if (prev && e.previousRoot !== prev.root) return false;

    const recomputed = canonicalHash({
      previousRoot: e.previousRoot,
      runHash: e.runHash
    });

    if (recomputed !== e.root) return false;

    prev = e;
  }

  return true;
}
