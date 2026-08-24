import posthog from "posthog-js";

type AnalyticsProperties = Record<
  string,
  boolean | number | string | null | undefined
>;

function isPostHogConfigured() {
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

  return Boolean(
    token &&
      host &&
      !token.includes("your_posthog") &&
      !host.includes("your_posthog"),
  );
}

const fallbackDistinctId = `anonymous_${crypto.randomUUID()}`;
const fallbackSessionId = crypto.randomUUID();

export function captureProductEvent(
  event: string,
  properties?: AnalyticsProperties,
) {
  if (!isPostHogConfigured()) {
    return;
  }

  try {
    posthog.capture(event, properties);
  } catch {
    // Analytics must never block the product when browser storage is restricted.
  }
}

export function identifyProductUser(input: {
  subject: string;
  tenantId: string;
  role: "owner" | "operator" | "viewer";
}) {
  if (!isPostHogConfigured()) return;
  try {
    posthog.identify(input.subject, { account_type: "operator" });
    posthog.group("workspace", input.tenantId, { lifecycle: "active" });
    posthog.register({ workspace_role: input.role });
  } catch {
    // Identity stitching is best-effort and never blocks authenticated product use.
  }
}

export function resetProductIdentity() {
  if (!isPostHogConfigured()) return;
  try {
    posthog.reset();
  } catch {
    // Sign-out remains authoritative when analytics storage is unavailable.
  }
}

export function captureProductException(
  error: unknown,
  properties?: AnalyticsProperties,
) {
  if (!isPostHogConfigured()) {
    return;
  }

  try {
    posthog.captureException(error, properties);
  } catch {
    // Exception reporting is best-effort and must not mask the original flow.
  }
}

export function getPostHogRequestHeaders(): Record<string, string> {
  if (!isPostHogConfigured()) {
    return {};
  }

  try {
    return {
      "x-posthog-distinct-id": posthog.get_distinct_id(),
      "x-posthog-session-id": posthog.get_session_id(),
    };
  } catch {
    return {
      "x-posthog-distinct-id": fallbackDistinctId,
      "x-posthog-session-id": fallbackSessionId,
    };
  }
}
