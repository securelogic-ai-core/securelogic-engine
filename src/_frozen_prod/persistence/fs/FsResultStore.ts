import { loadConfig } from "../../config/loadConfig";
const config = loadConfig();

import fs from "fs/promises";
import path from "path";
import type { ResultEnvelope } from "../../contracts";
import type { ResultStore } from "../ResultStore";

const BASE = config.dataDir;

export class FsResultStore implements ResultStore {
  async save(result: ResultEnvelope) {
    await fs.mkdir(BASE, { recursive: true });
    await fs.writeFile(
      path.join(BASE, `${result.envelopeId}.json`),
      JSON.stringify(result, null, 2)
    );
  }

  async get(envelopeId: string) {
    try {
      const raw = await fs.readFile(path.join(BASE, `${envelopeId}.json`), "utf-8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}
