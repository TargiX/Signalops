import { NextResponse } from "next/server";

import { isSignalOpsCronAuthConfiguredV1 } from "@/lib/signalops/v1/internal-auth";
import { isSignalOpsRateLimitingConfiguredV1 } from "@/lib/signalops/v1/rate-limit";
import { isSignalOpsRetentionConfiguredV1 } from "@/lib/signalops/v1/retention";
import { getSignalOpsRuntimeStoreV1, signalOpsStorageModeV1 } from "@/lib/signalops/v1/runtime";
import {
  configuredSignalOpsTenantV1,
  isSignalOpsOperatorAuthConfiguredV1,
} from "@/lib/signalops/v1/session";
import {
  getSignalOpsSupabaseAuthConfigV1,
  isSignalOpsEmailOtpEnabledV1,
  isSignalOpsSupabaseAuthConfiguredV1,
  signalOpsAllowedAuthProvidersV1,
} from "@/lib/signalops/v1/supabase-auth";
import {
  getSignalOpsSupabaseConfigV1,
  signalOpsSupabaseRestRequestV1,
} from "@/lib/signalops/v1/supabase";

export const runtime = "nodejs";

type HostedState = {
  schema: boolean;
  activeTenant: boolean;
  activeCredential: boolean;
  operatorMembership: boolean;
};

async function hostedOperationalState(): Promise<HostedState> {
  const config = getSignalOpsSupabaseConfigV1();
  const empty = { schema: false, activeTenant: false, activeCredential: false, operatorMembership: false };
  if (!config) return empty;
  try {
    const now = new Date().toISOString();
    const credentialFilters = new URLSearchParams({
      select: "id",
      revoked_at: "is.null",
      or: `(expires_at.is.null,expires_at.gt.${now})`,
      limit: "1",
    });
    const [projections, incidents, tenants, credentials, memberships] = await Promise.all([
      signalOpsSupabaseRestRequestV1(
        config,
        "signalops_v1_projection_snapshots?select=tenant_id&limit=1",
      ),
      signalOpsSupabaseRestRequestV1(
        config,
        "signalops_v1_incidents?select=tenant_id&limit=1",
      ),
      signalOpsSupabaseRestRequestV1<Array<{ id: string }>>(
        config,
        "signalops_v1_tenants?select=id&status=eq.active&limit=1",
      ),
      signalOpsSupabaseRestRequestV1<Array<{ id: string }>>(
        config,
        `signalops_v1_ingest_credentials?${credentialFilters}`,
      ),
      signalOpsSupabaseRestRequestV1<Array<{ tenant_id: string }>>(
        config,
        "signalops_v1_operator_memberships?select=tenant_id&limit=1",
      ),
    ]);
    return {
      schema: Array.isArray(projections) && Array.isArray(incidents),
      activeTenant: tenants.length > 0,
      activeCredential: credentials.length > 0,
      operatorMembership: memberships.length > 0,
    };
  } catch {
    return empty;
  }
}

export async function GET() {
  const storage = signalOpsStorageModeV1();
  const passwordAuth = isSignalOpsOperatorAuthConfiguredV1();
  const supabaseAuth = isSignalOpsSupabaseAuthConfiguredV1();
  const emailOtp = isSignalOpsEmailOtpEnabledV1();
  const oauthProviders = signalOpsAllowedAuthProvidersV1();
  const rateLimiting = isSignalOpsRateLimitingConfiguredV1();
  const cronAuth = isSignalOpsCronAuthConfiguredV1();
  const retention = isSignalOpsRetentionConfiguredV1();
  const publicUrl = Boolean(process.env.SIGNALOPS_PUBLIC_URL?.trim());
  const alerting = Boolean(
    process.env.SIGNALOPS_ALERT_WEBHOOK_URL?.trim() &&
      (process.env.SIGNALOPS_ALERT_WEBHOOK_SECRET?.trim().length ?? 0) >= 32,
  );
  let storageReachable = false;
  if (storage !== "unavailable") {
    try {
      await getSignalOpsRuntimeStoreV1().watermark(configuredSignalOpsTenantV1().id);
      storageReachable = true;
    } catch {
      storageReachable = false;
    }
  }
  const hosted = storage === "supabase" ? await hostedOperationalState() : {
    schema: false,
    activeTenant: false,
    activeCredential: false,
    operatorMembership: false,
  };
  const bootstrapIngestAuth = Boolean(
    (process.env.NODE_ENV !== "production" ||
      process.env.SIGNALOPS_ALLOW_BOOTSTRAP_CREDENTIAL === "true") &&
      (process.env.SIGNALOPS_INGEST_TOKEN?.trim() ||
        process.env.SIGNALOPS_INGEST_TOKEN_HASH?.trim()),
  );
  const ingestAuth = storage === "supabase" ? hosted.activeCredential : bootstrapIngestAuth;
  const operatorAuth = passwordAuth || (supabaseAuth && (emailOtp || oauthProviders.length > 0));
  const localReady =
    storage !== "unavailable" && storageReachable && operatorAuth && ingestAuth;
  const productionReady =
    storage === "supabase" &&
    storageReachable &&
    hosted.schema &&
    hosted.activeTenant &&
    hosted.activeCredential &&
    hosted.operatorMembership &&
    Boolean(getSignalOpsSupabaseAuthConfigV1()) &&
    operatorAuth &&
    rateLimiting &&
    cronAuth &&
    retention &&
    publicUrl &&
    alerting &&
    ingestAuth;
  return NextResponse.json(
    {
      ok: process.env.NODE_ENV === "production" ? productionReady : localReady,
      productionReady,
      service: "signalops",
      contract: "ai-telemetry/v1",
      checks: {
        storage,
        storageReachable,
        hostedSchema: hosted.schema,
        hostedData: {
          activeTenant: hosted.activeTenant,
          activeCredential: hosted.activeCredential,
          operatorMembership: hosted.operatorMembership,
        },
        operatorAuth: {
          password: passwordAuth,
          supabase: supabaseAuth,
          emailOtp,
          oauthProviders,
        },
        ingestAuth,
        rateLimiting,
        cronAuth,
        retention,
        publicUrl,
        alerting,
      },
    },
    {
      status: process.env.NODE_ENV === "production"
        ? productionReady
          ? 200
          : 503
        : localReady
          ? 200
          : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
