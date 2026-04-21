import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Explicitly set the monorepo root so Next.js doesn't get confused
  // by the repo-level package-lock.json sitting above app/.
  outputFileTracingRoot: path.join(__dirname, ".."),

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

export default nextConfig;
