import { Request, Response, NextFunction } from "express";

export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.header("x-api-key");

  if (!apiKey || apiKey !== process.env.ENGINE_API_KEY) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized: invalid or missing API key"
    });
  }

  next();
}
