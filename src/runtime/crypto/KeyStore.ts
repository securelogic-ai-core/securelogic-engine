import crypto from "node:crypto";
import fs from "node:fs";

const KEY_PATH = "engine-keypair.json";

export type EngineKeypair = {
  publicKey: string;
  privateKey: string;
};

export class KeyStore {
  static loadOrCreate(): EngineKeypair {
    if (fs.existsSync(KEY_PATH)) {
      return JSON.parse(fs.readFileSync(KEY_PATH, "utf-8"));
    }

    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");

    const pair: EngineKeypair = {
      publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString()
    };

    fs.writeFileSync(KEY_PATH, JSON.stringify(pair, null, 2));
    return pair;
  }
}
