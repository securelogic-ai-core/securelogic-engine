import { writeBinaryArtifact } from "../src/run/artifacts/store/writeBinaryArtifact";
import { generatePdf } from "../src/render/pdf/generatePdf";
import crypto from "crypto";

(async () => {
  const runId = `test-run-${crypto.randomUUID()}`;

  const pdfBuffer = await generatePdf(runId); // <-- THIS WAS MISSING

  writeBinaryArtifact(runId, "PDF", pdfBuffer);

  console.log("Generated artifact for:", runId);
})();
