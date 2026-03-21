import type { Request, Response, NextFunction } from "express";
import { pg } from "../infra/postgres.js";

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
      res.status(401).json({ error: "api_key_required" });
      return;
    }

    const result = await pg.query(
      `
      SELECT *
      FROM api_keys
      WHERE key_hash = $1
      LIMIT 1
      `,
      [presentedKey]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: "invalid_api_key" });
      return;
    }

    const apiKey = result.rows[0] as Record<string, unknown>;

    if (
      "status" in apiKey &&
      typeof apiKey.status === "string" &&
      apiKey.status.toLowerCase() !== "active"
    ) {
      res.status(403).json({ error: "api_key_inactive" });
      return;
    }

    if ("revoked_at" in apiKey && apiKey.revoked_at) {
      res.status(403).json({ error: "api_key_revoked" });
      return;
    }

    await pg.query(
      `
      UPDATE api_keys
      SET last_used_at = NOW()
      WHERE id = $1
      `,
      [apiKey.id]
    );

    (req as any).apiKey = apiKey;
    next();
  } catch (err) {
    console.error("require_api_key_error", err);
    res.status(500).json({ error: "api_key_validation_failed" });
  }
}
