import fs from "fs";
import path from "path";
import type { PolicyVersion } from "../PolicyVersion.js";

const DIR = "policy-versions";
fs.mkdirSync(DIR, { recursive: true });

export function writePolicyVersion(version: PolicyVersion) {
  fs.writeFileSync(
    path.join(DIR, `${version.versionId}.policy.json`),
    JSON.stringify(version, null, 2)
  );
}
