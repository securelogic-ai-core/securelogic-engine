/**
 * connectorWritebackWorker.ts — ERIP Epic 2 (E2a): the bidirectional-writeback
 * worker (ERIP-AD-12). Drains due connector_writeback_intents by pushing
 * whitelisted external fields back to the source system, with deterministic
 * optimistic-concurrency conflict resolution (connectorWritebackCore).
 *
 * Per (org, connector) with due intents:
 *   1. load    — the org's connector row + due pending intents (tenant read).
 *                Missing/disabled/undecryptable → skip (intents stay pending).
 *   2. read    — adapter.writeback.readCurrent() for the target refs. Network
 *                I/O OUTSIDE any transaction (the sync-worker discipline).
 *   3. decide  — pure decideWriteback per intent: apply / noop-adopt / conflict.
 *   4. write   — adapter.writeback.writeField() for true applies, grouped one
 *                PATCH per external record. Network I/O outside any tx.
 *   5. persist — per-intent outcome (applied / conflict / transient-fail-backoff
 *                / terminal-fail) in ONE tenant tx.
 *
 * FLAG GATE: runWritebackTick refuses unless BOTH ECL + EAR are on AND the
 * writeback fence (SECURELOGIC_CONNECTOR_WRITEBACK_ENABLED) — writeback is the
 * only external-MUTATION path, so it is fenced separately from read-only sync.
 * Cross-org due-scan on the elevated channel; every push runs under the org's
 * tenant tx; never throws (per-connector failure is logged, sweep continues).
 */

import { schedule } from "node-cron";

import { withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { enterpriseContextEnabled } from "../lib/enterpriseContextFeatureFlag.js";
import { assetRegistryEnabled } from "../lib/assetRegistryFeatureFlag.js";
import { connectorWritebackEnabled } from "../lib/connectorWritebackFlag.js";
import { getConnector } from "../lib/connectors/registry.js";
import type { HttpClient } from "../lib/connectors/types.js";
import { buildConnectorHttpClient } from "../lib/connectorHttpClient.js";
import { getConnectorRow, decryptConnectorConfig } from "../lib/connectorConfigStore.js";
import { decideWriteback, writebackBackoffMinutes } from "../lib/connectorWritebackCore.js";
import {
  scanDueWritebackConnectors,
  readDueIntents,
  recordApplied,
  recordConflict,
  recordTransientFailure,
  recordTerminalFailure,
  type WritebackIntentRow
} from "../lib/connectorWritebackStore.js";

export interface WritebackWorkerDeps {
  now?: () => Date;
  shouldContinue?: () => boolean;
  http?: HttpClient;
}

/** Bounded per-tick fan-out — a large backlog drains over successive ticks. */
export const MAX_WRITEBACK_CONNECTORS_PER_TICK = 100;
export const MAX_INTENTS_PER_CONNECTOR = 200;

export interface WritebackConnectorSummary {
  connector_id: string;
  applied: number;
  noop: number;
  conflict: number;
  failed: number;
  skipped_unwritable: number;
}

/**
 * Process one (org, connector)'s due intents. Returns a summary, or null when
 * the connector is not actionable (missing/disabled/undecryptable/no writeback
 * capability) — the intents stay pending for a later tick.
 */
export async function processConnectorWriteback(
  orgId: string,
  connectorId: string,
  deps: WritebackWorkerDeps
): Promise<WritebackConnectorSummary | null> {
  const now = deps.now ?? (() => new Date());
  const adapter = getConnector(connectorId);
  const writeback = adapter?.writeback;
  if (!writeback) return null;

  // 1. Load config + due intents in a short tenant read (no tx held over I/O).
  const loaded = await withTenant(orgId, async () => {
    const row = await getConnectorRow(orgId, connectorId);
    if (!row || !row.enabled) return null;
    const config = decryptConnectorConfig(row);
    if (!config) return null;
    const intents = await readDueIntents(orgId, connectorId, MAX_INTENTS_PER_CONNECTOR);
    return { config, intents };
  });
  if (!loaded || loaded.intents.length === 0) return null;

  const summary: WritebackConnectorSummary = {
    connector_id: connectorId,
    applied: 0,
    noop: 0,
    conflict: 0,
    failed: 0,
    skipped_unwritable: 0
  };

  // Defense in depth: an intent for a field outside the adapter whitelist can
  // never be written — mark it terminally failed (the enqueue route already
  // rejects these, so this only catches drift/tampering).
  const allowed = new Set(writeback.fields);
  const writable = loaded.intents.filter((i) => allowed.has(i.field));
  const unwritable = loaded.intents.filter((i) => !allowed.has(i.field));

  // 2. Read current external values for all target refs (network, outside tx).
  const refs = [...new Set(writable.map((i) => i.external_ref))];
  let current: Map<string, Record<string, string | null>>;
  try {
    current = refs.length > 0 ? await writeback.readCurrent(loaded.config, deps.http ?? buildConnectorHttpClient(), refs) : new Map();
  } catch (err) {
    // Whole-group read failure → back off every writable intent (transient).
    await withTenant(orgId, async () => {
      for (const i of writable) await backoffOrFail(orgId, i, err, now(), summary);
      for (const i of unwritable) {
        await recordTerminalFailure(orgId, i.id, i.attempts, `field not writable for ${connectorId}: ${i.field}`);
        summary.skipped_unwritable++;
      }
    });
    return summary;
  }

  // 3. Decide per intent; group true applies into one PATCH per external record.
  type Planned = { intent: WritebackIntentRow; decision: "apply" | "noop"; external: string | null };
  const planned: Planned[] = [];
  const conflicts: Array<{ intent: WritebackIntentRow; external: string | null }> = [];
  const applyValues = new Map<string, Record<string, string>>();
  for (const i of writable) {
    const external = current.get(i.external_ref)?.[i.field] ?? null;
    const decision = decideWriteback({ desiredValue: i.desired_value, externalCurrent: external, lastPushed: i.last_pushed_value });
    if (decision === "conflict") {
      conflicts.push({ intent: i, external });
      continue;
    }
    planned.push({ intent: i, decision, external });
    if (decision === "apply") {
      const values = applyValues.get(i.external_ref) ?? {};
      values[i.field] = i.desired_value;
      applyValues.set(i.external_ref, values);
    }
  }

  // 4. Write true applies (network, outside tx). One PATCH per record; a record
  //    failure fails every apply-intent for that record together (atomic PATCH).
  const writeErrors = new Map<string, unknown>();
  const http = deps.http ?? buildConnectorHttpClient();
  for (const [ref, values] of applyValues) {
    try {
      await writeback.writeField(loaded.config, http, ref, values);
    } catch (err) {
      writeErrors.set(ref, err);
    }
  }

  // 5. Persist every outcome in one tenant tx.
  await withTenant(orgId, async () => {
    for (const i of unwritable) {
      await recordTerminalFailure(orgId, i.id, i.attempts, `field not writable for ${connectorId}: ${i.field}`);
      summary.skipped_unwritable++;
    }
    for (const c of conflicts) {
      await recordConflict(orgId, c.intent.id, c.external);
      summary.conflict++;
    }
    for (const p of planned) {
      if (p.decision === "noop") {
        // Already at desired externally — adopt it as our last-pushed baseline.
        await recordApplied(orgId, p.intent.id, p.intent.desired_value, p.external);
        summary.noop++;
        continue;
      }
      const err = writeErrors.get(p.intent.external_ref);
      if (err !== undefined) {
        await backoffOrFail(orgId, p.intent, err, now(), summary);
      } else {
        await recordApplied(orgId, p.intent.id, p.intent.desired_value, p.external);
        summary.applied++;
      }
    }
  });

  return summary;
}

/** Bump attempts; back off (still pending) unless the retry budget is spent. */
async function backoffOrFail(
  orgId: string,
  intent: WritebackIntentRow,
  err: unknown,
  now: Date,
  summary: WritebackConnectorSummary
): Promise<void> {
  const attempts = intent.attempts + 1;
  const message = ((err as Error)?.message ?? String(err)).slice(0, 500);
  if (attempts >= intent.max_attempts) {
    await recordTerminalFailure(orgId, intent.id, attempts, `writeback failed after ${attempts} attempts: ${message}`);
    summary.failed++;
    return;
  }
  const next = new Date(now.getTime() + writebackBackoffMinutes(attempts) * 60_000);
  await recordTransientFailure(orgId, intent.id, attempts, next, message);
  // Not counted as applied/conflict/failed — it will be retried next tick.
}

/**
 * One sweep: scan due (org, connector) pairs and drain each. Triple-fenced
 * idle-skip (ECL + EAR + writeback). Returns the number of connectors that
 * produced any outcome.
 */
export async function runWritebackTick(deps: WritebackWorkerDeps = {}): Promise<number> {
  if (!enterpriseContextEnabled() || !assetRegistryEnabled() || !connectorWritebackEnabled()) return 0;

  const due = await scanDueWritebackConnectors(MAX_WRITEBACK_CONNECTORS_PER_TICK);
  let processed = 0;
  for (const pair of due) {
    if (deps.shouldContinue && !deps.shouldContinue()) break;
    try {
      const summary = await processConnectorWriteback(pair.organization_id, pair.connector_id, deps);
      if (summary) {
        processed++;
        writeAuditEvent({
          organizationId: pair.organization_id,
          eventType: "connector.writeback_applied",
          resourceType: "enterprise_connector",
          resourceId: null,
          payload: { ...summary }
        });
        logger.info(
          { event: "connector_writeback_complete", org_id: pair.organization_id, ...summary },
          "connector-writeback: connector drained"
        );
      }
    } catch (err) {
      logger.error(
        { event: "connector_writeback_failed", org_id: pair.organization_id, connector_id: pair.connector_id, err },
        "connector-writeback: connector sweep failed; continuing"
      );
    }
  }
  return processed;
}

let isTicking = false;

/**
 * Register the writeback worker cron (every minute). Always registered; each
 * tick self-gates on ECL + EAR + the writeback flag inside runWritebackTick
 * (zero DB access while off) — a flag flip takes effect on the next tick.
 */
export function startConnectorWritebackWorker(): void {
  schedule("* * * * *", () => {
    if (isTicking) {
      logger.warn({ event: "connector_writeback_tick_overlap_skipped" }, "connector-writeback: previous tick still running");
      return;
    }
    isTicking = true;
    void runWritebackTick()
      .catch((err) => logger.error({ event: "connector_writeback_tick_error", err }, "connector-writeback worker tick failed"))
      .finally(() => {
        isTicking = false;
      });
  });
  logger.info(
    { event: "connector_writeback_worker_registered", schedule: "* * * * * (every minute)" },
    "Connector writeback worker registered (gated by SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED + SECURELOGIC_ASSET_REGISTRY_ENABLED + SECURELOGIC_CONNECTOR_WRITEBACK_ENABLED)"
  );
}
