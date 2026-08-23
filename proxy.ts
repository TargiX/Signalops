import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSignalOpsSupabaseAuthConfigV1 } from "@/lib/signalops/v1/supabase-auth";

export async function proxy(request: NextRequest) {
  const config = getSignalOpsSupabaseAuthConfigV1();
  let response = NextResponse.next({ request });
  response.headers.set("cache-control", "private, no-cache, no-store, must-revalidate");
  if (!config) return response;

  const client = createServerClient(config.url, config.publishableKey, {
    auth: { flowType: "pkce" },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, cacheHeaders) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(cacheHeaders)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  await client.auth.getClaims();
  return response;
}

export const config = {
  matcher: [
    "/cockpit/:path*",
    "/api/cockpit/:path*",
    "/v1/ops/:path*",
    "/v1/incidents/:path*",
  ],
};
