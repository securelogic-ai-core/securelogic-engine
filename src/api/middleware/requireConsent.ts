/**
 * requireConsent.ts — Gate authenticated human sessions on current legal consent.
 *
 * Returns 403 consent_required if the authenticated user has not consented to
 * the current versions of all policy documents. The customer app intercepts
 * this status and shows the first-login / re-consent interstitial, then calls
 * POST /api/auth/accept-terms to record consent.
 *
 * Scope (deliberate):
 *   - Only gates JWT-authenticated (human portal) requests. The user identity
 *     is extracted from the same Authorization/X-Api-Key header that
 *     requireApiKey reads. Raw machine API keys (no "." → not a JWT) carry no
 *     user identity and are passed straight through — programmatic integrations
 *     must not be blocked on a human consent flow.
 *   - This middleware must be mounted AFTER the /api/auth/* routers so login and
 *     accept-terms keep working. It self-extracts the JWT rather than relying on
 *     req.userId/req.jwtPayload because the per-route requireApiKey guard runs
 *     later in the chain and has not populated req.userId at this mount point.
 *
 * Fails open: if the consent lookup throws (e.g. DB unreachable) it logs and
 * calls next() — a consent-check outage must not take down authenticated
 * routes. Operators are alerted via existing log/Sentry infrastructure.
 */

import type { Request, Response, NextFunction } from "express";
import { pgElevated } from "../infra/postgres.js";
import { verifyJwt } from "../lib/jwt.js";
import { getMissingConsents } from "../lib/legalConsent.js";
import { logger } from "../infra/logger.js";

export async function requireConsent(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Mirror requireApiKey's credential extraction so we observe the same token.
  const presentedKey =
    req.header("X-Api-Key") ||
    req.header("x-api-key") ||
    req.header("Authorization")?.replace(/^Bearer\s+/i, "").trim();

  // No credential, or a raw machine API key (no dots) → not a human session.
  // Consent is a human-portal concern; let these through untouched.
  if (!presentedKey || !presentedKey.includes(".")) {
    next();
    return;
  }

  const payload = verifyJwt(presentedKey);
  if (!payload?.sub) {
    // Invalid/expired JWT — let the downstream auth guard reject it (401),
    // don't mask it with a consent 403.
    next();
    return;
  }

  const userId = payload.sub;

  try {
    const missing = await getMissingConsents(pgElevated, userId);
    if (missing.length > 0) {
      logger.info({
        event: "consent_required_redirect",
        userId,
        missing,
      });
      res.status(403).json({
        error: "consent_required",
        detail: "You must accept the current versions of the legal policy documents to continue.",
        missingDocuments: missing,
      });
      return;
    }
    next();
  } catch (err) {
    logger.error({ event: "require_consent_check_failed", err: String(err) });
    // Fail open with a warning — don't break authenticated routes if the consent
    // table is unreachable. Operators will see the alert.
    next();
  }
}
