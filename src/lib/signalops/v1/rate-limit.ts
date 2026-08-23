import { createHmac } from "node:crypto";

import {
  getSignalOpsSupabaseConfigV1,
  signalOpsSupabaseRestRequestV1,
} from "./supabase.ts";

export type SignalOpsRateLimitDecisionV1 = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: string;
};

export class SignalOpsRateLimitErrorV1 extends Error {
  readonly decision: SignalOpsRateLimitDecisionV1;

  constructor(decision: SignalOpsRateLimitDecisionV1) {
    super("SignalOps request rate limit exceeded");
    this.decision = decision;
  }
}

type LocalBucket = { count: number; resetAt: number };

const globalRateLimits = globalThis as typeof globalThis & {
  __signalOpsRateLimitBucketsV1?: Map<string, LocalBucket>;
};

const localBuckets =
  globalRateLimits.__signalOpsRateLimitBucketsV1 ?? new Map<string, LocalBucket>();
globalRateLimits.__signalOpsRateLimitBucketsV1 = localBuckets;

function rateLimitSecret(): string | null {
  const value = (
    process.env.SIGNALOPS_RATE_LIMIT_SECRET?.trim() ||
    process.env.SIGNALOPS_SESSION_SECRET?.trim() ||
    null
  );
  if (!value || (process.env.NODE_ENV === "production" && value.length < 32)) return null;
  return value;
}

export function isSignalOpsRateLimitingConfiguredV1(): boolean {
  return Boolean(rateLimitSecret());
}

export function signalOpsRateLimitKeyV1(scope: string, identifier: string): string {
  const secret = rateLimitSecret();
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SIGNALOPS_RATE_LIMIT_SECRET is required in production");
    }
    return createHmac("sha256", "signalops-development-rate-limit")
      .update(`${scope}:${identifier}`)
      .digest("hex");
  }
  return createHmac("sha256", secret).update(`${scope}:${identifier}`).digest("hex");
}

export function signalOpsRequestFingerprintV1(request: Request): string {
  const forwarded =
    request.headers.get("x-vercel-forwarded-for") ||
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const firstHop = forwarded.split(",", 1)[0]?.trim() || "unknown";
  return signalOpsRateLimitKeyV1("request-origin", firstHop);
}

function consumeLocal(
  bucketKey: string,
  limit: number,
  windowSeconds: number,
  now = Date.now(),
): SignalOpsRateLimitDecisionV1 {
  const windowMs = windowSeconds * 1_000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = windowStart + windowMs;
  const storageKey = `${bucketKey}:${windowStart}`;
  const current = localBuckets.get(storageKey);
  const count = (current?.count ?? 0) + 1;
  localBuckets.set(storageKey, { count, resetAt });

  if (localBuckets.size > 10_000) {
    for (const [key, bucket] of localBuckets) {
      if (bucket.resetAt <= now) localBuckets.delete(key);
    }
  }

  return {
    allowed: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    resetAt: new Date(resetAt).toISOString(),
  };
}

export async function consumeSignalOpsRateLimitV1(input: {
  bucketKey: string;
  limit: number;
  windowSeconds: number;
}): Promise<SignalOpsRateLimitDecisionV1> {
  if (!Number.isFinite(input.limit) || !Number.isFinite(input.windowSeconds)) {
    throw new Error("SignalOps rate-limit policy must use finite numbers");
  }
  const limit = Math.max(1, Math.min(Math.floor(input.limit), 100_000));
  const windowSeconds = Math.max(1, Math.min(Math.floor(input.windowSeconds), 86_400));
  const config = getSignalOpsSupabaseConfigV1();
  if (!config) return consumeLocal(input.bucketKey, limit, windowSeconds);

  const rows = await signalOpsSupabaseRestRequestV1<
    Array<{ allowed: boolean; remaining: number; reset_at: string }>
  >(config, "rpc/signalops_v1_consume_rate_limit", {
    method: "POST",
    body: JSON.stringify({
      p_bucket_key: input.bucketKey,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    }),
  });
  const row = rows[0];
  if (!row) throw new Error("SignalOps rate limiter returned no decision");
  return {
    allowed: row.allowed,
    limit,
    remaining: row.remaining,
    resetAt: row.reset_at,
  };
}

export async function enforceSignalOpsRateLimitV1(input: {
  scope: string;
  identifier: string;
  limit: number;
  windowSeconds: number;
}): Promise<SignalOpsRateLimitDecisionV1> {
  const decision = await consumeSignalOpsRateLimitV1({
    bucketKey: signalOpsRateLimitKeyV1(input.scope, input.identifier),
    limit: input.limit,
    windowSeconds: input.windowSeconds,
  });
  if (!decision.allowed) throw new SignalOpsRateLimitErrorV1(decision);
  return decision;
}

export function signalOpsRateLimitHeadersV1(
  decision: SignalOpsRateLimitDecisionV1,
): Record<string, string> {
  const resetSeconds = Math.max(
    1,
    Math.ceil((Date.parse(decision.resetAt) - Date.now()) / 1_000),
  );
  return {
    "ratelimit-limit": String(decision.limit),
    "ratelimit-remaining": String(decision.remaining),
    "ratelimit-reset": String(resetSeconds),
    ...(decision.allowed ? {} : { "retry-after": String(resetSeconds) }),
  };
}
