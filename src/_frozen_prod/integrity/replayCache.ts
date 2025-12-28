const seen = new Set<string>();

export function checkReplay(nonce: string) {
  if (seen.has(nonce)) return true;
  seen.add(nonce);
  return false;
}
