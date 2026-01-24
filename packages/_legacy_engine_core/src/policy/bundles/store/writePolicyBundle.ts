import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import type { PolicyBundle } from "../../types/PolicyBundle.js";
import type { ExecutablePolicy } from "../../registry/ExecutablePolicy.js";

export interface WritePolicyBundleOptions {
  name: string;
  version: string;
}

export function writePolicyBundle(
  input: { policies: ExecutablePolicy[] },
  options: WritePolicyBundleOptions
): PolicyBundle {
  const bundleId = uuidv4();
  const createdAt = new Date().toISOString();

  const raw = JSON.stringify(input.policies);
  const bundleHash = crypto.createHash("sha256").update(raw).digest("hex");

  return {
    bundleId,
    bundleHash,
    name: options.name,
    version: options.version,
    createdAt,
    policies: input.policies
  };
}
