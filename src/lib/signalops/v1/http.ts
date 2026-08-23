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
