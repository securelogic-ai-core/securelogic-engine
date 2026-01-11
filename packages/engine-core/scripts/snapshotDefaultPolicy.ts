import fs from "fs";
import path from "path";
import { snapshotDefaultPolicySet } from "../src/policy/snapshotDefaultPolicySet.js";

const bundleDir = new URL("../policy-bundles/", import.meta.url).pathname;

console.log(">>> Writing policy bundle to:", bundleDir);

if (!fs.existsSync(bundleDir)) {
  fs.mkdirSync(bundleDir, { recursive: true });
}

const bundle = snapshotDefaultPolicySet();

const fileName = `${bundle.version}.bundle.json`;
const outPath = path.join(bundleDir, fileName);

fs.writeFileSync(outPath, JSON.stringify(bundle, null, 2));

console.log(">>> Wrote bundle file:", outPath);
