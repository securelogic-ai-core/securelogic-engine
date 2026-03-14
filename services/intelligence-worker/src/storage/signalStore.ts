import fs from "fs/promises";

const FILE = "./data/signals.json";

export async function saveSignal(signal: any) {

  const raw = await fs.readFile(FILE, "utf8");
  const signals = JSON.parse(raw);

  signals.push(signal);

  await fs.writeFile(FILE, JSON.stringify(signals, null, 2));
}