import type { NextConfig } from "next";

function getAllowedDevOrigins() {
  const portlessUrl = process.env.PORTLESS_URL;
  if (!portlessUrl) {
    return [];
  }

  try {
    return [new URL(portlessUrl).hostname];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  allowedDevOrigins: getAllowedDevOrigins(),
  reactCompiler: true,
  skipTrailingSlashRedirect: true,
  async rewrites() {
    const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;
    if (!posthogHost) {
      return [];
    }

    const assetsHost = posthogHost.replace(".i.posthog.com", "-assets.i.posthog.com");

    return [
      {
        source: "/ingest/static/:path*",
        destination: `${assetsHost}/static/:path*`,
      },
      {
        source: "/ingest/array/:path*",
        destination: `${assetsHost}/array/:path*`,
      },
      {
        source: "/ingest/:path*",
        destination: `${posthogHost}/:path*`,
      },
    ];
  },
};

export default nextConfig;
