import path from "path";
import { fileURLToPath } from "url";

import { withSentryConfig } from "@sentry/nextjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Explicitly set the monorepo root so Next.js doesn't get confused
  // by the repo-level package-lock.json sitting above app/.
  outputFileTracingRoot: path.join(__dirname, ".."),

  async rewrites() {
    return [
      { source: "/version", destination: "/api/version" },
    ];
  },

  async headers() {
    const csp = [
      "default-src 'self'",
      // unsafe-inline required for Next.js inline scripts; unsafe-eval for hydration
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      // blob: for QR code canvas data URLs; data: for inline images; https: for remote assets
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      // Engine URL must be allowed for browser-side SSO domain checks
      "connect-src 'self' https://securelogic-engine.onrender.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");

    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Strict-Transport-Security",  value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Frame-Options",            value: "DENY" },
          { key: "X-Content-Type-Options",     value: "nosniff" },
          { key: "X-XSS-Protection",           value: "1; mode=block" },
          { key: "Referrer-Policy",            value: "strict-origin-when-cross-origin" },
          {
            key:   "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"
          },
          { key: "Content-Security-Policy",    value: csp },
        ],
      },
    ];
  },

  // Explicitly wire the @/ alias in webpack so it resolves correctly
  // regardless of whether Next.js successfully reads tsconfig paths
  // in a monorepo layout where multiple lockfiles exist.
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@": path.join(__dirname, "src"),
    };
    return config;
  },
};

// Wrap the existing config with Sentry. This only adds Sentry build-time
// behavior (source map upload when SENTRY_AUTH_TOKEN is present); all settings
// in nextConfig above are preserved unchanged.
//
// org / project / authToken are read from env. When authToken is absent the
// build still succeeds — Sentry simply skips source map upload (a deliberate
// follow-up PR, not wired here). silent suppresses Sentry's build chatter in CI.
//
// tunnelRoute routes browser SDK events through a same-origin Next.js route
// handler (/monitoring) that proxies to Sentry. This keeps client-side capture
// working under the strict CSP connect-src (only 'self' + the engine) WITHOUT
// widening the CSP — /monitoring is same-origin, already allowed by 'self'.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: process.env.CI === "true",
  tunnelRoute: "/monitoring",
});
