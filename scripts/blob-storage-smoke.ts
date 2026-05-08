/**
 * blob-storage-smoke.ts — One-shot Phase 0 validation.
 *
 * Usage:
 *   npx tsx scripts/blob-storage-smoke.ts <staging-org-uuid>
 *
 * Exercises the blob primitive end-to-end against the staging R2 bucket:
 *   put → get → signed URL → fetch signed URL → delete → final get returns 404
 *
 * Refuses to run unless APP_ENV=staging. Production must remain unconfigured
 * for R2 in this package; this guard is belt-and-suspenders.
 *
 * Exit codes:
 *   0  — all steps passed
 *   1  — any step failed (cause printed)
 *   2  — usage error or missing env
 */

import "dotenv/config";
import { randomUUID } from "node:crypto";
import {
  putObject,
  getObjectStream,
  getSignedReadUrl,
  deleteObject,
  buildObjectKey
} from "../src/api/lib/blobStorage.js";
import { readBlobStorageEnv } from "../src/api/lib/blobStorageConfig.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(reason: string, exitCode = 1): never {
  console.error(`FAIL: ${reason}`);
  process.exit(exitCode);
}

async function main(): Promise<void> {
  const orgId = process.argv[2];
  if (!orgId) {
    fail("usage: blob-storage-smoke.ts <staging-org-uuid>", 2);
  }
  if (!UUID_RE.test(orgId)) {
    fail(`'${orgId}' is not a UUID`, 2);
  }

  const appEnv = (process.env["APP_ENV"] ?? "").trim().toLowerCase();
  if (appEnv !== "staging") {
    fail(
      `refusing to run: APP_ENV must be 'staging' (saw '${appEnv || "<unset>"}'). ` +
        "Phase 0 is staging-only by mandate.",
      2
    );
  }

  const envState = readBlobStorageEnv();
  if (envState.state === "absent") {
    fail("R2 env vars are absent — populate R2_* before running smoke", 2);
  }
  if (envState.state === "malformed") {
    fail(`R2 env malformed: ${envState.reason}`, 2);
  }

  const runId = randomUUID();
  const relativeKey = `smoke/${runId}/probe.bin`;
  const absoluteKey = buildObjectKey(orgId, relativeKey);
  const payload = Buffer.from(`smoke:${runId}:${new Date().toISOString()}`);

  console.log(`smoke run: org=${orgId} key=${absoluteKey} bytes=${payload.byteLength}`);

  // 1. put
  try {
    const result = await putObject({
      organizationId: orgId,
      relativeKey,
      bytes: payload,
      contentType: "application/octet-stream"
    });
    if (result.key !== absoluteKey) {
      fail(`put OK but key mismatch: expected ${absoluteKey}, got ${result.key}`);
    }
    console.log("put OK");
  } catch (err) {
    fail(`put failed: ${(err as Error).message}`);
  }

  // 2. get
  try {
    const obj = await getObjectStream({ organizationId: orgId, key: absoluteKey });
    if (!obj.Body) fail("get OK but Body was empty");
    // Coerce stream to bytes for byte-equality check.
    const chunks: Uint8Array[] = [];
    for await (const chunk of obj.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    const buf = Buffer.concat(chunks);
    if (!buf.equals(payload)) {
      fail(`get returned ${buf.byteLength} bytes that did not match payload`);
    }
    console.log(`get OK (${buf.byteLength} bytes round-tripped)`);
  } catch (err) {
    fail(`get failed: ${(err as Error).message}`);
  }

  // 3. signed URL
  let signedUrl: string;
  try {
    const result = await getSignedReadUrl({
      organizationId: orgId,
      key: absoluteKey,
      ttlSeconds: 60
    });
    if (result.ttlSeconds !== 60) {
      fail(`signed URL ttl mismatch: expected 60, got ${result.ttlSeconds}`);
    }
    signedUrl = result.url;
    console.log(`signed-url issued OK (ttl=${result.ttlSeconds}s)`);
  } catch (err) {
    fail(`signed-url issuance failed: ${(err as Error).message}`);
  }

  // 4. fetch signed URL
  try {
    const res = await fetch(signedUrl);
    if (res.status !== 200) {
      fail(`signed-url fetch failed: HTTP ${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.equals(payload)) {
      fail(`signed-url fetch byte mismatch: expected ${payload.byteLength}, got ${buf.byteLength}`);
    }
    console.log(`signed-url fetch OK (200, ${buf.byteLength} bytes)`);
  } catch (err) {
    fail(`signed-url fetch failed: ${(err as Error).message}`);
  }

  // 5. delete
  try {
    await deleteObject({ organizationId: orgId, key: absoluteKey });
    console.log("delete OK");
  } catch (err) {
    fail(`delete failed: ${(err as Error).message}`);
  }

  // 6. final get must 404
  try {
    await getObjectStream({ organizationId: orgId, key: absoluteKey });
    fail("final get returned a body — delete did not take effect");
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    const code = e?.$metadata?.httpStatusCode;
    const name = e?.name ?? "";
    if (code === 404 || name === "NoSuchKey" || name === "NotFound") {
      console.log("final get 404 OK");
    } else {
      fail(`final get failed with unexpected error: ${(err as Error).message}`);
    }
  }

  console.log("smoke PASS");
}

main().catch((err) => {
  console.error(`unexpected error: ${(err as Error).stack ?? (err as Error).message}`);
  process.exit(1);
});
