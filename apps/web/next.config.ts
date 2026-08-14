import type { NextConfig } from "next";
import { parseApiOrigin } from "./lib/runtime-config";

let apiOrigin: string | undefined;
try {
  apiOrigin = parseApiOrigin(process.env.GAPPROOF_API_ORIGIN);
} catch {
  // Server-rendered API mode presents the precise configuration error. Without
  // a valid origin, keep the browser on this origin and install no proxy route.
}

const nextConfig: NextConfig = {
  transpilePackages: ["@gapproof/contracts"],
  async rewrites() {
    return apiOrigin
      ? [{ source: "/api/:path*", destination: `${apiOrigin}/:path*` }]
      : [];
  },
};

export default nextConfig;
