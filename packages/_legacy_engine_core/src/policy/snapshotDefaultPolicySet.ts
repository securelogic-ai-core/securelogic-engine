import { defaultPolicySet } from "./defaultPolicySet.js";
import { writePolicyBundle } from "./bundles/store/writePolicyBundle.js";

export function snapshotDefaultPolicySet() {
  const bundle = writePolicyBundle(
    { policies: defaultPolicySet.policies },
    { name: "default", version: "1.0.0" }
  );

  return bundle;
}
