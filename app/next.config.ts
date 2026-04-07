import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ENGINE_API_URL is server-side only (no NEXT_PUBLIC_ prefix).
  // It is accessed exclusively in Server Components and API Routes.
  serverRuntimeConfig: {
    engineApiUrl: process.env.ENGINE_API_URL ?? "http://localhost:4000",
    sessionSecret: process.env.SESSION_SECRET ?? "",
  },
};

export default nextConfig;
