import { createHmac, timingSafeEqual } from "node:crypto";

function safeEqual(left: string, right: string): boolean {
  const key = "signalops-internal-auth-constant-time";
  const leftDigest = createHmac("sha256", key).update(left).digest();
  const rightDigest = createHmac("sha256", key).update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function isSignalOpsCronAuthConfiguredV1(): boolean {
  const value = (process.env.CRON_SECRET ?? process.env.SIGNALOPS_CRON_SECRET)?.trim();
  return Boolean(value && value.length >= 32);
}

export function authorizeSignalOpsCronRequestV1(request: Request): boolean {
  const expected = (
    process.env.CRON_SECRET ?? process.env.SIGNALOPS_CRON_SECRET
  )?.trim();
  const authorization = request.headers.get("authorization");
  if (!expected || expected.length < 32 || !authorization?.startsWith("Bearer ")) return false;
  return safeEqual(authorization.slice("Bearer ".length).trim(), expected);
}
