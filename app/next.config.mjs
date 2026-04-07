import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Explicitly set the monorepo root so Next.js doesn't get confused
  // by the repo-level package-lock.json sitting above app/.
  outputFileTracingRoot: path.join(__dirname, ".."),

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
