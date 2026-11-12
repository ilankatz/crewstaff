import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // CrewStaff admin pages are client-rendered and read live data from /api,
  // so the Cache Components model is not used.
  cacheComponents: false,
  serverExternalPackages: ["better-sqlite3", "firebase-admin"],
  // Lets the dev server be opened from other devices on the LAN.
  allowedDevOrigins: ["*.local", "192.168.*.*", "10.*.*.*"],
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
