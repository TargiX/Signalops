import { SIGNALOPS_V1_LIMITS } from "./contract.ts";

export class SignalOpsHttpErrorV1 extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function readSignalOpsJsonBodyV1(
  request: Request,
  maxBytes = SIGNALOPS_V1_LIMITS.maxBodyBytes,
): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") {
    throw new SignalOpsHttpErrorV1(415, "unsupported_media_type", "content-type must be application/json");
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new SignalOpsHttpErrorV1(413, "payload_too_large", `request body exceeds ${maxBytes} bytes`);
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new SignalOpsHttpErrorV1(413, "payload_too_large", `request body exceeds ${maxBytes} bytes`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new SignalOpsHttpErrorV1(400, "invalid_json", "request body must be valid JSON");
  }
}

export function isSignalOpsJsonObjectV1(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertSignalOpsSameOriginV1(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) {
    if (process.env.NODE_ENV === "production") {
      throw new SignalOpsHttpErrorV1(403, "csrf_rejected", "a same-origin request is required");
    }
    return;
  }
  const requestUrl = new URL(request.url);
  const expected = process.env.SIGNALOPS_PUBLIC_URL?.trim();
  let allowedOrigin: string;
  let requestOrigin: string;
  try {
    allowedOrigin = expected ? new URL(expected).origin : requestUrl.origin;
    requestOrigin = new URL(origin).origin;
  } catch {
    throw new SignalOpsHttpErrorV1(403, "csrf_rejected", "a same-origin request is required");
  }
  if (requestOrigin !== allowedOrigin) {
    throw new SignalOpsHttpErrorV1(403, "csrf_rejected", "a same-origin request is required");
  }
}
