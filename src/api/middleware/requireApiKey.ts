import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "../lib/auditLog.js";
// Tier-2 auth-anomaly fix: audit events on this surface feed the
// credential-stuffing / key-probing detectors, which GROUP BY ip_address.
// `req.ip` here is a ROTATING Cloudflare edge node (see infra/clientIp.ts),
// which fragmented one client across many identities and kept the anomaly
// ledger empty for all time. Record the resolved caller instead — same
// trusted mechanism (CF-Connecting-IP) the enforcing admin controls key on.
import { resolveClientIp } from "../infra/clientIp.js";
import { verifyJwtDetailed, SESSION_BLOCKED_STATUSES } from "../lib/jwt.js";

declare global {
  namespace Express {
    interface Request {
      /** UUID of the authenticated user (JWT path only) */
      userId?: string;
      /** Role of the authenticated user (JWT path only) */
      userRole?: string;
      /**
       * Seat class of the authenticated user (JWT path only): full |
       * contributor | viewer. Absent on API-key auth, which is admin-level and
       * treated as a full seat by the seat resolver.
       */
      userSeatType?: string;
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
        ipAddress: resolveClientIp(req).ip
      });
      res.status(401).json({ error: "api_key_required" });
      return;
    }

    // JWT bridge: if the token contains dots it is a JWT, not an API key.
    // Verify the JWT, then load the org's primary API key record so all
    // downstream middleware (attachOrganizationContext, requireEntitlement, …)
    // works without modification.
    if (presentedKey.includes(".")) {
      const verified = verifyJwtDetailed(presentedKey);

      if (!verified.ok) {
        // SEC-TOKEN-1: a validly-signed session minted before the purpose
        // claim existed → `session_invalidated`, which the app tier already
        // maps to a forced re-login. A token WE signed for another purpose
        // (MFA challenge, …) presented as a session is never legitimate and
        // gets its own audit event; everything else is the plain invalid_jwt.
        if (verified.reason === "legacy_untyped") {
          writeAuditEvent({
            actorUserId: null,
            eventType: "auth.session_legacy_untyped",
            resourceType: "user",
            payload: { route: req.originalUrl, method: req.method },
            ipAddress: resolveClientIp(req).ip
          });
          res.status(401).json({
            error: "session_invalidated",
            detail: "This session predates a security update. Please sign in again."
          });
          return;
        }
        writeAuditEvent({
          actorUserId: null,
          eventType: verified.reason === "wrong_type" ? "auth.token_type_rejected" : "auth.invalid_jwt",
          resourceType: "user",
          payload: { route: req.originalUrl, method: req.method, reason: verified.reason },
          ipAddress: resolveClientIp(req).ip
        });
        res.status(401).json({ error: "invalid_token" });
        return;
      }
      const payload = verified.payload;

      // SEC-JWT-EPOCH: mirrors requireAuth. A session token MUST carry the
      // epoch it was minted under; absence is invalid session state, not a
      // compatibility fallback. Checked BEFORE the users lookup so it stays a
      // pure function of the token and cannot be conflated with — or rescued
      // by — the fail-closed DB handler below.
      if (typeof payload.se !== "number") {
        writeAuditEvent({
          actorUserId: payload.sub,
          eventType: "auth.session_epoch_missing",
          resourceType: "user",
          resourceId: payload.sub,
          payload: { route: req.originalUrl, method: req.method },
          ipAddress: resolveClientIp(req).ip
        });
        res.status(401).json({
          error: "session_epoch_missing",
          detail: "This session predates a security update. Please sign in again."
        });
        return;
      }

      // Live-session enforcement against the users row: status, role, and
      // password recency. Fail CLOSED on DB error: leaked pre-rotation
      // tokens must not replay during a Postgres degradation window. The
      // api_keys lookup below has no fallback either, so failing JWT-bridge
      // auth here doesn't widen the outage envelope.
      let effectiveRole: string;
      // Seat class (enterprise seat program). Read live from the users row, like
      // the role, so a seat change takes effect immediately. Legacy/null rows
      // resolve to 'full' — the pre-seat-model default.
      let effectiveSeatType = "full";
      try {
        const pwResult = await pg.query<{
          password_changed_at: Date | null;
          status: string;
          role: string;
          seat_type: string | null;
          session_epoch: number;
        }>(
          `SELECT password_changed_at, status, role, seat_type, session_epoch FROM users WHERE id = $1 LIMIT 1`,
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
            ipAddress: resolveClientIp(req).ip
          });
          res.status(401).json({
            error: "account_inactive",
            detail: "This account no longer has access. Contact your administrator."
          });
          return;
        }

        // Deterministic invalidation — integer equality, no clock. Subsumes the
        // legacy timestamp check below and closes its sub-second bypass.
        if (payload.se !== userRow.session_epoch) {
          res.status(401).json({ error: "session_invalidated", detail: "This session is no longer valid. Please sign in again." });
          return;
        }

        // Legacy timestamp check, retained unchanged (belt and braces).
        const changedAt = userRow.password_changed_at;
        if (changedAt !== null && payload.iat < Math.floor(new Date(changedAt).getTime() / 1000)) {
          res.status(401).json({ error: "session_invalidated", detail: "Password was changed. Please sign in again." });
          return;
        }

        // Role changes take effect immediately: authz below uses the
        // current DB role, not the claim baked into the token at issue.
        effectiveRole = userRow.role;
        effectiveSeatType = userRow.seat_type ?? "full";
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
          ipAddress: resolveClientIp(req).ip
        });
        res.status(503).json({
          error: "auth_unavailable",
          detail: "Authentication service temporarily unavailable. Please retry."
        });
        return;
      }

      // Viewer accounts may not perform mutations. A Viewer ROLE is read-only
      // always; a Viewer SEAT is read-only too when the seat model is on,
      // regardless of the paired role — realizing resolveScope's clamp so an
      // incompatible (viewer seat, non-viewer role) pair cannot write.
      const seatIsReadOnly =
        process.env["SECURELOGIC_SEAT_MODEL_ENABLED"] === "true" && effectiveSeatType === "viewer";
      if ((effectiveRole === "viewer" || seatIsReadOnly) && MUTATION_METHODS.has(req.method.toUpperCase())) {
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
      req.userSeatType        = effectiveSeatType;
      req.autoUserId          = payload.sub;
      next();
      return;
    }

    const hashedKey = crypto.createHash("sha256").update(presentedKey).digest("hex");

    const result = await pg.query(
      `
      SELECT id, organization_id, label, key_hash, status,
             last_used_at, created_at, revoked_at, expires_at,
             created_by_user_id, bound_seat_type, bound_role
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
        ipAddress: resolveClientIp(req).ip
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
        ipAddress: resolveClientIp(req).ip
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
        ipAddress: resolveClientIp(req).ip
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
        ipAddress: resolveClientIp(req).ip
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

    // Seat/role binding (activation blocker 2). When the seat model is ON, a
    // key bound to a seat/role acts AS that identity — closing the historical
    // "API key = admin-level" bypass. A legacy key (bound_seat_type NULL) keeps
    // admin-level behaviour during the compatibility window until rotated. When
    // the model is OFF, nothing is attached and every key stays admin-level,
    // exactly as before.
    if (process.env["SECURELOGIC_SEAT_MODEL_ENABLED"] === "true" && typeof apiKey.bound_seat_type === "string" && apiKey.bound_seat_type) {
      req.userSeatType = apiKey.bound_seat_type as string;
      req.userRole = (apiKey.bound_role as string | null) ?? "viewer";

      // A key bound to a Viewer seat/role is read-only — mirror the JWT
      // chokepoint so a bound viewer key cannot mutate either.
      if (
        (req.userSeatType === "viewer" || req.userRole === "viewer") &&
        MUTATION_METHODS.has(req.method.toUpperCase())
      ) {
        res.status(403).json({
          error: "read_only_access",
          detail: "Viewer accounts cannot make changes.",
        });
        return;
      }
    }

    next();
  } catch (err) {
    logger.error({ event: "require_api_key_error", err }, "API key validation failed");
    res.status(500).json({ error: "api_key_validation_failed" });
  }
}
