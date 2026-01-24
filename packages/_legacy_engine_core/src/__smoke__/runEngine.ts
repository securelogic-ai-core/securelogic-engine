import { SecureLogicEngine } from "../api/Engine.js";

const result = SecureLogicEngine.runDecision(
  { system: "test" } as any,
  [],
  {
    bundleId: "test-bundle",
    bundleHash: "hash123",
    policies: []
  }
);

console.log(JSON.stringify(result, null, 2));
