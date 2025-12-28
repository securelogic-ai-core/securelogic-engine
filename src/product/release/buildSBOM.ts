import type { SBOMV1 } from "./SBOM";
import pkg from "../../../package.json";

export function buildSBOM(): SBOMV1 {
  return {
    version: "sbom-v1",
    generatedAt: new Date().toISOString(),
    components: [
      {
        name: pkg.name,
        version: pkg.version
      }
    ]
  };
}
