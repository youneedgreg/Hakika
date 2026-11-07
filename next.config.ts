import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Judge Mode reads its test files from disk (src/server/judge/media.ts), so they ship with its routes.
  outputFileTracingIncludes: {
    "/api/judge/**/*": ["./public/judge/**/*", "./public/mock/proof/**/*"],
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
