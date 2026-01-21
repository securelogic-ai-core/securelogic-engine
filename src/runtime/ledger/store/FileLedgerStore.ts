import fs from "node:fs";
import path from "node:path";
import type { LedgerEntry } from "../ExecutionLedger.js";

export class FileLedgerStore {
  private filePath: string;

  constructor(filePath = "ledger.json") {
    this.filePath = path.resolve(filePath);
  }

  load(): LedgerEntry[] {
    if (!fs.existsSync(this.filePath)) return [];
    const raw = fs.readFileSync(this.filePath, "utf-8");
    return JSON.parse(raw);
  }

  save(chain: LedgerEntry[]) {
    fs.writeFileSync(this.filePath, JSON.stringify(chain, null, 2));
  }
}
