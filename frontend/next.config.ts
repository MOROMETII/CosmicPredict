import type { NextConfig } from "next";

// Proxy /api/* to the FastAPI backend so the browser always talks to the same
// origin (no CORS involved). Override with BACKEND_URL if the backend is not
// on localhost:8000.
const backendUrl = process.env.BACKEND_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
