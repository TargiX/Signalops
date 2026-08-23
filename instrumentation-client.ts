import posthog from "posthog-js";

const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;
const isConfigured = Boolean(
  projectToken &&
    posthogHost &&
    !projectToken.includes("your_posthog") &&
    !posthogHost.includes("your_posthog"),
);

function browserStorageAvailable() {
  try {
    const probe = "__signalops_posthog_storage_probe__";
    window.localStorage.setItem(probe, probe);
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

if (isConfigured) {
  try {
    posthog.init(projectToken!, {
      api_host: "/ingest",
      ui_host: posthogHost!.replace(".i.posthog.com", ".posthog.com"),
      defaults: "2026-01-30",
      capture_exceptions: true,
      person_profiles: "identified_only",
      persistence: browserStorageAvailable() ? "localStorage+cookie" : "memory",
      mask_all_text: true,
      mask_all_element_attributes: true,
      debug: process.env.NODE_ENV === "development",
    });
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("PostHog client initialization failed", error);
    }
  }
} else if (process.env.NODE_ENV === "development") {
  console.info(
    "[SignalOps] PostHog is disabled because local analytics credentials are not configured.",
  );
}
