import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  async headers() {
    return [
      {
        source: "/s/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-store, max-age=0",
          },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "X-Robots-Tag",
            value: "noindex, nofollow, noarchive",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
