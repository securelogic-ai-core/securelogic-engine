import type { IPCv1Document } from "../IPC_v1.js";
import { parsePDF } from "../parsers/pdfParser.js";
import { parseDocx } from "../parsers/docxParser.js";
import { parseText } from "../parsers/textParser.js";

export async function routeDocument(doc: IPCv1Document) {
  switch (doc.type.toLowerCase()) {
    case "pdf":
      return parsePDF(doc);
    case "docx":
      return parseDocx(doc);
    case "txt":
    case "markdown":
      return parseText(doc);
    default:
      return parseText(doc); // fallback
  }
}
