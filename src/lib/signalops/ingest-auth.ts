import { createHash, timingSafeEqual } from "node:crypto";

type RuntimeEnv = Record<string, string | undefined>;

function digestSecret(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

function extractBearerToken(headers: Headers) {
  const authorization = headers.get("authorization") ?? "";
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  return match?.[1] ?? "";
}

export function isSignalEventIngestConfigured(env: RuntimeEnv = process.env) {
  return Boolean(env.SIGNALOPS_INGEST_TOKEN?.trim());
}

export function authenticateSignalEventIngest(
  headers: Headers,
  env: RuntimeEnv = process.env,
) {
  const expectedToken = env.SIGNALOPS_INGEST_TOKEN ?? "";
  const suppliedToken = extractBearerToken(headers);
  const secretsMatch = timingSafeEqual(digestSecret(suppliedToken), digestSecret(expectedToken));

  return Boolean(suppliedToken) && isSignalEventIngestConfigured(env) && secretsMatch;
}
