import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Explicitly set the monorepo root so Next.js doesn't get confused
  // by the repo-level package-lock.json sitting above app/.
  outputFileTracingRoot: path.join(__dirname, ".."),
};

export default nextConfig;
