import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { verifyJwt, SESSION_BLOCKED_STATUSES } from "../lib/jwt.js";

declare global {
  namespace Express {
    interface Request {
      /** UUID of the authenticated user (JWT path only) */
      userId?: string;
      /** Role of the authenticated user (JWT path only) */
      userRole?: string;
      /**
       * When a JWT user is authenticated, this is their user UUID.
       * Routes can use it as a fallback for owner_user_id when the
       * caller doesn't provide one explicitly.
       */
      autoUserId?: string;
    }
  }
}

const MUTATION_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

export async function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const presentedKey =
      req.header("X-Api-Key") ||
      req.header("x-api-key") ||
      req.header("Authorization")?.replace(/^Bearer\s+/i, "").trim();

    if (!presentedKey) {
      writeAuditEvent({
        actorUserId: null,
        eventType: "auth.missing_api_key",
        resourceType: "api_key",
        payload: { route: req.originalUrl, method: req.method },
        ipAddress: req.ip ?? null
      });
      res.status(401).json({ error: "api_key_required" });
      return;
    }

    // JWT bridge: if the token contains dots it is a JWT, not an API key.
    // Verify the JWT, then load the org's primary API key record so all
    // downstream middleware (attachOrganizationContext, requireEntitlement, …)
    // works without modification.
    if (presentedKey.includes(".")) {
      const payload = verifyJwt(presentedKey);

      if (!payload) {
        writeAuditEvent({
          actorUserId: null,
          eventType: "auth.invalid_jwt",
          resourceType: "user",
          payload: { route: req.originalUrl, method: req.method },
          ipAddress: req.ip ?? null
        });
        res.status(401).json({ error: "invalid_token" });
        return;
      }

      // Live-session enforcement against the users row: status, role, and
      // password recency. Fail CLOSED on DB error: leaked pre-rotation
      // tokens must not replay during a Postgres degradation window. The
      // api_keys lookup below has no fallback either, so failing JWT-bridge
      // auth here doesn't widen the outage envelope.
      let effectiveRole: string;
      try {
        const pwResult = await pg.query<{
          password_changed_at: Date | null;
          status: string;
          role: string;
        }>(
          `SELECT password_changed_at, status, role FROM users WHERE id = $1 LIMIT 1`,
          [payload.sub]
        );
        const userRow = pwResult.rows[0] ?? null;

        // Removed members ('inactive'), deletion-lifecycle statuses, and
        // hard-deleted rows terminate the session now — not at the token's
        // natural expiry up to 7 days later.
        if (userRow === null || SESSION_BLOCKED_STATUSES.has(userRow.status)) {
          writeAuditEvent({
            actorUserId: payload.sub,
            eventType: "auth.session_blocked_inactive",
            resourceType: "user",
            resourceId: payload.sub,
            payload: { route: req.originalUrl, method: req.method, status: userRow?.status ?? "missing" },
            ipAddress: req.ip ?? null
          });
          res.status(401).json({
            error: "account_inactive",
            detail: "This account no longer has access. Contact your administrator."
          });
          return;
        }

        const changedAt = userRow.password_changed_at;
        if (changedAt !== null && payload.iat < Math.floor(new Date(changedAt).getTime() / 1000)) {
          res.status(401).json({ error: "session_invalidated", detail: "Password was changed. Please sign in again." });
          return;
        }

        // Role changes take effect immediately: authz below uses the
        // current DB role, not the claim baked into the token at issue.
        effectiveRole = userRow.role;
      } catch (err) {
        logger.error(
          { event: "jwt_bridge_pw_check_db_error", err, userId: payload.sub },
          "JWT-bridge password-change check failed; failing closed"
        );
        writeAuditEvent({
          actorUserId: payload.sub,
          eventType: "auth.jwt_bridge_db_failure",
          resourceType: "user",
          payload: { route: req.originalUrl, method: req.method },
          ipAddress: req.ip ?? null
        });
        res.status(503).json({
          error: "auth_unavailable",
          detail: "Authentication service temporarily unavailable. Please retry."
        });
        return;
      }

      // Viewer accounts may not perform mutations.
      // API key auth (non-JWT) bypasses this check — API keys are admin-level.
      if (effectiveRole === "viewer" && MUTATION_METHODS.has(req.method.toUpperCase())) {
        res.status(403).json({
          error: "read_only_access",
          detail: "Viewer accounts cannot make changes."
        });
        return;
      }

      const orgKeyResult = await pg.query(
        `SELECT id, organization_id, label, key_hash, status,
                last_used_at, created_at, revoked_at, expires_at,
                created_by_user_id
           FROM api_keys
          WHERE organization_id = $1 AND status = 'active'
          ORDER BY created_at DESC LIMIT 1`,
        [payload.org]
      );

      if (orgKeyResult.rows.length === 0) {
        res.status(401).json({ error: "no_active_api_key" });
        return;
      }

      const orgApiKey = orgKeyResult.rows[0] as Record<string, unknown>;

      // Fire-and-forget last_used_at update — same pattern as direct key path.
      pg.query(
        `UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`,
        [orgApiKey.id]
      ).catch(() => { /* silent */ });

      (req as any).apiKey     = orgApiKey;
      (req as any).jwtPayload = { ...payload, role: effectiveRole };
      req.userId              = payload.sub;
      req.userRole            = effectiveRole;
      req.autoUserId          = payload.sub;
      next();
      return;
    }

    const hashedKey = crypto.createHash("sha256").update(presentedKey).digest("hex");

    const result = await pg.query(
      `
      SELECT id, organization_id, label, key_hash, status,
             last_used_at, created_at, revoked_at, expires_at,
             created_by_user_id
      FROM api_keys
      WHERE key_hash = $1
      LIMIT 1
      `,
      [hashedKey]
    );

    if (result.rows.length === 0) {
      writeAuditEvent({
        actorUserId: null,
        eventType: "auth.invalid_api_key",
        resourceType: "api_key",
        payload: { route: req.originalUrl, method: req.method },
        ipAddress: req.ip ?? null
      });
      res.status(401).json({ error: "invalid_api_key" });
      return;
    }

    const apiKey = result.rows[0] as Record<string, unknown>;

    if (
      "status" in apiKey &&
      typeof apiKey.status === "string" &&
      apiKey.status.toLowerCase() !== "active"
    ) {
      writeAuditEvent({
        organizationId: apiKey.organization_id as string ?? null,
        actorApiKeyId: apiKey.id as string ?? null,
        actorUserId: null,
        eventType: "auth.inactive_api_key",
        resourceType: "api_key",
        resourceId: apiKey.id as string ?? null,
        payload: { route: req.originalUrl, method: req.method },
        ipAddress: req.ip ?? null
      });
      res.status(403).json({ error: "api_key_inactive" });
      return;
    }

    if ("revoked_at" in apiKey && apiKey.revoked_at) {
      writeAuditEvent({
        organizationId: apiKey.organization_id as string ?? null,
        actorApiKeyId: apiKey.id as string ?? null,
        actorUserId: null,
        eventType: "auth.revoked_api_key",
        resourceType: "api_key",
        resourceId: apiKey.id as string ?? null,
        payload: { route: req.originalUrl, method: req.method },
        ipAddress: req.ip ?? null
      });
      res.status(403).json({ error: "api_key_revoked" });
      return;
    }

    if (apiKey.expires_at !== null && apiKey.expires_at !== undefined && new Date(apiKey.expires_at as string) <= new Date()) {
      writeAuditEvent({
        organizationId: apiKey.organization_id as string ?? null,
        actorApiKeyId: apiKey.id as string ?? null,
        actorUserId: null,
        eventType: "auth.expired_api_key",
        resourceType: "api_key",
        resourceId: apiKey.id as string ?? null,
        payload: { route: req.originalUrl, method: req.method, expires_at: apiKey.expires_at },
        ipAddress: req.ip ?? null
      });
      res.status(403).json({
        error: "api_key_expired",
        detail: "API key has expired. Please rotate or create a new key."
      });
      return;
    }

    pg.query(
      `UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`,
      [apiKey.id]
    ).catch(() => { /* silent */ });

    (req as any).apiKey = apiKey;
    next();
  } catch (err) {
    logger.error({ event: "require_api_key_error", err }, "API key validation failed");
    res.status(500).json({ error: "api_key_validation_failed" });
  }
}
