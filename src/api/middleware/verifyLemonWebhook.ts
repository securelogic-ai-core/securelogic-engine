import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import { logger } from "../infra/logger.js";

/**
 * Lemon webhook signature verification (Enterprise)
 *
 * RULES:
 * - FAIL CLOSED if misconfigured or signature invalid
 * - Verify using RAW body bytes (req.rawBody)
 * - Never log raw body, signatures, or secrets
 * - Constant-time compare
 * - Strict header extraction (single source)
 *
 * NOTE:
 * server.ts must mount this AFTER:
 *   bodyParser.raw(...) + (req as any).rawBody = req.body
 */

const MAX_SIG_LENGTH = 512;

function getSecret(): string | null {
  const raw = process.env.LEMON_WEBHOOK_SECRET;
  if (!raw) return null;

  const s = raw.trim();
  return s.length > 0 ? s : null;
}

function safeHeader(req: Request, name: string): string | null {
  const v = req.get(name);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

/**
 * Common Lemon header is typically: X-Signature
 * Some setups use: X-Webhook-Signature
 * We accept ONE of them (not both).
 */
function extractSignature(req: Request): {
  sig: string | null;
  sourcesSeen: number;
} {
  const xSig = safeHeader(req, "x-signature");
  const xWebhookSig = safeHeader(req, "x-webhook-signature");

  const present = [xSig, xWebhookSig].filter((v) => Boolean(v));
  if (present.length === 0) return { sig: null, sourcesSeen: 0 };
  if (present.length > 1) return { sig: null, sourcesSeen: present.length };

  return { sig: present[0] ?? null, sourcesSeen: 1 };
}

function computeExpectedSignature(rawBody: Buffer, secret: string): Buffer {
  return crypto.createHmac("sha256", secret).update(rawBody).digest();
}

function decodeProvidedSignature(sig: string): Buffer | null {
  const s = sig.trim();

  // Hex signature
  if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0) {
    try {
      return Buffer.from(s, "hex");
    } catch {
      return null;
    }
  }

  // Base64 signature
  if (/^[A-Za-z0-9+/=]+$/.test(s)) {
    try {
      return Buffer.from(s, "base64");
    } catch {
      return null;
    }
  }

  return null;
}

export function verifyLemonWebhook(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    const secret = getSecret();

    if (!secret) {
      logger.error(
        { route: "/webhooks/lemon", hasSecret: false },
        "verifyLemonWebhook: missing LEMON_WEBHOOK_SECRET"
      );
      res.status(500).json({ error: "server_misconfigured" });
      return;
    }

    const { sig, sourcesSeen } = extractSignature(req);

    if (sourcesSeen > 1) {
      logger.warn(
        { route: "/webhooks/lemon" },
        "verifyLemonWebhook: multiple signature headers (rejected)"
      );
      res.status(401).json({ error: "webhook_unauthorized" });
      return;
    }

    if (!sig) {
      logger.warn(
        { route: "/webhooks/lemon" },
        "verifyLemonWebhook: missing signature"
      );
      res.status(401).json({ error: "webhook_unauthorized" });
      return;
    }

    if (sig.length > MAX_SIG_LENGTH) {
      logger.warn(
        { route: "/webhooks/lemon", sigLength: sig.length },
        "verifyLemonWebhook: signature too long"
      );
      res.status(401).json({ error: "webhook_unauthorized" });
      return;
    }

    const raw = (req as any).rawBody as unknown;

    if (!Buffer.isBuffer(raw)) {
      logger.error(
        { route: "/webhooks/lemon" },
        "verifyLemonWebhook: rawBody missing or not Buffer"
      );
      res.status(400).json({ error: "invalid_webhook_body" });
      return;
    }

    const expected = computeExpectedSignature(raw, secret);
    const provided = decodeProvidedSignature(sig);

    if (!provided) {
      logger.warn(
        { route: "/webhooks/lemon" },
        "verifyLemonWebhook: signature format invalid"
      );
      res.status(401).json({ error: "webhook_unauthorized" });
      return;
    }

    if (provided.length !== expected.length) {
      logger.warn(
        { route: "/webhooks/lemon" },
        "verifyLemonWebhook: invalid signature length"
      );
      res.status(401).json({ error: "webhook_unauthorized" });
      return;
    }

    const ok = crypto.timingSafeEqual(provided, expected);

    if (!ok) {
      logger.warn(
        { route: "/webhooks/lemon" },
        "verifyLemonWebhook: invalid signature"
      );
      res.status(401).json({ error: "webhook_unauthorized" });
      return;
    }

    next();
  } catch (err) {
    logger.error({ err, route: "/webhooks/lemon" }, "verifyLemonWebhook failed");
    res.status(401).json({ error: "webhook_unauthorized" });
  }
}
