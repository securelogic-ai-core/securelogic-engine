import type { Request, Response, NextFunction } from "express";
import { resolveLicense } from "../auth/resolveLicense";

export function licenseLogger(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  const license = resolveLicense(req);

  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
      license,
    })
  );

  next();
}
