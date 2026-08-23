import { createHmac, timingSafeEqual } from "node:crypto";

import type { SignalOpsOperatorRoleV1 } from "./operator-directory.ts";

export const signalOpsCockpitSessionCookieV1 = "signalops_operator_session";

export type SignalOpsOperatorSessionV1 = {
  tenantId: string;
  tenantName: string;
  subject: string;
  role: SignalOpsOperatorRoleV1;
  authMode: "password" | "supabase";
  issuedAt: number;
  expiresAt: number;
};

function safeEqual(left: string, right: string): boolean {
  const leftDigest = createHmac("sha256", "signalops-constant-time-compare").update(left).digest();
  const rightDigest = createHmac("sha256", "signalops-constant-time-compare").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function sessionSecret(): string | null {
  const value = process.env.SIGNALOPS_SESSION_SECRET?.trim();
  if (!value || (process.env.NODE_ENV === "production" && value.length < 32)) return null;
  return value;
}

function previousSessionSecret(): string | null {
  const value = process.env.SIGNALOPS_SESSION_SECRET_PREVIOUS?.trim();
  if (!value || (process.env.NODE_ENV === "production" && value.length < 32)) return null;
  return value;
}

function encode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function decode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function sign(payload: string, secret = sessionSecret()): string | null {
  return secret ? createHmac("sha256", secret).update(payload).digest("base64url") : null;
}

function cookieValue(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

export function isSignalOpsOperatorAuthConfiguredV1(): boolean {
  const passwordAllowed =
    process.env.NODE_ENV !== "production" ||
    process.env.SIGNALOPS_ALLOW_PASSWORD_AUTH === "true";
  const password = process.env.SIGNALOPS_COCKPIT_PASSWORD?.trim();
  return Boolean(
    passwordAllowed &&
      password &&
      (process.env.NODE_ENV !== "production" || password.length >= 16) &&
      sessionSecret(),
  );
}

export function verifySignalOpsOperatorPasswordV1(value: unknown): boolean {
  const password = process.env.SIGNALOPS_COCKPIT_PASSWORD?.trim();
  return typeof value === "string" && Boolean(password) && safeEqual(value, password!);
}

export function configuredSignalOpsTenantV1(): { id: string; name: string } {
  const id = process.env.SIGNALOPS_WORKSPACE_SLUG?.trim() || "phosphene-production";
  return {
    id,
    name: process.env.SIGNALOPS_WORKSPACE_NAME?.trim() || (id === "phosphene-production" ? "Phosphene" : id),
  };
}

export function createSignalOpsOperatorSessionTokenV1(input?: {
  tenantId: string;
  tenantName: string;
  subject: string;
  role: SignalOpsOperatorRoleV1;
  authMode: "password" | "supabase";
}): string {
  const configuredTenant = configuredSignalOpsTenantV1();
  const tenant = input ?? {
    tenantId: configuredTenant.id,
    tenantName: configuredTenant.name,
    subject: process.env.SIGNALOPS_OPERATOR_SUBJECT?.trim() || "workspace-operator",
    role: "owner" as const,
    authMode: "password" as const,
  };
  const configuredTtl = Number(process.env.SIGNALOPS_SESSION_TTL_SECONDS ?? 60 * 60);
  const ttlSeconds =
    Number.isFinite(configuredTtl) && configuredTtl > 0
      ? Math.max(300, Math.min(configuredTtl, 24 * 60 * 60))
      : 60 * 60;
  const issuedAt = Math.floor(Date.now() / 1_000);
  const payload = encode(
    JSON.stringify({
      tenantId: tenant.tenantId,
      tenantName: tenant.tenantName,
      subject: tenant.subject,
      role: tenant.role,
      authMode: tenant.authMode,
      issuedAt,
      expiresAt: issuedAt + ttlSeconds,
    } satisfies SignalOpsOperatorSessionV1),
  );
  const signature = sign(payload);
  if (!signature) throw new Error("SIGNALOPS_SESSION_SECRET is required");
  return `${payload}.${signature}`;
}

export function readSignalOpsOperatorSessionV1(
  request: Request,
): SignalOpsOperatorSessionV1 | null {
  const token = cookieValue(request, signalOpsCockpitSessionCookieV1);
  const [payload, signature] = token?.split(".") ?? [];
  const expected = payload ? sign(payload) : null;
  const previousExpected = payload ? sign(payload, previousSessionSecret()) : null;
  if (
    !payload ||
    !signature ||
    ((!expected || !safeEqual(signature, expected)) &&
      (!previousExpected || !safeEqual(signature, previousExpected)))
  ) {
    return null;
  }
  try {
    const session = JSON.parse(decode(payload)) as SignalOpsOperatorSessionV1;
    if (
      !session.tenantId ||
      !session.tenantName ||
      !session.subject ||
      !["owner", "operator", "viewer"].includes(session.role) ||
      !["password", "supabase"].includes(session.authMode) ||
      !Number.isInteger(session.issuedAt) ||
      !Number.isInteger(session.expiresAt) ||
      session.issuedAt > Math.floor(Date.now() / 1_000) + 60 ||
      session.expiresAt <= session.issuedAt ||
      session.expiresAt <= Math.floor(Date.now() / 1_000)
    ) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function serializeSignalOpsOperatorSessionCookieV1(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const ttlSeconds = Number(process.env.SIGNALOPS_SESSION_TTL_SECONDS ?? 60 * 60);
  const maxAge =
    Number.isFinite(ttlSeconds) && ttlSeconds > 0
      ? Math.max(300, Math.min(ttlSeconds, 24 * 60 * 60))
      : 60 * 60;
  return `${signalOpsCockpitSessionCookieV1}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearSignalOpsOperatorSessionCookieV1(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${signalOpsCockpitSessionCookieV1}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
