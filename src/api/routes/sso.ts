/**
 * sso.ts — SAML 2.0 SP-initiated SSO routes.
 *
 * Routes:
 *   GET  /api/sso/check-domain          — Check if email domain has SSO configured
 *   GET  /api/sso/:orgId/login          — Initiate SAML redirect to IdP
 *   POST /api/sso/:orgId/acs            — ACS endpoint (receives SAML assertion)
 *   GET  /api/sso/:orgId/metadata       — SP metadata XML (public, for IdP config)
 *   POST /api/sso/config                — Create/update org SSO config (admin + professional+)
 *   GET  /api/sso/config                — Read org SSO config (admin + professional+)
 *   DELETE /api/sso/config              — Delete org SSO config (admin + professional+)
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import * as samlify from "samlify";
import { pg, pgElevated } from "../infra/postgres.js";
import { signJwt, SESSION_BLOCKED_STATUSES } from "../lib/jwt.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { enforceSeatLimit, enforceSeatLimitForClass, type SeatClass } from "../lib/seatLimit.js";
import { seatModelEnabled } from "../middleware/requireSeat.js";
import { logger } from "../infra/logger.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { getAppBaseUrl } from "../lib/alerting/alertPrimitives.js";
import {
  ssoCodeExchangeEnabled,
  createSsoLoginCode,
  consumeSsoLoginCode,
} from "../lib/ssoLoginCodes.js";

// No-op schema validator — production IdPs produce valid assertions.
// Using @authenio/samlify-node-xmllint would require a native dependency
// (xmllint) unavailable in our container. This is acceptable for SP-initiated
// flows where the assertion is signed and signature-verified by samlify.
samlify.setSchemaValidator({
  validate: (_response: string) => Promise.resolve(""),
});

// App public base URL for SSO redirects (login error pages, auth-sso-callback).
// Reuse the canonical, env-driven APP_BASE_URL (required in prod, set per
// environment) so a staging SSO flow redirects to the *staging* app instead of
// silently bouncing the user into production. APP_URL remains an optional override.
const APP_URL = process.env.APP_URL ?? getAppBaseUrl();

// Engine's own public origin, used to build the SAML ACS URL the IdP posts back
// to. This must be a stable, per-environment value that matches what is
// registered with each IdP, so it is config-driven via ENGINE_URL_BASE (declared
// in render.yaml per service). The fallback is the production engine and MUST be
// overridden on staging via the ENGINE_URL_BASE env var.
const ENGINE_URL_BASE =
  process.env.ENGINE_URL_BASE ?? "https://securelogic-engine.onrender.com";

const router = Router();

const checkDomainLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ? ipKeyGenerator(req.ip) : "unknown",
  message: { error: "rate_limit_exceeded" },
});

// ─── Types ───────────────────────────────────────────────────────────────────

interface SsoConfigRow {
  id: string;
  organization_id: string;
  idp_entity_id: string;
  idp_sso_url: string;
  idp_certificate: string;
  sp_entity_id: string;
  is_enforced: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildSP(config: { sp_entity_id: string; organization_id: string }) {
  return samlify.ServiceProvider({
    entityID: config.sp_entity_id,
    assertionConsumerService: [
      {
        Binding: samlify.Constants.BindingNamespace.Post,
        Location: `${ENGINE_URL_BASE}/api/sso/${config.organization_id}/acs`,
      },
    ],
  });
}

function buildIdP(config: {
  idp_entity_id: string;
  idp_sso_url: string;
  idp_certificate: string;
}) {
  return samlify.IdentityProvider({
    entityID: config.idp_entity_id,
    singleSignOnService: [
      {
        Binding: samlify.Constants.BindingNamespace.Redirect,
        Location: config.idp_sso_url,
      },
    ],
    signingCert: config.idp_certificate,
  });
}

// Express 5 types params as string | string[]; enforce string safely.
function param(req: Request, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function firstAttr(attrs: Record<string, string | string[]>, key: string): string | undefined {
  const val = attrs[key];
  if (val === undefined) return undefined;
  return Array.isArray(val) ? (val[0] ?? undefined) : val;
}

async function loadSsoConfig(orgId: string): Promise<SsoConfigRow | null> {
  const result = await pg.query<SsoConfigRow>(
    `SELECT * FROM org_sso_configs WHERE organization_id = $1 LIMIT 1`,
    [orgId]
  );
  return result.rows[0] ?? null;
}

// ─── GET /api/sso/check-domain ───────────────────────────────────────────────
// No auth. Checks whether the email's domain has SSO configured.

router.get("/sso/check-domain", checkDomainLimiter, async (req: Request, res: Response) => {
  try {
    const emailParam = typeof req.query.email === "string" ? req.query.email.trim() : "";

    if (!emailParam || !emailParam.includes("@")) {
      res.status(200).json({ hasSso: false });
      return;
    }

    const domain = emailParam.split("@")[1]?.toLowerCase();
    if (!domain) {
      res.status(200).json({ hasSso: false });
      return;
    }

    const result = await pg.query<{
      organization_id: string;
      is_enforced: boolean;
      sp_entity_id: string;
      idp_entity_id: string;
      idp_sso_url: string;
      idp_certificate: string;
    }>(
      `SELECT osc.organization_id, osc.is_enforced, osc.sp_entity_id,
              osc.idp_entity_id, osc.idp_sso_url, osc.idp_certificate
       FROM org_sso_configs osc
       JOIN organizations o ON o.id = osc.organization_id
       WHERE o.id IN (
         SELECT organization_id FROM users
         WHERE email ILIKE $1
         LIMIT 1
       )
       LIMIT 1`,
      [`%@${domain}`]
    );

    if (result.rows.length === 0) {
      res.status(200).json({ hasSso: false });
      return;
    }

    const row = result.rows[0]!;
    res.status(200).json({
      hasSso: true,
      isEnforced: row.is_enforced,
      organizationId: row.organization_id,
    });
  } catch (err) {
    logger.error({ event: "sso_check_domain_failed", err }, "GET /api/sso/check-domain failed");
    res.status(200).json({ hasSso: false });
  }
});

// ─── GET /api/sso/:orgId/login ───────────────────────────────────────────────
// No auth. Initiates SAML redirect to the IdP.

router.get("/sso/:orgId/login", async (req: Request, res: Response) => {
  try {
    const orgId = param(req, "orgId");
    if (!orgId) { res.status(400).json({ error: "missing_org_id" }); return; }

    const config = await loadSsoConfig(orgId);
    if (!config) { res.status(404).json({ error: "sso_not_configured" }); return; }

    const sp  = buildSP(config);
    const idp = buildIdP(config);

    const { context } = sp.createLoginRequest(idp, "redirect");
    res.redirect(context as string);
  } catch (err) {
    logger.error({ event: "sso_login_initiate_failed", err }, "GET /api/sso/:orgId/login failed");
    res.status(500).json({ error: "sso_initiation_failed" });
  }
});

// ─── POST /api/sso/:orgId/acs ────────────────────────────────────────────────
// No auth. Receives SAML assertion from IdP (ACS endpoint).
// Content-Type is application/x-www-form-urlencoded from IdP — urlencoded
// parser is already mounted globally in server.ts.

router.post("/sso/:orgId/acs", async (req: Request, res: Response) => {
  const orgId = param(req, "orgId");
  if (!orgId) { res.status(400).json({ error: "missing_org_id" }); return; }

  try {
    const config = await loadSsoConfig(orgId);
    if (!config) { res.status(404).json({ error: "sso_not_configured" }); return; }

    const sp  = buildSP(config);
    const idp = buildIdP(config);

    // samlify expects Express request directly
    const parsed = await sp.parseLoginResponse(idp, "post", req);
    const extract = parsed.extract as {
      nameID?: string;
      attributes?: Record<string, string | string[]>;
    };

    const email = (extract.nameID ?? "").trim().toLowerCase();
    if (!email) {
      res.status(400).json({ error: "no_email_in_assertion" });
      return;
    }

    const attrs = (extract.attributes ?? {}) as Record<string, string | string[]>;
    const displayName = (
      firstAttr(attrs, "displayName") ??
      firstAttr(attrs, "name") ??
      firstAttr(attrs, "cn") ??
      email
    ).trim();

    // Find or JIT-create the user
    const existing = await pg.query<{
      id: string;
      name: string;
      email: string;
      role: string;
      organization_id: string;
      status: string;
    }>(
      `SELECT id, name, email, role, organization_id, status
       FROM users
       WHERE email = $1 AND organization_id = $2
       LIMIT 1`,
      [email, orgId]
    );

    // GDPR-lifecycle status gate — same rule as the password login path
    // (customerAuth.ts): a pending_deletion/deleted account must not mint a
    // session through ANY door, and SSO must not be the documented bypass.
    const existingStatus = existing.rows[0]?.status ?? null;
    if (existingStatus === "pending_deletion" || existingStatus === "deleted") {
      writeAuditEvent({
        organizationId: orgId,
        actorUserId: null,
        eventType: "auth.login_blocked",
        resourceType: "user",
        resourceId: existing.rows[0]!.id,
        payload: { reason: existingStatus, provider: "saml", email: email.slice(0, 4) + "***" },
        ipAddress: req.ip ?? null,
      });
      res.redirect(`${APP_URL}/login?error=account_pending_deletion`);
      return;
    }

    let userId: string;
    let userRole: string;
    let wasNewUser = false;

    if (existing.rows.length > 0) {
      const u = existing.rows[0]!;

      // A removed member ('inactive') or deletion-lifecycle user must not
      // get a fresh session via the IdP: removal is an explicit admin
      // action and SSO re-auth must not silently undo it. The row still
      // exists, so without this gate the existing-user branch would
      // happily reissue a JWT. Admins restore access by re-inviting.
      if (SESSION_BLOCKED_STATUSES.has(u.status)) {
        writeAuditEvent({
          organizationId: orgId,
          actorUserId: null,
          eventType: "auth.login_blocked",
          resourceType: "user",
          resourceId: u.id,
          payload: { reason: u.status, method: "sso" },
          ipAddress: req.ip ?? null
        });
        res.redirect(`${APP_URL}/login?error=account_inactive`);
        return;
      }

      userId   = u.id;
      userRole = u.role ?? "analyst";
    } else {
      // Seat-cap enforcement BEFORE JIT provisioning (#9a). Without this, SSO
      // JIT silently bypassed the `max_members` cap that the invite-acceptance
      // path enforces — a cap bypassable on one user-creation path is not a
      // cap. An org at its seat cap cannot provision a new SSO user; the
      // operator raises the cap via PATCH /admin/organizations/:id (the
      // sales-led seat-allocation path for Platform / Enterprise). Existing
      // members are unaffected — only NEW JIT provisioning is gated.
      // Resolve the seat/role for the new user. Under the seat model, an org
      // chooses the JIT default (a read-only Viewer seat unless configured
      // otherwise), and the per-CLASS cap is enforced. With the flag off,
      // behaviour is exactly as before: analyst role, whole-org (Full) cap, and
      // seat_type left to the column default.
      const seatModelOn = seatModelEnabled();
      let jitSeatType = "full";
      let jitRole = "analyst";
      if (seatModelOn) {
        const defaults = await pg.query<{ default_sso_seat_type: string; default_sso_role: string }>(
          `SELECT default_sso_seat_type, default_sso_role FROM organizations WHERE id = $1`,
          [orgId]
        );
        jitSeatType = defaults.rows[0]?.default_sso_seat_type ?? "viewer";
        jitRole = defaults.rows[0]?.default_sso_role ?? "viewer";
      }

      const seat = seatModelOn
        ? await enforceSeatLimitForClass(orgId, jitSeatType as SeatClass)
        : await enforceSeatLimit(orgId);
      if (seat.exceeded) {
        logger.warn(
          { event: "sso_seat_limit_reached", orgId, email, used: seat.used, cap: seat.cap, seatType: jitSeatType },
          "SSO JIT provisioning blocked — seat limit reached"
        );
        writeAuditEvent({
          organizationId: orgId,
          eventType: "auth.sso_seat_limit_reached",
          resourceType: "organization",
          resourceId: orgId,
          payload: { email, used: seat.used, cap: seat.cap },
        });
        res.redirect(`${APP_URL}/login?error=seat_limit_reached`);
        return;
      }

      // JIT provisioning — the seat/role resolved above (a read-only Viewer
      // seat by default under the seat model; analyst/Full under legacy).
      //
      // NOTE: SSO JIT does not record legal consent at user creation. Per the
      // operator's design, SSO users are required to consent at first-login via
      // an interstitial dialog. The requireConsent middleware will return 403
      // consent_required for these users until they accept terms via
      // POST /api/auth/accept-terms (handled by the customer app UI in a
      // separate PR).
      const inserted = await pg.query<{ id: string }>(
        `INSERT INTO users (organization_id, email, name, password_hash, email_verified, role, seat_type, sso_provider)
         VALUES ($1, $2, $3, '', true, $4, $5, 'saml')
         RETURNING id`,
        [orgId, email, displayName, jitRole, jitSeatType]
      );
      userId     = inserted.rows[0]!.id;
      userRole   = jitRole;
      wasNewUser = true;
    }

    writeAuditEvent({
      organizationId: orgId,
      actorUserId: userId,
      eventType: "auth.sso_login",
      resourceType: "user",
      resourceId: userId,
      payload: { email, provider: "saml", jit: wasNewUser },
    });

    if (ssoCodeExchangeEnabled()) {
      // Hardened handoff: the URL carries only an opaque single-use 60s code;
      // the app exchanges it server-side (POST /api/sso/exchange) for the
      // session JWT + profile. No token, no PII in browser history or logs.
      const code = await createSsoLoginCode({
        organizationId: orgId,
        userId,
        email,
        displayName,
      });
      res.redirect(`${APP_URL}/api/auth-sso-callback?code=${encodeURIComponent(code)}`);
      return;
    }

    // Legacy handoff (flag off): session JWT + profile in the URL. Kept
    // byte-identical until the operator flips the exchange flag, so either
    // service can deploy first.
    const token = signJwt(userId, orgId, userRole);
    const callbackUrl =
      `${APP_URL}/api/auth-sso-callback` +
      `?token=${encodeURIComponent(token)}` +
      `&userId=${encodeURIComponent(userId)}` +
      `&email=${encodeURIComponent(email)}` +
      `&name=${encodeURIComponent(displayName)}` +
      `&orgId=${encodeURIComponent(orgId)}`;

    res.redirect(callbackUrl);
  } catch (err) {
    logger.error({ event: "sso_acs_failed", orgId, err }, "POST /api/sso/:orgId/acs failed");
    res.redirect(`${APP_URL}/login?error=sso_failed`);
  }
});

// ─── POST /api/sso/exchange ──────────────────────────────────────────────────
// No auth (this IS the login path). Body: { code }. Consumes a single-use ACS
// login code and returns the session JWT + the profile fields the app
// callback previously read from the URL. Unknown / expired / replayed codes
// are indistinguishable (uniform 401) — a leaked URL reveals nothing.
// Dark: 404 while the exchange flag is off.

// Sized for AGGREGATE platform login traffic, not per-user: the only
// legitimate caller is the app server (server-side fetch), so every tenant's
// SSO logins share ONE ip bucket — a per-user-sized cap would let one
// tenant's morning peak 429 every other tenant's login (security review B1).
// The limiter is a bot/abuse ceiling only; brute force is not its job
// (2^256 code space, hashed at rest). Limit hits are loud in the logs.
const exchangeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ? ipKeyGenerator(req.ip) : "unknown",
  handler: (req, res) => {
    logger.warn(
      { event: "sso_exchange_rate_limited", ip: req.ip ?? null },
      "SSO exchange rate limit hit — aggregate login traffic exceeded the abuse ceiling"
    );
    res.status(429).json({ error: "rate_limit_exceeded" });
  },
});

// Flag gate FIRST, limiter second (security review #710 finding 1): with the
// order reversed, a flag-off probe still received RateLimit-* headers and a
// 404 body missing the app-wide handler's `path` field — fingerprinting the
// feature as deployed-but-off. Flag-off now mirrors the default 404 handler
// byte-for-byte and touches no limiter state.
const exchangeFlagGate = (req: Request, res: Response, next: NextFunction): void => {
  if (!ssoCodeExchangeEnabled()) {
    res.status(404).json({ error: "not_found", path: req.originalUrl });
    return;
  }
  next();
};

router.post("/sso/exchange", exchangeFlagGate, exchangeLimiter, async (req: Request, res: Response) => {
  try {
    const code = (req.body ?? {})["code"];
    if (typeof code !== "string" || code.length === 0) {
      res.status(400).json({ error: "code_required" });
      return;
    }

    const payload = await consumeSsoLoginCode(code);
    if (!payload) {
      // Uniform toward the caller; loud toward operations (a spike here is a
      // guessing attempt or an integration fault, either way worth seeing).
      logger.warn({ event: "sso_exchange_invalid_code", ip: req.ip ?? null }, "SSO exchange: invalid code");
      res.status(401).json({ error: "invalid_code" });
      return;
    }

    // Role AND status are read at exchange time, not mint time — a role
    // change in the 60-second window is honored, the code row never carries
    // authority, and the full session-blocked gate (SESSION_BLOCKED_STATUSES,
    // #732) holds at this mint site too: a member removed ('inactive') or in
    // the deletion lifecycle between ACS and exchange must not mint a JWT
    // here when every other login door refuses them. Uniform 401 regardless.
    const userResult = await pgElevated.query<{ role: string; status: string | null }>(
      `SELECT role, status FROM users WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [payload.userId, payload.organizationId]
    );
    const user = userResult.rows[0];
    if (!user || (user.status !== null && SESSION_BLOCKED_STATUSES.has(user.status))) {
      if (user) {
        writeAuditEvent({
          organizationId: payload.organizationId,
          actorUserId: null,
          eventType: "auth.login_blocked",
          resourceType: "user",
          resourceId: payload.userId,
          payload: { reason: user.status, provider: "saml_exchange" },
          ipAddress: req.ip ?? null,
        });
      }
      res.status(401).json({ error: "invalid_code" });
      return;
    }

    const token = signJwt(payload.userId, payload.organizationId, user.role);

    // The exchange is where the session JWT is actually minted now — audit it
    // (security review N2): an intercepted-and-raced code leaves a winning
    // exchange here and a losing invalid_code warn above, both visible.
    writeAuditEvent({
      organizationId: payload.organizationId,
      actorUserId: payload.userId,
      eventType: "auth.sso_login_exchanged",
      resourceType: "user",
      resourceId: payload.userId,
      payload: { provider: "saml" },
      ipAddress: req.ip ?? null,
    });
    res.status(200).json({
      token,
      userId: payload.userId,
      email: payload.email,
      name: payload.displayName,
      orgId: payload.organizationId,
    });
  } catch (err) {
    logger.error({ event: "sso_exchange_failed", err }, "POST /api/sso/exchange failed");
    res.status(500).json({ error: "sso_exchange_failed" });
  }
});

// ─── GET /api/sso/:orgId/metadata ────────────────────────────────────────────
// No auth. Returns SP metadata XML for IdP configuration.

router.get("/sso/:orgId/metadata", async (req: Request, res: Response) => {
  try {
    const orgId = param(req, "orgId");
    if (!orgId) { res.status(400).json({ error: "missing_org_id" }); return; }

    const config = await loadSsoConfig(orgId);
    if (!config) { res.status(404).json({ error: "sso_not_configured" }); return; }

    const sp = buildSP(config);
    const metadata = sp.getMetadata();
    res.setHeader("Content-Type", "application/xml");
    res.status(200).send(metadata);
  } catch (err) {
    logger.error({ event: "sso_metadata_failed", err }, "GET /api/sso/:orgId/metadata failed");
    res.status(500).json({ error: "metadata_generation_failed" });
  }
});

// ─── Middleware chain for SSO config management ───────────────────────────────
// Requires API key (JWT bridge) + org context + professional+ entitlement + JWT auth + admin role.

const ssoConfigMiddleware = [
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("professional"),
  requireAuth,
  requireRole("admin"),
];

// ─── POST /api/sso/config ─────────────────────────────────────────────────────

router.post(
  "/sso/config",
  ...ssoConfigMiddleware,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.jwtPayload?.org;
      if (!orgId) { res.status(401).json({ error: "unauthorized" }); return; }

      const body = req.body as {
        idp_entity_id?: unknown;
        idp_sso_url?: unknown;
        idp_certificate?: unknown;
        sp_entity_id?: unknown;
        is_enforced?: unknown;
      };

      const idp_entity_id   = typeof body.idp_entity_id   === "string" ? body.idp_entity_id.trim()   : "";
      const idp_sso_url     = typeof body.idp_sso_url     === "string" ? body.idp_sso_url.trim()     : "";
      const idp_certificate = typeof body.idp_certificate === "string" ? body.idp_certificate.trim() : "";
      const sp_entity_id    = typeof body.sp_entity_id    === "string" ? body.sp_entity_id.trim()    : "";
      const is_enforced     = body.is_enforced === true || body.is_enforced === "true";

      if (!idp_entity_id || !idp_sso_url || !idp_certificate || !sp_entity_id) {
        res.status(400).json({ error: "missing_required_fields" });
        return;
      }

      try {
        const parsed = new URL(idp_sso_url);
        if (parsed.protocol !== "https:") {
          res.status(400).json({ error: "idp_sso_url_must_be_https" });
          return;
        }
      } catch {
        res.status(400).json({ error: "idp_sso_url_invalid" });
        return;
      }

      if (idp_certificate.length > 10000) {
        res.status(400).json({ error: "idp_certificate_too_long" });
        return;
      }

      const result = await pg.query<SsoConfigRow>(
        `INSERT INTO org_sso_configs
           (organization_id, idp_entity_id, idp_sso_url, idp_certificate, sp_entity_id, is_enforced)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (organization_id) DO UPDATE SET
           idp_entity_id   = EXCLUDED.idp_entity_id,
           idp_sso_url     = EXCLUDED.idp_sso_url,
           idp_certificate = EXCLUDED.idp_certificate,
           sp_entity_id    = EXCLUDED.sp_entity_id,
           is_enforced     = EXCLUDED.is_enforced,
           updated_at      = NOW()
         RETURNING *`,
        [orgId, idp_entity_id, idp_sso_url, idp_certificate, sp_entity_id, is_enforced]
      );

      writeAuditEvent({
        organizationId: orgId,
        actorUserId: req.jwtPayload?.sub ?? null,
        eventType: "sso.config_saved",
        resourceType: "org_sso_config",
        resourceId: result.rows[0]!.id,
        payload: { sp_entity_id, is_enforced },
      });

      res.status(200).json({ config: result.rows[0] });
    } catch (err) {
      logger.error({ event: "sso_config_save_failed", err }, "POST /api/sso/config failed");
      res.status(500).json({ error: "internal_error" });
    }
  }
);

// ─── GET /api/sso/config ──────────────────────────────────────────────────────

router.get(
  "/sso/config",
  ...ssoConfigMiddleware,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.jwtPayload?.org;
      if (!orgId) { res.status(401).json({ error: "unauthorized" }); return; }

      const config = await loadSsoConfig(orgId);
      if (!config) {
        res.status(404).json({ config: null });
        return;
      }

      // Truncate certificate for display
      const safeConfig = {
        ...config,
        idp_certificate:
          config.idp_certificate.length > 40
            ? `${config.idp_certificate.slice(0, 40)}...`
            : config.idp_certificate,
      };

      res.status(200).json({ config: safeConfig });
    } catch (err) {
      logger.error({ event: "sso_config_get_failed", err }, "GET /api/sso/config failed");
      res.status(500).json({ error: "internal_error" });
    }
  }
);

// ─── DELETE /api/sso/config ───────────────────────────────────────────────────

router.delete(
  "/sso/config",
  ...ssoConfigMiddleware,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.jwtPayload?.org;
      if (!orgId) { res.status(401).json({ error: "unauthorized" }); return; }

      await pg.query(
        `DELETE FROM org_sso_configs WHERE organization_id = $1`,
        [orgId]
      );

      writeAuditEvent({
        organizationId: orgId,
        actorUserId: req.jwtPayload?.sub ?? null,
        eventType: "sso.config_deleted",
        resourceType: "org_sso_config",
        payload: {},
      });

      res.status(200).json({ ok: true });
    } catch (err) {
      logger.error({ event: "sso_config_delete_failed", err }, "DELETE /api/sso/config failed");
      res.status(500).json({ error: "internal_error" });
    }
  }
);

export default router;
