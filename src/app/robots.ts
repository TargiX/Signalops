import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/cockpit", "/settings", "/incidents/", "/consumers/"],
    },
    sitemap: "https://signalops.cc/sitemap.xml",
    host: "https://signalops.cc",
  };
}
