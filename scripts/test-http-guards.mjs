import assert from "node:assert/strict";

import {
  DEFAULT_SIGNALOPS_DELIVERY_TIMEOUT_MS,
  DEFAULT_SIGNALOPS_EVENT_INGEST_RATE_LIMIT,
  DEFAULT_SIGNALOPS_EVENT_VALIDATE_RATE_LIMIT,
  DEFAULT_SIGNALOPS_PILOT_REQUEST_MAX_BODY_BYTES,
  DEFAULT_SIGNALOPS_PILOT_REQUEST_RATE_LIMIT,
  DEFAULT_SIGNALOPS_RATE_LIMIT_WINDOW_MS,
  acceptsJson,
  acceptsPilotRequestBody,
  checkSignalOpsRateLimit,
  payloadTooLargeBody,
  rateLimitedBody,
  readPilotRequestMaxBodyBytes,
  readSignalOpsDeliveryTimeoutMs,
  readSignalOpsRateLimitPolicy,
  requestContentLengthExceeds,
  resetSignalOpsRateLimits,
  unsupportedMediaTypeBody,
  utf8ByteLength,
} from "../src/lib/signalops/http.ts";

assert.equal(utf8ByteLength("abcd"), 4);
assert.equal(utf8ByteLength("🔥"), 4);
assert.equal(utf8ByteLength("🔥🔥"), 8);

assert.equal(readPilotRequestMaxBodyBytes({}), DEFAULT_SIGNALOPS_PILOT_REQUEST_MAX_BODY_BYTES);
assert.equal(readPilotRequestMaxBodyBytes({ SIGNALOPS_PILOT_REQUEST_MAX_BODY_BYTES: "512" }), 1024);
assert.equal(readPilotRequestMaxBodyBytes({ SIGNALOPS_PILOT_REQUEST_MAX_BODY_BYTES: "200000" }), 128 * 1024);
assert.equal(readPilotRequestMaxBodyBytes({ SIGNALOPS_PILOT_REQUEST_MAX_BODY_BYTES: "65536" }), 65536);
assert.equal(readSignalOpsDeliveryTimeoutMs({}), DEFAULT_SIGNALOPS_DELIVERY_TIMEOUT_MS);
assert.equal(readSignalOpsDeliveryTimeoutMs({ SIGNALOPS_DELIVERY_TIMEOUT_MS: "50" }), 100);
assert.equal(readSignalOpsDeliveryTimeoutMs({ SIGNALOPS_DELIVERY_TIMEOUT_MS: "40000" }), 30000);
assert.equal(readSignalOpsDeliveryTimeoutMs({ SIGNALOPS_DELIVERY_TIMEOUT_MS: "7500" }), 7500);
assert.deepEqual(readSignalOpsRateLimitPolicy({}), {
  mode: "instance_memory",
  windowMs: DEFAULT_SIGNALOPS_RATE_LIMIT_WINDOW_MS,
  buckets: {
    event_validation: DEFAULT_SIGNALOPS_EVENT_VALIDATE_RATE_LIMIT,
    event_ingest: DEFAULT_SIGNALOPS_EVENT_INGEST_RATE_LIMIT,
    pilot_request: DEFAULT_SIGNALOPS_PILOT_REQUEST_RATE_LIMIT,
  },
});
assert.deepEqual(
  readSignalOpsRateLimitPolicy({
    SIGNALOPS_RATE_LIMIT_WINDOW_MS: "500",
    SIGNALOPS_EVENT_VALIDATE_RATE_LIMIT: "0",
    SIGNALOPS_EVENT_INGEST_RATE_LIMIT: "20000",
    SIGNALOPS_PILOT_REQUEST_RATE_LIMIT: "3",
  }),
  {
    mode: "instance_memory",
    windowMs: 1000,
    buckets: {
      event_validation: 1,
      event_ingest: 10000,
      pilot_request: 3,
    },
  },
);

assert.equal(acceptsJson(new Request("https://signalops.test", { headers: { "content-type": "application/json" } })), true);
assert.equal(acceptsJson(new Request("https://signalops.test", { headers: { "content-type": "text/plain" } })), false);
assert.equal(
  acceptsPilotRequestBody(
    new Request("https://signalops.test", { headers: { "content-type": "application/x-www-form-urlencoded" } }),
  ),
  true,
);
assert.equal(
  acceptsPilotRequestBody(new Request("https://signalops.test", { headers: { "content-type": "text/plain" } })),
  false,
);

assert.equal(
  requestContentLengthExceeds(
    new Request("https://signalops.test", { headers: { "content-length": "32769" } }),
    32768,
  ),
  true,
);
assert.equal(
  requestContentLengthExceeds(
    new Request("https://signalops.test", { headers: { "content-length": "32768" } }),
    32768,
  ),
  false,
);

assert.deepEqual(payloadTooLargeBody("req_test", 1024), {
  ok: false,
  code: "payload_too_large",
  maxBodyBytes: 1024,
  requestId: "req_test",
});
assert.deepEqual(unsupportedMediaTypeBody("req_test", ["application/json"]), {
  ok: false,
  code: "unsupported_media_type",
  error: "content-type must be application/json",
  accepts: ["application/json"],
  requestId: "req_test",
});

resetSignalOpsRateLimits();
const limitedRequest = new Request("https://signalops.test", {
  headers: { "cf-connecting-ip": "203.0.113.10" },
});
const rateLimitEnv = {
  SIGNALOPS_RATE_LIMIT_WINDOW_MS: "1000",
  SIGNALOPS_EVENT_VALIDATE_RATE_LIMIT: "1",
};
const firstRateLimit = checkSignalOpsRateLimit(limitedRequest, "event_validation", rateLimitEnv, 1_000);
assert.equal(firstRateLimit.limited, false);
assert.equal(firstRateLimit.remaining, 0);
const secondRateLimit = checkSignalOpsRateLimit(limitedRequest, "event_validation", rateLimitEnv, 1_100);
assert.equal(secondRateLimit.limited, true);
assert.equal(secondRateLimit.limit, 1);
assert.equal(secondRateLimit.retryAfterSeconds, 1);
assert.equal(new Headers(secondRateLimit.headers).get("x-ratelimit-bucket"), "event_validation");
assert.deepEqual(rateLimitedBody("req_test", secondRateLimit), {
  ok: false,
  code: "rate_limited",
  error: "rate limit exceeded for event_validation; retry after 1s",
  bucket: "event_validation",
  limit: 1,
  remaining: 0,
  resetAt: secondRateLimit.resetAt,
  retryAfterSeconds: 1,
  requestId: "req_test",
});
const nextWindowRateLimit = checkSignalOpsRateLimit(limitedRequest, "event_validation", rateLimitEnv, 2_001);
assert.equal(nextWindowRateLimit.limited, false);
resetSignalOpsRateLimits();

console.log("ok: SignalOps HTTP guards");
