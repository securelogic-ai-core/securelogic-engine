/**
 * intelligenceEvents.ts — read API for canonical Intelligence Events.
 * Intelligence Pipeline Hardening / IE.P7 (goal item 8).
 *
 * Lets downstream consumers (UI, integrations, executive surfaces) read the
 * normalized canonical events + their corroboration ledger + timeline instead of
 * raw cyber_signals. Events are GLOBAL intelligence, so these are global reads
 * behind auth — no per-org tenant filter, no customer data.
 *
 * Route chain: the Intelligence Events flag FIRST (404 while dark, before auth),
 * then requireApiKey + attachOrganizationContext (authenticated caller only).
 */

import { Router, type Request, type Response } from "express";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { intelligenceEventsFeatureFlag } from "../lib/signals/intelligenceEventsFeatureFlag.js";
import {
  listIntelligenceEvents,
  getIntelligenceEventDetail,
  getExecutiveEventSummary
} from "../lib/signals/intelligenceEventReader.js";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEVERITIES = new Set(["Critical", "High", "Moderate", "Low"]);
const STATUSES = new Set(["new", "evolving", "patched", "exploited"]);

function parseLimit(raw: unknown): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return undefined;
  return Number(raw);
}

export async function getEventsList(req: Request, res: Response): Promise<void> {
  const severity = typeof req.query["severity"] === "string" ? (req.query["severity"] as string) : undefined;
  const status = typeof req.query["status"] === "string" ? (req.query["status"] as string) : undefined;
  if (severity !== undefined && !SEVERITIES.has(severity)) {
    res.status(400).json({ error: "invalid_severity" });
    return;
  }
  if (status !== undefined && !STATUSES.has(status)) {
    res.status(400).json({ error: "invalid_status" });
    return;
  }
  const limit = parseLimit(req.query["limit"]);
  const events = await listIntelligenceEvents({
    ...(limit !== undefined ? { limit } : {}),
    ...(severity !== undefined ? { severity } : {}),
    ...(status !== undefined ? { status } : {})
  });
  res.status(200).json({ events });
}

export async function getEventDetail(req: Request, res: Response): Promise<void> {
  const id = req.params["id"];
  if (!id || typeof id !== "string" || !UUID_RE.test(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const orgId = (req as unknown as { organizationContext?: { organizationId?: string } })
    .organizationContext?.organizationId;
  const detail = await getIntelligenceEventDetail(id, orgId);
  if (detail === null) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.status(200).json(detail);
}

function parseDays(raw: unknown): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return undefined;
  return Number(raw);
}

export async function getExecutiveSummary(req: Request, res: Response): Promise<void> {
  const days = parseDays(req.query["window_days"]);
  const summary = await getExecutiveEventSummary(days ?? 30);
  res.status(200).json(summary);
}

const chain = [intelligenceEventsFeatureFlag, requireApiKey, attachOrganizationContext];

router.get("/intelligence/events", ...chain, getEventsList);
router.get("/intelligence/executive-summary", ...chain, getExecutiveSummary);
router.get("/intelligence/events/:id", ...chain, getEventDetail);

export default router;
