import type { Request, Response } from "express";
import { verifyEnvelope } from "../product/api";

export function verifyHandler(req: Request, res: Response) {
  const result = verifyEnvelope(req.body);
  res.status(result.valid ? 200 : 400).json(result);
}
