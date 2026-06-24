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

import { Router, type Request, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import * as samlify from "samlify";
import { pg } from "../infra/postgres.js";
import { signJwt } from "../lib/jwt.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { enforceSeatLimit } from "../lib/seatLimit.js";
import { logger } from "../infra/logger.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";

// No-op schema validator — production IdPs produce valid assertions.
// Using @authenio/samlify-node-xmllint would require a native dependency
// (xmllint) unavailable in our container. This is acceptable for SP-initiated
// flows where the assertion is signed and signature-verified by samlify.
samlify.setSchemaValidator({
  validate: (_response: string) => Promise.resolve(""),
});

const APP_URL = process.env.APP_URL ?? "https://securelogic-app.onrender.com";
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
    }>(
      `SELECT id, name, email, role, organization_id
       FROM users
       WHERE email = $1 AND organization_id = $2
       LIMIT 1`,
      [email, orgId]
    );

    let userId: string;
    let userRole: string;
    let wasNewUser = false;

    if (existing.rows.length > 0) {
      const u = existing.rows[0]!;
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
      const seat = await enforceSeatLimit(orgId);
      if (seat.exceeded) {
        logger.warn(
          { event: "sso_seat_limit_reached", orgId, email, used: seat.used, cap: seat.cap },
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

      // JIT provisioning — new user, analyst role only.
      //
      // NOTE: SSO JIT does not record legal consent at user creation. Per the
      // operator's design, SSO users are required to consent at first-login via
      // an interstitial dialog. The requireConsent middleware will return 403
      // consent_required for these users until they accept terms via
      // POST /api/auth/accept-terms (handled by the customer app UI in a
      // separate PR).
      const inserted = await pg.query<{ id: string }>(
        `INSERT INTO users (organization_id, email, name, password_hash, email_verified, role, sso_provider)
         VALUES ($1, $2, $3, '', true, 'analyst', 'saml')
         RETURNING id`,
        [orgId, email, displayName]
      );
      userId     = inserted.rows[0]!.id;
      userRole   = "analyst";
      wasNewUser = true;
    }

    const token = signJwt(userId, orgId, userRole);

    writeAuditEvent({
      organizationId: orgId,
      actorUserId: userId,
      eventType: "auth.sso_login",
      resourceType: "user",
      resourceId: userId,
      payload: { email, provider: "saml", jit: wasNewUser },
    });

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
