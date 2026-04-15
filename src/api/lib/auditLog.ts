/**
 * auditLog.ts — Fire-and-forget security audit event writer.
 *
 * writeAuditEvent() is intentionally non-blocking:
 *   - Never throws
 *   - Never awaits in the request path
 *   - Writes to security_audit_log in the background
 *
 * Callers should NOT await this function unless they have a specific need.
 * Failures are logged as warnings — audit events are best-effort and must
 * never block or fail a business operation.
 *
 * Usage:
 *   writeAuditEvent({
 *     organizationId: req.organizationContext?.organizationId,
 *     actorApiKeyId:  req.apiKey?.id,
 *     eventType:      "workflow.status_transition",
 *     resourceType:   "risk_treatment",
 *     resourceId:     treatmentId,
 *     payload:        { from: "in_progress", to: "mitigated" },
 *     ipAddress:      req.ip
 *   });
 */

import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";

export type AuditEventInput = {
  /** Organization scope. Null for platform-level events. */
  organizationId?: string | null;
  /** API key that triggered the event. Null for system/scheduler events. */
  actorApiKeyId?: string | null;
  /** Canonical event type identifier. Use dot-notation: 'domain.action'. */
  eventType: string;
  /** Entity class the event applies to. */
  resourceType: string;
  /** Specific entity UUID. Null for batch events or non-resource events. */
  resourceId?: string | null;
  /** Event-specific data. Kept to < 1KB for operational queries. */
  payload?: Record<string, unknown> | null;
  /** Source IP from req.ip. Null when event originates from scheduler. */
  ipAddress?: string | null;
};

/**
 * Write an audit event to security_audit_log.
 *
 * Fire-and-forget. Does NOT await — returns void immediately.
 * Errors are swallowed and logged at warn level.
 */
export function writeAuditEvent(event: AuditEventInput): void {
  // Kick off async write without awaiting it.
  // The void cast makes the intent explicit.
  void _writeAsync(event);
}

async function _writeAsync(event: AuditEventInput): Promise<void> {
  try {
    await pg.query(
      `
      INSERT INTO security_audit_log (
        organization_id,
        actor_api_key_id,
        event_type,
        resource_type,
        resource_id,
        payload,
        ip_address
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        event.organizationId ?? null,
        event.actorApiKeyId ?? null,
        event.eventType,
        event.resourceType,
        event.resourceId ?? null,
        event.payload != null ? JSON.stringify(event.payload) : null,
        event.ipAddress ?? null
      ]
    );
  } catch (err) {
    // Non-fatal — audit write failures must never surface to callers.
    logger.warn(
      { event: "audit_write_failed", eventType: event.eventType, err },
      "Security audit log write failed"
    );
  }
}
