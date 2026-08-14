import type { NextConfig } from "next";

const apiOrigin = (process.env.GAPPROOF_API_ORIGIN ?? "http://127.0.0.1:4000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  transpilePackages: ["@gapproof/contracts"],
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiOrigin}/:path*` }];
  },
};

export default nextConfig;
