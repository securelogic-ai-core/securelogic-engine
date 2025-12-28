const seen = new Set<string>();

export function assertNoReplay(nonce: string) {
  if (seen.has(nonce)) {
    throw new Error("REPLAY_DETECTED");
  }
  seen.add(nonce);
}
