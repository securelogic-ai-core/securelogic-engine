import fs from "fs";
import path from "path";
import { hashPolicyBundle } from "../utils/hashPolicyBundle.js";
import { hydratePolicyBundle } from "../../registry/hydratePolicyBundle.js";

export function loadPolicyBundle(bundleId: string) {
  const file = path.join("policy-bundles", `${bundleId}.bundle.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Policy bundle not found: ${bundleId}`);
  }

  const bundle = JSON.parse(fs.readFileSync(file, "utf-8"));

  const computed = hashPolicyBundle(bundle);

  if (bundle.bundleHash !== computed) {
    throw new Error(
      `Policy bundle hash mismatch! Possible tampering.\nExpected: ${bundle.bundleHash}\nActual:   ${computed}`
    );
  }

  return hydratePolicyBundle(bundle);
}
