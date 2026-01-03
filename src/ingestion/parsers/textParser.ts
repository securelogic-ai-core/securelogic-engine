import type { IPCv1Document } from "../IPC_v1.js";

export function parseText(doc: IPCv1Document) {
  return {
    text: doc.rawContent,
    blocks: doc.rawContent.split("\\n"),
    metadata: {}
  };
}
