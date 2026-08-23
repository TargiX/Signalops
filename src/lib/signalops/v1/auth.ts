import { createHash, timingSafeEqual } from "node:crypto";

import { resolveSupabaseSignalOpsPrincipalV1 } from "./supabase.ts";
import { getSignalOpsSupabaseConfigV1 } from "./supabase.ts";
import type { SignalOpsTenantPrincipalV1 } from "./types.ts";

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function hashSignalOpsCredentialV1(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function readSignalOpsBearerTokenV1(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token.length >= 24 && token.length <= 512 ? token : null;
}

export async function resolveSignalOpsTenantPrincipalV1(
  request: Request,
): Promise<SignalOpsTenantPrincipalV1 | null> {
  const token = readSignalOpsBearerTokenV1(request);
  if (!token) return null;
  const tokenHash = hashSignalOpsCredentialV1(token);
  const configuredHash = process.env.SIGNALOPS_INGEST_TOKEN_HASH?.trim();
  const configuredToken = process.env.SIGNALOPS_INGEST_TOKEN?.trim();
  const bootstrapAllowed =
    process.env.NODE_ENV !== "production" ||
    process.env.SIGNALOPS_ALLOW_BOOTSTRAP_CREDENTIAL === "true";
  const matchesBootstrapCredential =
    bootstrapAllowed &&
    (configuredHash
      ? safeEqual(tokenHash, configuredHash)
      : Boolean(configuredToken && safeEqual(token, configuredToken)));

  if (matchesBootstrapCredential) {
    const tenantId =
      process.env.SIGNALOPS_WORKSPACE_SLUG?.trim() ||
      (process.env.NODE_ENV === "production" ? null : "demo");
    if (!tenantId) return null;
    return {
      tenantId,
      credentialId: "bootstrap-environment-credential",
      scopes: ["events:validate", "events:write"],
    };
  }

  const supabase = getSignalOpsSupabaseConfigV1();
  return supabase ? resolveSupabaseSignalOpsPrincipalV1({ config: supabase, tokenHash }) : null;
}
