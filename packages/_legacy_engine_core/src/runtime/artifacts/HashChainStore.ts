import { hashObject } from "../../utils/hasher.js";
import fs from "fs";
import path from "path";

export interface StoredArtifact<T> {
  hash: string;
  prevHash: string | null;
  timestamp: string;
  payload: T;
}

export class HashChainStore<T> {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
    fs.mkdirSync(basePath, { recursive: true });
  }

  private latestPointerFile() {
    return path.join(this.basePath, "_LATEST");
  }

  private readLatestHash(): string | null {
    if (!fs.existsSync(this.latestPointerFile())) return null;
    return fs.readFileSync(this.latestPointerFile(), "utf-8").trim();
  }

  private writeLatestHash(hash: string) {
    fs.writeFileSync(this.latestPointerFile(), hash);
  }

  write(payload: T): StoredArtifact<T> {
    const prevHash = this.readLatestHash();
    const timestamp = new Date().toISOString();

    const artifact: StoredArtifact<T> = {
      prevHash,
      timestamp,
      payload,
      hash: ""
    };

    const hash = hashObject({
      prevHash,
      timestamp,
      payload
    });

    artifact.hash = hash;

    const filename = path.join(this.basePath, `${hash}.json`);

    if (fs.existsSync(filename)) {
      throw new Error("Artifact already exists. Store is append-only.");
    }

    fs.writeFileSync(filename, JSON.stringify(artifact, null, 2));
    this.writeLatestHash(hash);

    return artifact;
  }

  read(hash: string): StoredArtifact<T> {
    const file = path.join(this.basePath, `${hash}.json`);
    if (!fs.existsSync(file)) {
      throw new Error(`Artifact not found: ${hash}`);
    }
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  }

  verifyChain(): boolean {
    const latest = this.readLatestHash();
    if (!latest) return true;

    let currentHash: string | null = latest;

    while (currentHash) {
      const record = this.read(currentHash);
      const recomputed = hashObject({
        prevHash: record.prevHash,
        timestamp: record.timestamp,
        payload: record.payload
      });

      if (recomputed !== record.hash) {
        throw new Error(`❌ Hash mismatch at ${record.hash}`);
      }

      currentHash = record.prevHash;
    }

    return true;
  }
}
