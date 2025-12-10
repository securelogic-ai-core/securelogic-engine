import { Request, Response, NextFunction } from "express";
import { API_KEYS } from "../config/apiKeys";

export function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const apiKey = req.header("x-api-key");

  if (!apiKey || !API_KEYS[apiKey]) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized: invalid or missing API key"
    });
  }

  req.apiKey = apiKey;
  req.apiTier = API_KEYS[apiKey].tier;

  next();
}
