import fs from "fs/promises";

const SIGNALS_FILE = "./data/signals.json";

function fingerprint(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function isDuplicateSignal(signal: any) {
  const currentId = signal.signalId || signal.id || "";
  const currentTitle = signal.title || "";

  let existingSignals: any[] = [];

  try {
    const raw = await fs.readFile(SIGNALS_FILE, "utf8");
    existingSignals = JSON.parse(raw);
  } catch {
    existingSignals = [];
  }

  const currentFingerprint = fingerprint(currentTitle);

  for (const existing of existingSignals) {
    const existingId = existing.id || existing.signalId || "";
    const existingTitle = existing.title || "";
    const existingFingerprint = fingerprint(existingTitle);

    if (currentId && existingId === currentId) {
      return true;
    }

    if (currentFingerprint && existingFingerprint === currentFingerprint) {
      return true;
    }
  }

  return false;
}