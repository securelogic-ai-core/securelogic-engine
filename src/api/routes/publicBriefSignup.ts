import { Router } from "express";
import rateLimit from "express-rate-limit";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { validateBriefSignup } from "../lib/briefSignupValidation.js";

const router = Router();

/* =========================================================
   RATE LIMIT
   5 requests per IP per minute — tight enough to stop abuse
   from a Webflow form, generous enough for legitimate signups.
   ========================================================= */

const signupLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limit_exceeded" }
});

/* =========================================================
   HELPERS
   ========================================================= */

const DEFAULT_BRIEF_ORG_ID = "51ee8a29-018e-4f30-9aba-9e0e2ec5dfbb";

function resolveBriefOrgId(): string {
  return process.env.BRIEF_ORG_ID?.trim() || DEFAULT_BRIEF_ORG_ID;
}

/* =========================================================
   POST /api/public/brief-signup

   Public endpoint — no API key required.
   Called by the Webflow marketing site to capture email
   signups for the Intelligence Brief mailing list.

   Body: { email: string, name?: string }

   Inserts into intelligence_brief_subscribers under the
   org designated by BRIEF_ORG_ID (defaults to the canonical
   SecureLogic brief org). Duplicate emails within that org
   return 409 already_subscribed rather than throwing.

   Rate limited: 5 requests per IP per minute.
   ========================================================= */

router.post("/public/brief-signup", signupLimiter, async (req, res) => {
  try {
    const validation = validateBriefSignup(req.body);

    if ("error" in validation) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const { email, name } = validation.input;
    const organizationId = resolveBriefOrgId();

    try {
      await pg.query(
        `
        INSERT INTO intelligence_brief_subscribers
          (organization_id, email, name, active)
        VALUES ($1, $2, $3, TRUE)
        `,
        [organizationId, email, name]
      );
    } catch (err: any) {
      // Postgres unique violation on (organization_id, email)
      if (err?.code === "23505") {
        res.status(409).json({ error: "already_subscribed" });
        return;
      }
      throw err;
    }

    logger.info(
      { event: "brief_signup_complete", organizationId },
      "Public brief signup recorded"
    );

    res.status(201).json({ ok: true });
  } catch (err) {
    logger.error(
      { event: "brief_signup_failed", err },
      "POST /api/public/brief-signup failed"
    );
    // Never expose internal error details to unauthenticated callers
    res.status(500).json({ error: "signup_failed" });
  }
});

export default router;
