import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

export function verifyLemonWebhook(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const secret = process.env.LEMON_WEBHOOK_SECRET;
  const signature = req.header("x-signature");

  if (!secret || !signature) {
    res.status(401).json({ error: "Webhook verification failed" });
    return;
  }

  const rawBody = (req as any).rawBody as Buffer;
  const hmac = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  if (hmac !== signature) {
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  next();
}
