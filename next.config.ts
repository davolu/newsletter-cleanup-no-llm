import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@composio/core", "@typesafe-ai/sdk", "@upstash/redis"],
};

export default nextConfig;
