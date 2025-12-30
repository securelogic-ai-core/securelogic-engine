import fs from "fs";
import path from "path";

export function isArtifactRevoked(filename: string): boolean {
  return fs.existsSync(
    path.join("revoked-artifacts", `${filename}.json`)
  );
}
