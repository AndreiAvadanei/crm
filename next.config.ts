import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow large multipart bodies for file uploads via server actions.
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
  // argon2 is a native module; keep it external to the server bundle.
  serverExternalPackages: ["argon2"],
};

export default nextConfig;
