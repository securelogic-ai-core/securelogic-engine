/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export — generates a flat out/ directory of HTML/CSS/JS.
  // Upload out/ contents to Hosting.com public_html/ to deploy.
  output: "export",

  // Required for static export: Next.js image optimisation needs a server.
  // Images display normally; they just aren't auto-converted to WebP.
  images: {
    unoptimized: true,
  },

  // Trailing slashes ensure index.html files are generated for every route,
  // which is required for correct routing on shared hosting (no server rewrite).
  trailingSlash: true,
};

export default nextConfig;
