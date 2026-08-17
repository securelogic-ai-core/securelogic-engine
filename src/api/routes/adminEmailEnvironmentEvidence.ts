import { Router } from "express";
// M-1 PR-2: staff surface behind requireAdminKey — every site is a cross-org
// list-all or a by-PK read/write of platform-level (NULL-org-capable) rows, so
// the elevated owner channel is the correct disposition (A04-G1 §3 Strategy A).
// No tenant GUC exists to scope these; withTenant would return zero rows.
import { pgElevated } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import {
  readEventEnvironment,
  classifyEventEnvironment,
  currentEmailEnvironment,
  type EnvironmentMatch
} from "../infra/emailEnvironment.js";
import { isSuppressionEvent } from "../lib/emailEventTypes.js";

/**
 * GET /admin/email-environment-evidence
 *
 * The "prove" step of P1-2's observe → prove → enforce sequence, made
 * self-serve.
 *
 * WHY THIS EXISTS
 * ---------------
 * P1-2 shipped environment tagging and inbound classification in DARK mode: the
 * webhook classifies every event and logs the verdict, then processes it
 * exactly as before. Enforcement — actually rejecting an event whose
 * environment does not match this service — is gated on evidence, because the
 * failure mode of getting it wrong is production silently ceasing to record
 * bounces, which is worse than the leak it fixes.
 *
 * That evidence existed only as log lines, which meant proving the gate
 * required log access, hand-grepping, and a judgement call. Meanwhile the
 * webhook was already persisting the whole event body — INCLUDING the
 * `data.tags` the classification is derived from — into
 * `email_provider_events.payload`. So the evidence was already durable and
 * already retrospective; nothing was reading it.
 *
 * This endpoint reads it, and answers the one question the gate actually asks:
 * "if enforcement were switched on HERE, right now, what would have been
 * dropped, and would any of it have mattered?"
 *
 * FIDELITY IS THE WHOLE POINT
 * ---------------------------
 * It classifies with `readEventEnvironment` + `classifyEventEnvironment` — the
 * SAME functions the webhook calls — rather than re-deriving the rule in SQL.
 * Evidence produced by a different rule than the one enforcement will use is
 * worse than no evidence: it reads as proof while describing a system that does
 * not exist. That is also why the row is classified in JS after fetching rather
 * than aggregated in Postgres, which would have been cheaper and wrong.
 *
 * READ-ONLY, AND NOT AN ENFORCEMENT SWITCH
 * ----------------------------------------
 * It changes nothing, enables nothing, and has no flag. It reports. Turning
 * enforcement on remains a separate, explicitly authorised change.
 *
 * NOT AN ENUMERATION ORACLE: it returns counts and environment identities, and
 * deliberately no recipient addresses — the same discipline as the dark
 * telemetry line it replaces. It sits behind the full admin chain regardless.
 */

const router = Router();

/** Bounded so an operator cannot accidentally pull the whole event history. */
const MAX_ROWS = 5000;
const DEFAULT_DAYS = 7;
const MAX_DAYS = 90;

type EventRow = {
  event_type: string;
  payload: unknown;
  created_at: string;
};

type Counter = Record<string, number>;

function bump(counter: Counter, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
}

router.get("/email-environment-evidence", async (req, res) => {
  const rawDays = Number(req.query["days"] ?? DEFAULT_DAYS);
  const days =
    Number.isFinite(rawDays) && rawDays > 0 ? Math.min(Math.floor(rawDays), MAX_DAYS) : DEFAULT_DAYS;

  const receiver = currentEmailEnvironment();

  try {
    // MAX_ROWS + 1 so truncation is detected rather than inferred.
    const result = await pgElevated.query<EventRow>(
      `SELECT event_type, payload, created_at
         FROM email_provider_events
        WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
        ORDER BY created_at DESC
        LIMIT $2`,
      [days, MAX_ROWS + 1]
    );

    const truncated = result.rows.length > MAX_ROWS;
    const rows = truncated ? result.rows.slice(0, MAX_ROWS) : result.rows;

    // Typed rather than a bare Counter so the four verdicts are always present
    // in the response — an absent key would read as "no data" instead of zero.
    const classification: Record<EnvironmentMatch, number> = {
      match: 0,
      mismatch: 0,
      missing: 0,
      indeterminate: 0
    };
    const bySender: Counter = {};
    const mismatchByEventType: Counter = {};

    // The number that decides the gate: suppression events (bounce/complaint)
    // that enforcement would have DISCARDED. A dropped `delivered` is a lost log
    // line; a dropped bounce is a customer we keep mailing into a black hole.
    let suppressionEventsAtRisk = 0;
    let nonSuppressionAtRisk = 0;

    for (const row of rows) {
      const sender = readEventEnvironment(row.payload);
      const verdict: EnvironmentMatch = classifyEventEnvironment(sender, receiver);

      classification[verdict] += 1;
      bump(bySender, sender ?? "absent");

      if (verdict !== "match") {
        if (isSuppressionEvent(String(row.event_type ?? ""))) {
          suppressionEventsAtRisk += 1;
          bump(mismatchByEventType, String(row.event_type ?? "unknown"));
        } else {
          nonSuppressionAtRisk += 1;
        }
      }
    }

    const examined = rows.length;
    const wouldReject = examined - classification.match;

    // A verdict, not a vibe. Note "no events at all" is NOT safe-to-enforce:
    // an empty window proves the receiver is not receiving, which is exactly
    // the state staging was in before its webhook was registered.
    const safeToEnforce = examined > 0 && wouldReject === 0;

    const reason = truncated
      ? `Window truncated at ${MAX_ROWS} events — narrow \`days\` and re-run before ruling on the gate.`
      : examined === 0
        ? `No provider events reached this service in the last ${days} day(s). ` +
          `An empty window is NOT evidence of safety — it means this receiver is not ` +
          `receiving, so nothing has been proven. Check the provider's webhook targets.`
        : safeToEnforce
          ? `All ${examined} event(s) in the last ${days} day(s) classified as "match". ` +
            `Enforcement here would have dropped nothing.`
          : `Enforcement would have dropped ${wouldReject} of ${examined} event(s), ` +
            `${suppressionEventsAtRisk} of which are bounce/complaint events whose ` +
            `suppression would have been LOST. Do not enable enforcement here.`;

    logger.info(
      {
        event: "admin_email_environment_evidence",
        receiver,
        days,
        examined,
        truncated,
        classification,
        suppressionEventsAtRisk
      },
      "Email environment enforcement evidence computed"
    );

    return res.status(200).json({
      receiver_environment: receiver,
      window_days: days,
      events_examined: examined,
      truncated,
      oldest_event: rows[rows.length - 1]?.created_at ?? null,
      newest_event: rows[0]?.created_at ?? null,
      classification,
      by_sender_environment: bySender,
      enforcement_preview: {
        would_process: classification.match,
        would_reject: wouldReject,
        suppression_events_at_risk: suppressionEventsAtRisk,
        other_events_at_risk: nonSuppressionAtRisk,
        rejected_suppression_event_types: mismatchByEventType,
        safe_to_enforce: safeToEnforce,
        reason
      },
      // Stated so a reader does not mistake a clean local result for a
      // platform-wide one. Each environment must clear its own gate.
      caveat:
        "This reports only what THIS service received and stored. Each environment " +
        "must be evaluated on its own receiver; a clean staging result says nothing " +
        "about production."
    });
  } catch (err) {
    logger.error(
      { event: "admin_email_environment_evidence_failed", err },
      "GET /admin/email-environment-evidence failed"
    );
    return res.status(500).json({ error: "email_environment_evidence_failed" });
  }
});

export default router;
