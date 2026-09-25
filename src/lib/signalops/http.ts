export function requestContentType(request: Request) {
  return request.headers.get("content-type")?.toLowerCase() ?? "";
}

export function acceptsJson(request: Request) {
  return requestContentType(request).includes("application/json");
}

export function acceptsPilotRequestBody(request: Request) {
  const contentType = requestContentType(request);
  return (
    contentType.includes("application/json") ||
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  );
}

export function unsupportedMediaTypeBody(requestId: string, accepts: string[]) {
  return {
    ok: false,
    code: "unsupported_media_type",
    error: `content-type must be ${accepts.join(" or ")}`,
    accepts,
    requestId,
  };
}

export const DEFAULT_SIGNALOPS_PILOT_REQUEST_MAX_BODY_BYTES = 32 * 1024;
export const DEFAULT_SIGNALOPS_DELIVERY_TIMEOUT_MS = 5000;
export const DEFAULT_SIGNALOPS_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const DEFAULT_SIGNALOPS_EVENT_VALIDATE_RATE_LIMIT = 60;
export const DEFAULT_SIGNALOPS_EVENT_INGEST_RATE_LIMIT = 120;
export const DEFAULT_SIGNALOPS_PILOT_REQUEST_RATE_LIMIT = 10;

type RateLimitBucket = "event_validation" | "event_ingest" | "pilot_request";

type RateLimitWindow = {
  count: number;
  resetAt: number;
};

export type SignalOpsRateLimitPolicy = {
  mode: "instance_memory";
  windowMs: number;
  buckets: Record<RateLimitBucket, number>;
};

export type SignalOpsRateLimitResult = {
  bucket: RateLimitBucket;
  limited: boolean;
  limit: number;
  remaining: number;
  resetAt: string;
  retryAfterSeconds: number;
  headers: HeadersInit;
};

const rateLimitWindows = new Map<string, RateLimitWindow>();

function readBoundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

export function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export function readPilotRequestMaxBodyBytes(env: Record<string, string | undefined> = process.env) {
  const parsed = Number(env.SIGNALOPS_PILOT_REQUEST_MAX_BODY_BYTES);
  if (!Number.isInteger(parsed)) {
    return DEFAULT_SIGNALOPS_PILOT_REQUEST_MAX_BODY_BYTES;
  }

  return Math.min(Math.max(parsed, 1024), 128 * 1024);
}

export function readSignalOpsDeliveryTimeoutMs(env: Record<string, string | undefined> = process.env) {
  return readBoundedInteger(env.SIGNALOPS_DELIVERY_TIMEOUT_MS, DEFAULT_SIGNALOPS_DELIVERY_TIMEOUT_MS, 100, 30000);
}

export function readSignalOpsRateLimitPolicy(
  env: Record<string, string | undefined> = process.env,
): SignalOpsRateLimitPolicy {
  return {
    mode: "instance_memory",
    windowMs: readBoundedInteger(
      env.SIGNALOPS_RATE_LIMIT_WINDOW_MS,
      DEFAULT_SIGNALOPS_RATE_LIMIT_WINDOW_MS,
      1000,
      5 * 60 * 1000,
    ),
    buckets: {
      event_validation: readBoundedInteger(
        env.SIGNALOPS_EVENT_VALIDATE_RATE_LIMIT,
        DEFAULT_SIGNALOPS_EVENT_VALIDATE_RATE_LIMIT,
        1,
        10000,
      ),
      event_ingest: readBoundedInteger(
        env.SIGNALOPS_EVENT_INGEST_RATE_LIMIT,
        DEFAULT_SIGNALOPS_EVENT_INGEST_RATE_LIMIT,
        1,
        10000,
      ),
      pilot_request: readBoundedInteger(
        env.SIGNALOPS_PILOT_REQUEST_RATE_LIMIT,
        DEFAULT_SIGNALOPS_PILOT_REQUEST_RATE_LIMIT,
        1,
        10000,
      ),
    },
  };
}

export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function requestContentLengthExceeds(request: Request, maxBodyBytes: number) {
  const raw = request.headers.get("content-length");
  if (!raw) {
    return false;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > maxBodyBytes;
}

export function payloadTooLargeBody(requestId: string, maxBodyBytes: number) {
  return {
    ok: false,
    code: "payload_too_large",
    maxBodyBytes,
    requestId,
  };
}

function rateLimitClientKey(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    request.headers.get("cf-connecting-ip") ||
    forwardedFor ||
    request.headers.get("x-real-ip") ||
    "anonymous"
  );
}

function rateLimitHeaders(result: Omit<SignalOpsRateLimitResult, "headers">): HeadersInit {
  return {
    "retry-after": String(result.retryAfterSeconds),
    "x-ratelimit-bucket": result.bucket,
    "x-ratelimit-limit": String(result.limit),
    "x-ratelimit-remaining": String(result.remaining),
    "x-ratelimit-reset": result.resetAt,
  };
}

export function checkSignalOpsRateLimit(
  request: Request,
  bucket: RateLimitBucket,
  env: Record<string, string | undefined> = process.env,
  now = Date.now(),
): SignalOpsRateLimitResult {
  const policy = readSignalOpsRateLimitPolicy(env);
  const limit = policy.buckets[bucket];
  const clientKey = rateLimitClientKey(request);
  const windowKey = `${bucket}:${clientKey}`;
  const currentWindow = rateLimitWindows.get(windowKey);
  const activeWindow =
    currentWindow && currentWindow.resetAt > now
      ? currentWindow
      : {
          count: 0,
          resetAt: now + policy.windowMs,
        };

  activeWindow.count += 1;
  rateLimitWindows.set(windowKey, activeWindow);

  const limited = activeWindow.count > limit;
  const resetAt = new Date(activeWindow.resetAt).toISOString();
  const retryAfterSeconds = Math.max(1, Math.ceil((activeWindow.resetAt - now) / 1000));
  const result = {
    bucket,
    limited,
    limit,
    remaining: Math.max(0, limit - activeWindow.count),
    resetAt,
    retryAfterSeconds,
  };

  return {
    ...result,
    headers: rateLimitHeaders(result),
  };
}

export function rateLimitedBody(requestId: string, result: SignalOpsRateLimitResult) {
  return {
    ok: false,
    code: "rate_limited",
    error: `rate limit exceeded for ${result.bucket}; retry after ${result.retryAfterSeconds}s`,
    bucket: result.bucket,
    limit: result.limit,
    remaining: result.remaining,
    resetAt: result.resetAt,
    retryAfterSeconds: result.retryAfterSeconds,
    requestId,
  };
}

export function resetSignalOpsRateLimits() {
  rateLimitWindows.clear();
}
