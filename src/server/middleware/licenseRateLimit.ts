import rateLimit from "express-rate-limit";
import { Request } from "express";
import { resolveLicense } from "../auth/resolveLicense";

export const licenseRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  standardHeaders: true,
  legacyHeaders: false,
  max: (req: Request) => {
    const license = resolveLicense(req);

    switch (license) {
      case "ENTERPRISE":
        return 300;
      case "PRO":
        return 60;
      case "FREE":
      default:
        return 10;
    }
  },
});
