import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@composio/core", "@typesafe-ai/sdk", "@upstash/redis", "@netlify/blobs", "ioredis"],
};

export default nextConfig;
