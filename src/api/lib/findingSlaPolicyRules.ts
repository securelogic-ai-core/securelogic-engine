/**
 * findingSlaPolicyRules.ts — PURE parsing of the org finding-SLA policy
 * (risk_settings.finding_sla_by_severity, migration 20260903). No I/O — the
 * same pure/IO split as findingLifecycleMachine, so policy semantics are
 * unit-testable without a database.
 *
 * Fail-safe rule: a malformed policy never sets a garbage date.
 */

export const SLA_SEVERITIES = ["Critical", "High", "Moderate", "Low"] as const;

const MAX_SLA_DAYS = 3650;

/**
 * Days-to-due for a severity under a raw policy JSONB value. Null when the
 * policy is absent/malformed, the severity is unknown, or the configured
 * value is not a positive integer ≤ 3650.
 */
export function slaDaysFor(policy: unknown, severity: string | null | undefined): number | null {
  if (policy === null || policy === undefined || typeof policy !== "object" || Array.isArray(policy)) {
    return null;
  }
  const sev = (SLA_SEVERITIES as readonly string[]).find(
    (s) => s.toLowerCase() === String(severity ?? "").toLowerCase()
  );
  if (!sev) return null;
  const raw = (policy as Record<string, unknown>)[sev];
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > MAX_SLA_DAYS) {
    return null;
  }
  return raw;
}

/** Minimal queryable — the caller supplies its own client/transaction. */
export interface SlaQueryable {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/**
 * Client-required resolver for dispatchers/workers/services that hold their
 * own transaction (keeps this module free of any pg import so import-pure
 * callers stay unit-testable). Route-side callers use
 * findingSlaPolicy.resolveSlaDueDate, which defaults to the ambient pg.
 */
export async function resolveSlaDueDateWith(
  client: SlaQueryable,
  organizationId: string,
  severity: string | null | undefined
): Promise<string | null> {
  const policyRow = await client.query(
    `SELECT finding_sla_by_severity AS policy FROM risk_settings WHERE organization_id = $1`,
    [organizationId]
  );
  const days = slaDaysFor(policyRow.rows[0]?.["policy"] ?? null, severity);
  if (days === null) return null;
  const due = await client.query(
    `SELECT (CURRENT_DATE + $1::int)::text AS due`,
    [days]
  );
  const dueVal = due.rows[0]?.["due"];
  return typeof dueVal === "string" ? dueVal : null;
}
