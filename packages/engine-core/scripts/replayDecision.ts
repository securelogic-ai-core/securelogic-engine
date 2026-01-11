import fs from "fs";
import path from "path";
import crypto from "crypto";

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

const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf-8"));

console.log("=== REPLAYED DECISION ===");
console.log(JSON.stringify({
  decisionId: crypto.randomUUID(),
  contextId: "test",
  outcome: "NEEDS_REVIEW",
  riskRating: "HIGH",
  conditions: [
    {
      id: "COND-1",
      description: "High risk finding: No MFA for admin accounts",
      severity: "MEDIUM"
    }
  ],
  createdAt: new Date().toISOString(),
  policyBundleId: bundle.bundleId,
  policyBundleHash: bundle.bundleHash
}, null, 2));
