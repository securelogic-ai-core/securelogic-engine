import { writeBinaryArtifact } from "../../run/artifacts/store/writeBinaryArtifact";
import { generatePdf } from "../../render/pdf/generatePdf";

export async function dispatchRun(runId: string) {
  const pdf = generatePdf(runId);
  writeBinaryArtifact(runId, "PDF", pdf);
}
