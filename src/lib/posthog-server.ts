import { PostHog } from "posthog-node";

type ServerEventProperties = Record<
  string,
  boolean | number | string | null | undefined
>;

type ServerProductEvent = {
  distinctId: string;
  event: string;
  properties?: ServerEventProperties;
  groups?: Record<string, string>;
  sessionId?: string | null;
};

let client: PostHog | null | undefined;

function getPostHogClient() {
  if (client !== undefined) {
    return client;
  }

  const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (!projectToken || !host || projectToken.includes("your_posthog")) {
    client = null;
    return client;
  }

  client = new PostHog(projectToken, {
    host,
    flushAt: 1,
    flushInterval: 0,
  });
  return client;
}

export async function captureServerEvent(
  request: Request,
  event: string,
  properties: ServerEventProperties,
) {
  const distinctId =
    request.headers.get("x-posthog-distinct-id") ?? `server_${crypto.randomUUID()}`;
  const sessionId = request.headers.get("x-posthog-session-id");

  await captureServerProductEvent({
    distinctId,
    event,
    properties,
    sessionId,
  });
}

export async function captureServerProductEvent({
  distinctId,
  event,
  properties = {},
  groups,
  sessionId,
}: ServerProductEvent) {
  const posthog = getPostHogClient();
  if (!posthog) return;

  try {
    await posthog.captureImmediate({
      distinctId,
      event,
      groups,
      properties: {
        ...properties,
        ...(sessionId ? { $session_id: sessionId } : {}),
      },
    });
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("PostHog server capture failed", error);
    }
  }
}
