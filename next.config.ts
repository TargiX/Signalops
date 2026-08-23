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

function securityHeaders() {
  const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  const connectSources = ["'self'", ...(posthogHost ? [posthogHost] : [])].join(" ");
  const scriptSources = [
    "'self'",
    "'unsafe-inline'",
    ...(process.env.NODE_ENV === "development" ? ["'unsafe-eval'"] : []),
  ].join(" ");
  const contentSecurityPolicy = [
    "default-src 'self'",
    `script-src ${scriptSources}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connectSources}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ...(process.env.NODE_ENV === "production"
      ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
      : []),
  ];
}

const nextConfig: NextConfig = {
  allowedDevOrigins: getAllowedDevOrigins(),
  reactCompiler: true,
  skipTrailingSlashRedirect: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders() }];
  },
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
