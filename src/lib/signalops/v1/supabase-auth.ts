import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export type SignalOpsSupabaseAuthConfigV1 = {
  url: string;
  publishableKey: string;
};

export function getSignalOpsSupabaseAuthConfigV1(): SignalOpsSupabaseAuthConfigV1 | null {
  const url = process.env.SUPABASE_URL?.trim();
  const publishableKey = (
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )?.trim();
  if (!url || !publishableKey || /YOUR_PROJECT/i.test(url)) return null;
  return { url: url.replace(/\/$/, ""), publishableKey };
}

export function isSignalOpsSupabaseAuthConfiguredV1(): boolean {
  return Boolean(getSignalOpsSupabaseAuthConfigV1());
}

export function isSignalOpsEmailOtpEnabledV1(): boolean {
  return isSignalOpsSupabaseAuthConfiguredV1() && process.env.SIGNALOPS_AUTH_EMAIL_OTP !== "false";
}

export function signalOpsAllowedAuthProvidersV1(): string[] {
  return (process.env.SIGNALOPS_AUTH_PROVIDERS ?? "")
    .split(",")
    .map((provider) => provider.trim())
    .filter((provider) => /^[a-z][a-z0-9:-]{0,49}$/.test(provider));
}

export async function createSignalOpsSupabaseServerClientV1() {
  const config = getSignalOpsSupabaseAuthConfigV1();
  if (!config) throw new Error("SignalOps Supabase Auth is not configured");
  const cookieStore = await cookies();
  return createServerClient(config.url, config.publishableKey, {
    auth: { flowType: "pkce" },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });
}

export async function getSignalOpsSupabaseUserV1(): Promise<User | null> {
  if (!isSignalOpsSupabaseAuthConfiguredV1()) return null;
  const client = await createSignalOpsSupabaseServerClientV1();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

export function signalOpsPublicOriginV1(request: Request): string {
  const configured = process.env.SIGNALOPS_PUBLIC_URL?.trim();
  if (process.env.NODE_ENV === "production" && !configured) {
    throw new Error("SIGNALOPS_PUBLIC_URL is required in production");
  }
  const candidate = configured || new URL(request.url).origin;
  const url = new URL(candidate);
  const local = url.hostname === "127.0.0.1" || url.hostname.endsWith(".localhost");
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && local)) {
    throw new Error("SIGNALOPS_PUBLIC_URL must use HTTPS in production");
  }
  return url.origin;
}
