import type { Request, Response } from "express";

export function stripeWebhook(req: Request, res: Response) {
  res.status(200).send("ok");
}
