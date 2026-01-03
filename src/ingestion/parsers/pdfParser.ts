import type { IPCv1Document } from "../IPC_v1.js";

export async function parsePDF(doc: IPCv1Document) {
  return {
    text: doc.extractedText || "",
    blocks: doc.extractedText ? doc.extractedText.split("\\n") : [],
    metadata: {}
  };
}
