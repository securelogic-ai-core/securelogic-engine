import type { TransparencyStore } from "../store/TransparencyStore";
import { verifyChain } from "../transparency/TransparencyChain";

export class RuntimeBootVerifier {
  static async verify(transparencyStore: TransparencyStore) {
    const all = await transparencyStore.getAll();
    if (!verifyChain(all)) {
      throw new Error("FATAL: Transparency log corrupted");
    }
  }
}
