import crypto from "crypto";
import { pgElevated } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";

/**
 * ssoLoginCodes.ts — one-time login codes for the SAML ACS → app handoff.
 *
 * Replaces the session-JWT-in-URL redirect (enterprise architecture review
 * §6): the ACS mints an opaque single-use code, the redirect URL carries only
 * that code, and the app exchanges it server-side (POST /api/sso/exchange)
 * for the session JWT + profile fields. A leaked callback URL (history,
 * access logs, Referer) is then worth at most one 60-second race the
 * legitimate browser has already won.
 *
 * Storage discipline: the raw code never touches the database — only its
 * sha256. Consume is ONE atomic UPDATE … WHERE consumed_at IS NULL AND
 * expires_at > NOW(), so replay loses the race by construction.
 *
 * Both operations run on pgElevated (owner pool): this is the
 * UNAUTHENTICATED auth path — at consume time the org is unknown until the
 * code row itself is read, so tenant-scoped access is impossible by
 * construction (same rationale as the customerAuth login lookups).
 *
 * DARK by default behind SECURELOGIC_SSO_CODE_EXCHANGE_ENABLED: flag-off the
 * ACS emits the legacy token URL and the app callback keeps accepting it, so
 * enabling is an operator flip AFTER both services carry this code
 * (deploy-skew safe in either order).
 */

export function ssoCodeExchangeEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_SSO_CODE_EXCHANGE_ENABLED"] === "true";
}

export const SSO_LOGIN_CODE_TTL_SECONDS = 60;

function hashCode(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export interface SsoLoginCodePayload {
  organizationId: string;
  userId: string;
  email: string;
  displayName: string;
}

/** Mint a single-use login code for a completed SAML assertion. */
export async function createSsoLoginCode(
  payload: SsoLoginCodePayload
): Promise<string> {
  const raw = crypto.randomBytes(32).toString("hex");

  await pgElevated.query(
    `INSERT INTO sso_login_codes
       (organization_id, user_id, code_hash, email, display_name, expires_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + make_interval(secs => $6))`,
    [
      payload.organizationId,
      payload.userId,
      hashCode(raw),
      payload.email,
      payload.displayName,
      SSO_LOGIN_CODE_TTL_SECONDS,
    ]
  );

  // Opportunistic sweep of dead rows — no dedicated worker for a table whose
  // rows live 60 seconds. Best-effort; never blocks the login.
  pgElevated
    .query(`DELETE FROM sso_login_codes WHERE expires_at < NOW() - interval '1 hour'`)
    .catch((err) =>
      logger.warn({ event: "sso_login_code_sweep_failed", err }, "SSO code sweep failed")
    );

  return raw;
}

/**
 * Atomically consume a code. Returns the login payload exactly once per
 * code; null for unknown, expired, or already-consumed codes (indistinct by
 * design — the caller reveals nothing about which).
 */
export async function consumeSsoLoginCode(
  raw: string
): Promise<SsoLoginCodePayload | null> {
  if (typeof raw !== "string" || !/^[0-9a-f]{64}$/.test(raw)) return null;

  const result = await pgElevated.query<{
    organization_id: string;
    user_id: string;
    email: string;
    display_name: string;
  }>(
    `UPDATE sso_login_codes
        SET consumed_at = NOW()
      WHERE code_hash = $1
        AND consumed_at IS NULL
        AND expires_at > NOW()
      RETURNING organization_id, user_id, email, display_name`,
    [hashCode(raw)]
  );

  const row = result.rows[0];
  if (!row) return null;
  return {
    organizationId: row.organization_id,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
  };
}
