import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@supabase/supabase-js"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
