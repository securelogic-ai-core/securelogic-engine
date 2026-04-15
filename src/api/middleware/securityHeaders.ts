/**
 * securityHeaders.ts — Enterprise security header middleware.
 *
 * Sets opinionated security headers on every response. Applied globally
 * before all routes in server.ts.
 *
 * Headers set:
 *   Strict-Transport-Security — enforce HTTPS for 1 year including subdomains
 *   X-Content-Type-Options    — prevent MIME-type sniffing
 *   X-Frame-Options           — prevent clickjacking via iframes
 *   X-XSS-Protection          — legacy XSS filter hint for older browsers
 *   Referrer-Policy           — limit referrer leakage across origins
 *   Content-Security-Policy   — lock down resource loading; block iframes
 *   Permissions-Policy        — disable sensor/camera/mic APIs
 */

import type { Request, Response, NextFunction } from "express";

export function securityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  // Enforce HTTPS for 1 year, propagate to all subdomains.
  res.setHeader(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains"
  );

  // Prevent MIME-type sniffing — browser must honour declared Content-Type.
  res.setHeader("X-Content-Type-Options", "nosniff");

  // Disallow this page from being embedded in any frame — clickjacking defence.
  res.setHeader("X-Frame-Options", "DENY");

  // Legacy XSS filter for older browsers (Chrome <78, IE11).
  res.setHeader("X-XSS-Protection", "1; mode=block");

  // Only send the origin when navigating cross-origin; full URL for same-origin.
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  // Strict CSP: no external resources, no iframes.
  // APIs don't serve HTML so this is belt-and-suspenders; the key restriction
  // is frame-ancestors 'none' which supersedes X-Frame-Options in modern browsers.
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'"
  );

  // Disable browser sensor/device APIs not needed by this API service.
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=()"
  );

  next();
}
