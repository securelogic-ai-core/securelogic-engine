import fs from "fs";
import path from "path";

const DIR = "revoked-artifacts";
fs.mkdirSync(DIR, { recursive: true });

export function revokeArtifact(filename: string, reason = "MANUAL_REVOKE") {
  fs.writeFileSync(
    path.join(DIR, `${filename}.json`),
    JSON.stringify(
      {
        filename,
        reason,
        revokedAt: new Date().toISOString()
      },
      null,
      2
    )
  );
}
