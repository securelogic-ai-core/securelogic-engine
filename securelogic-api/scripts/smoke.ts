import assert from "assert";

const base = "http://localhost:3000";

async function run() {
  const health = await fetch(`${base}/health`);
  assert.strictEqual(health.status, 200);

  const signals = await fetch(`${base}/api/signals`);
  const json = await signals.json();

  assert(Array.isArray(json));
  assert(json.length > 0);
  assert("riskBand" in json[0]);

  console.log("✅ Smoke test passed");
}

run().catch(err => {
  console.error("❌ Smoke test failed");
  console.error(err);
  process.exit(1);
});
