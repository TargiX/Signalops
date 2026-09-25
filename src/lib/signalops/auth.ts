import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  isCockpitAuthRequiredFromEnv,
  isCockpitSessionSecretConfiguredFromEnv,
  isOperatorAccessConfiguredFromEnv,
  isOperatorAccessPilotReadyFromEnv,
  isOperatorApiTokenConfiguredFromEnv,
} from "@/lib/signalops/operator-access";
import { hasConfiguredSecret, isProductionRuntime } from "@/lib/signalops/runtime-config";

const SESSION_COOKIE = "signalops_session";

function sessionTtlSeconds() {
  const value = Number(process.env.SIGNALOPS_SESSION_TTL_SECONDS);
  return Number.isFinite(value) && value > 0 ? value : 60 * 60 * 8;
}

function sessionSecret() {
  for (const value of [
    process.env.SIGNALOPS_SESSION_SECRET,
    process.env.SIGNALOPS_ADMIN_TOKEN,
    process.env.SIGNALOPS_COCKPIT_PASSWORD,
  ]) {
    if (typeof value === "string" && hasConfiguredSecret(value)) {
      return value;
    }
  }

  return "signalops-dev-session";
}

function sign(value: string) {
  return createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function isCockpitAuthRequired() {
  return isCockpitAuthRequiredFromEnv();
}

export function isOperatorApiTokenConfigured() {
  return isOperatorApiTokenConfiguredFromEnv();
}

export function isOperatorAccessConfigured() {
  return isOperatorAccessConfiguredFromEnv();
}

export function isCockpitSessionSecretConfigured() {
  return isCockpitSessionSecretConfiguredFromEnv();
}

export function canUseCockpitSessionCookies() {
  return !isProductionRuntime() || isCockpitSessionSecretConfigured();
}

export function isOperatorAccessPilotReady() {
  return isOperatorAccessPilotReadyFromEnv();
}

export function sanitizeNextPath(value: FormDataEntryValue | string | null | undefined) {
  const next = typeof value === "string" ? value : "/cockpit";
  if (!next.startsWith("/") || next.startsWith("//")) {
    return "/cockpit";
  }
  return next;
}

export function createCockpitSessionCookieValue(now = Date.now()) {
  if (!canUseCockpitSessionCookies()) {
    throw new Error("SIGNALOPS_SESSION_SECRET is required for production cockpit sessions.");
  }

  const expiresAt = now + sessionTtlSeconds() * 1000;
  const payload = `cockpit.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

export function getCockpitSessionCookieOptions() {
  return {
    httpOnly: true,
    maxAge: sessionTtlSeconds(),
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL),
  };
}

export function verifyCockpitPassword(password: string) {
  const expected = process.env.SIGNALOPS_COCKPIT_PASSWORD;
  if (!expected) {
    return false;
  }
  return safeEqual(password, expected);
}

export function isValidCockpitSessionCookie(value: string | undefined | null, now = Date.now()) {
  if (!canUseCockpitSessionCookies()) {
    return false;
  }

  if (!value) {
    return false;
  }

  const [scope, expiresAtRaw, signature] = value.split(".");
  if (scope !== "cockpit" || !expiresAtRaw || !signature) {
    return false;
  }

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return false;
  }

  return safeEqual(signature, sign(`${scope}.${expiresAtRaw}`));
}

function getCookieFromHeader(cookieHeader: string | null, name: string) {
  return cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function hasValidOperatorBearerToken(request: Request) {
  const expected = process.env.SIGNALOPS_OPERATOR_TOKEN;
  if (!isOperatorApiTokenConfigured() || !expected) {
    return false;
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return Boolean(token) && safeEqual(token, expected);
}

export function hasValidCockpitSessionFromRequest(request: Request) {
  if (hasValidOperatorBearerToken(request)) {
    return true;
  }

  if (!isCockpitAuthRequired() && !isOperatorApiTokenConfigured()) {
    return true;
  }

  if (!isCockpitAuthRequired()) {
    return false;
  }

  return isValidCockpitSessionCookie(getCookieFromHeader(request.headers.get("cookie"), SESSION_COOKIE));
}

export async function hasValidCockpitSession() {
  if (!isCockpitAuthRequired()) {
    return true;
  }
  const cookieStore = await cookies();
  return isValidCockpitSessionCookie(cookieStore.get(SESSION_COOKIE)?.value);
}

export async function requireCockpitAccess(nextPath: string) {
  if (await hasValidCockpitSession()) {
    return;
  }
  redirect(`/login?next=${encodeURIComponent(nextPath)}`);
}

export { SESSION_COOKIE };
