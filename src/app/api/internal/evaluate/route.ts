import { NextResponse } from "next/server";

import { evaluateSignalOpsTenantV1 } from "@/lib/signalops/v1/evaluator";
import { authorizeSignalOpsCronRequestV1 } from "@/lib/signalops/v1/internal-auth";
import { listActiveSignalOpsTenantsV1 } from "@/lib/signalops/v1/operator-directory";
import { applySignalOpsRetentionV1 } from "@/lib/signalops/v1/retention";
import { configuredSignalOpsTenantV1 } from "@/lib/signalops/v1/session";
import { getSignalOpsSupabaseConfigV1 } from "@/lib/signalops/v1/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const requestId = `req_${crypto.randomUUID()}`;
  if (!authorizeSignalOpsCronRequestV1(request)) {
    return NextResponse.json(
      { ok: false, requestId, code: "unauthorized" },
      { status: 401, headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  }
  try {
    const hostedTenants = await listActiveSignalOpsTenantsV1();
    const localTenant = configuredSignalOpsTenantV1();
    const tenants = getSignalOpsSupabaseConfigV1()
      ? hostedTenants
      : [{ tenantId: localTenant.id, tenantName: localTenant.name }];
    let transitions = 0;
    for (const tenant of tenants) {
      transitions += (await evaluateSignalOpsTenantV1(tenant)).transitions;
    }
    const retention = await applySignalOpsRetentionV1();
    return NextResponse.json(
      { ok: true, requestId, tenantsEvaluated: tenants.length, transitions, retention },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    console.error("[SignalOps] scheduled evaluation failed", { requestId, error });
    return NextResponse.json(
      { ok: false, requestId, code: "evaluation_failed" },
      { status: 503, headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  }
}
