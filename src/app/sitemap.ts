import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://signalops.cc";
  const routes = ["", "/docs", "/pricing", "/security", "/privacy", "/terms", "/contact", "/status", "/onboarding", "/validate"];
  return routes.map((route) => ({
    url: `${base}${route}`,
    lastModified: new Date("2026-08-24T00:00:00.000Z"),
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : route === "/docs" || route === "/onboarding" ? 0.9 : 0.6,
  }));
}
