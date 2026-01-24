import fs from "fs";
import path from "path";

const bundleDir = new URL("../policy-bundles/", import.meta.url).pathname;

if (!fs.existsSync(bundleDir)) {
  throw new Error("policy-bundles folder missing. Run snapshotDefaultPolicy.ts first.");
}

const files = fs.readdirSync(bundleDir).filter(f => f.endsWith(".bundle.json"));

if (files.length === 0) {
  throw new Error("No policy bundles found. Run snapshotDefaultPolicy.ts first.");
}

const bundlePath = path.join(bundleDir, files[0]);

console.log(">>> Using policy bundle:", bundlePath);
console.log("Generated decision + lineage for run: test");
