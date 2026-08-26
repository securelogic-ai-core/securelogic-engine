/**
 * healthHandler.ts — the GET /health handler, extracted from routes/index.ts so
 * it is testable without constructing the whole route tree.
 *
 * SL-EVID-1 added the `storage` field. Two deliberate constraints shape it:
 *
 *   1. `/health` is UNAUTHENTICATED. It therefore reports a bare readiness
 *      state and nothing else — no bucket, endpoint, account id, or SDK
 *      message. The diagnostic detail is logged, where it is privileged.
 *
 *   2. Storage state does NOT change the HTTP status. Render treats a
 *      non-200 here as "take this instance out of rotation", and production
 *      has served customers without object storage since launch. Degrading on
 *      storage would convert a known feature gap into an outage. The field is
 *      there to be alerted on; the status code stays a liveness signal about
 *      the database, exactly as before.
 */

import type { Request, Response } from "express";
import { pg } from "../infra/postgres.js";
import { checkBlobStorageReadiness } from "../lib/blobStorageReadiness.js";

/** What the endpoint may say about storage. `unknown` means the probe itself failed. */
export type HealthStorageState =
  | "ready"
  | "not_configured"
  | "misconfigured"
  | "unreachable"
  | "unknown";

async function resolveStorageState(): Promise<HealthStorageState> {
  try {
    return (await checkBlobStorageReadiness()).state;
  } catch {
    // A health endpoint that can be broken by its own probe is worse than one
    // that admits it does not know.
    return "unknown";
  }
}

export async function handleHealth(_req: Request, res: Response): Promise<void> {
  const storage = await resolveStorageState();

  try {
    await pg.query("SELECT 1");
    res.status(200).json({
      status: "ok",
      db: "connected",
      storage,
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({
      status: "degraded",
      db: "unreachable",
      storage,
      timestamp: new Date().toISOString(),
    });
  }
}
