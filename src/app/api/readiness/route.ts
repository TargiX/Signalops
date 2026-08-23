import { NextResponse } from "next/server";

import { getSignalOpsRuntimeStoreV1, signalOpsStorageModeV1 } from "@/lib/signalops/v1/runtime";
import {
  configuredSignalOpsTenantV1,
  isSignalOpsOperatorAuthConfiguredV1,
} from "@/lib/signalops/v1/session";
import { getSignalOpsSupabaseConfigV1 } from "@/lib/signalops/v1/supabase";

export const runtime = "nodejs";

export async function GET() {
  const storage = signalOpsStorageModeV1();
  const operatorAuth = isSignalOpsOperatorAuthConfiguredV1();
  const ingestAuth = Boolean(
    process.env.SIGNALOPS_INGEST_TOKEN?.trim() ||
      process.env.SIGNALOPS_INGEST_TOKEN_HASH?.trim() ||
      getSignalOpsSupabaseConfigV1(),
  );
  let storageReachable = false;
  if (storage !== "unavailable") {
    try {
      await getSignalOpsRuntimeStoreV1().list(configuredSignalOpsTenantV1().id, { limit: 1 });
      storageReachable = true;
    } catch {
      storageReachable = false;
    }
  }
  const ready = storage !== "unavailable" && storageReachable && operatorAuth && ingestAuth;
  return NextResponse.json(
    {
      ok: ready,
      service: "signalops",
      contract: "ai-telemetry/v1",
      checks: { storage, storageReachable, operatorAuth, ingestAuth },
    },
    { status: ready ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
