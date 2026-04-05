import type { Request, Response, NextFunction } from "express";
import { pg } from "../infra/postgres.js";

export async function requireSubscriber(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const emailHeader = req.headers["x-user-email"];
    const email =
      typeof emailHeader === "string" ? emailHeader.trim().toLowerCase() : "";

    if (!email) {
      return res.status(401).json({ error: "Missing subscriber identity" });
    }

    const result = await pg.query(
      `
      SELECT id, email, status
      FROM subscribers
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1
      `,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ error: "Subscriber not found" });
    }

    const subscriber = result.rows[0] as {
      id: string;
      email: string;
      status: string;
    };

    if (subscriber.status !== "active") {
      return res.status(403).json({ error: "Inactive subscription" });
    }

    res.locals.subscriber = subscriber;
    next();
  } catch (error) {
    console.error("Subscriber access check failed:", error);
    return res.status(500).json({ error: "Access check failed" });
  }
}
