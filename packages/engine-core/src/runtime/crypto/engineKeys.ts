import fs from "fs";
import path from "path";
import { generateKeyPair } from "./signing.js";

const KEY_DIR = "./engine-keys";
const PRIV = path.join(KEY_DIR, "engine.private.pem");
const PUB = path.join(KEY_DIR, "engine.public.pem");

export function ensureEngineKeys() {
  if (!fs.existsSync(KEY_DIR)) fs.mkdirSync(KEY_DIR);

  if (!fs.existsSync(PRIV) || !fs.existsSync(PUB)) {
    const { privateKey, publicKey } = generateKeyPair();
    fs.writeFileSync(PRIV, privateKey);
    fs.writeFileSync(PUB, publicKey);
  }
}

export function loadPrivateKey(): string {
  ensureEngineKeys();
  return fs.readFileSync(PRIV, "utf-8");
}

export function loadPublicKey(): string {
  ensureEngineKeys();
  return fs.readFileSync(PUB, "utf-8");
}
