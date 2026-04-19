import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Explicitly set the monorepo root so Next.js doesn't get confused
  // by the repo-level package-lock.json sitting above app/.
  outputFileTracingRoot: path.join(__dirname, ".."),

  // Security headers applied to every response from the Next.js app.
  // microphone is intentionally not restricted — voice search uses getUserMedia.
  // CSP is not set here; it requires careful tuning for Next.js inline scripts
  // and should be added once the script inventory is known.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options",           value: "DENY" },
          { key: "X-Content-Type-Options",     value: "nosniff" },
          { key: "X-XSS-Protection",           value: "1; mode=block" },
          { key: "Referrer-Policy",            value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy",         value: "camera=(), geolocation=()" },
          { key: "Strict-Transport-Security",  value: "max-age=31536000; includeSubDomains" },
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
