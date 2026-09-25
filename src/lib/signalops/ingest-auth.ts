import { timingSafeEqual } from "node:crypto";

import { hasConfiguredSecret } from "./runtime-config.ts";

type RuntimeEnv = Record<string, string | undefined>;

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function isProductionRuntime(env: RuntimeEnv = process.env) {
  return env.NODE_ENV === "production" || Boolean(env.VERCEL);
}

export function isSourceIngestTokenConfigured(env: RuntimeEnv = process.env) {
  return hasConfiguredSecret(env.SIGNALOPS_INGEST_TOKEN);
}

export function sourceIngestAllowsUnauthenticated(env: RuntimeEnv = process.env) {
  if (isProductionRuntime(env)) {
    return false;
  }

  if (env.SIGNALOPS_ALLOW_UNAUTHENTICATED_INGEST === "true") {
    return true;
  }

  return !isSourceIngestTokenConfigured(env) && env.SIGNALOPS_ALLOW_UNAUTHENTICATED_INGEST !== "false";
}

export function sourceIngestAllowsEphemeralStorage(env: RuntimeEnv = process.env) {
  return !isProductionRuntime(env) && env.SIGNALOPS_ALLOW_EPHEMERAL_INGEST !== "false";
}

export function isSourceIngestAuthorized(headers: Headers, env: RuntimeEnv = process.env) {
  const expected = env.SIGNALOPS_INGEST_TOKEN;
  if (!isSourceIngestTokenConfigured(env)) {
    return sourceIngestAllowsUnauthenticated(env);
  }

  const header = headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return Boolean(token) && safeEqual(token, expected!);
}
