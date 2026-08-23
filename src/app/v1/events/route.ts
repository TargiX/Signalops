import { after, NextResponse } from "next/server";

import { writeSignalOpsAuditEventV1 } from "@/lib/signalops/v1/audit";
import { resolveSignalOpsTenantPrincipalV1 } from "@/lib/signalops/v1/auth";
import { evaluateSignalOpsTenantV1 } from "@/lib/signalops/v1/evaluator";
import { SignalOpsHttpErrorV1, readSignalOpsJsonBodyV1 } from "@/lib/signalops/v1/http";
import { ingestSignalOpsEventsV1 } from "@/lib/signalops/v1/ingest";
import { getSignalOpsRuntimeStoreV1 } from "@/lib/signalops/v1/runtime";
import {
  enforceSignalOpsRateLimitV1,
  signalOpsRateLimitHeadersV1,
  SignalOpsRateLimitErrorV1,
  signalOpsRequestFingerprintV1,
} from "@/lib/signalops/v1/rate-limit";

export const runtime = "nodejs";

function response(
  body: unknown,
  status: number,
  requestId: string,
  headers: Record<string, string> = {},
) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-request-id": requestId, ...headers },
  });
}

export async function POST(request: Request) {
  const requestId = `req_${crypto.randomUUID()}`;
  try {
    await enforceSignalOpsRateLimitV1({
      scope: "ingest-origin",
      identifier: signalOpsRequestFingerprintV1(request),
      limit: 120,
      windowSeconds: 60,
    });
    const principal = await resolveSignalOpsTenantPrincipalV1(request);
    if (!principal) {
      return response(
        { ok: false, requestId, code: "unauthorized", message: "A valid tenant ingest credential is required." },
        401,
        requestId,
      );
    }
    const decision = await enforceSignalOpsRateLimitV1({
      scope: "ingest-credential",
      identifier: `${principal.tenantId}:${principal.credentialId}`,
      limit: Number(process.env.SIGNALOPS_INGEST_RATE_LIMIT_MAX ?? 600),
      windowSeconds: Number(process.env.SIGNALOPS_INGEST_RATE_LIMIT_WINDOW_SECONDS ?? 60),
    });
    const receipt = await ingestSignalOpsEventsV1({
      principal,
      payload: await readSignalOpsJsonBodyV1(request),
      store: getSignalOpsRuntimeStoreV1(),
    });
    if (receipt.conflictEvents > 0) {
      void writeSignalOpsAuditEventV1({
        tenantId: principal.tenantId,
        actorSubject: `credential:${principal.credentialId}`,
        action: "ingest.idempotency_conflict",
        requestId,
        metadata: { conflictCount: receipt.conflictEvents },
      }).catch(() => undefined);
    }
    if (receipt.storedEvents > 0 || receipt.conflictEvents > 0) {
      after(async () => {
        try {
          await evaluateSignalOpsTenantV1({
            tenantId: principal.tenantId,
            tenantName: principal.tenantId,
          });
        } catch (error) {
          console.error("[SignalOps] post-ingest evaluation failed", {
            requestId,
            tenantId: principal.tenantId,
            error,
          });
        }
      });
    }
    return response(
      { ok: true, requestId, receipt },
      200,
      requestId,
      signalOpsRateLimitHeadersV1(decision),
    );
  } catch (error) {
    if (error instanceof SignalOpsRateLimitErrorV1) {
      return response(
        { ok: false, requestId, code: "rate_limited", message: "Rate limit exceeded." },
        429,
        requestId,
        signalOpsRateLimitHeadersV1(error.decision),
      );
    }
    if (error instanceof SignalOpsHttpErrorV1) {
      return response(
        { ok: false, requestId, code: error.code, message: error.message },
        error.status,
        requestId,
      );
    }
    if (error instanceof RangeError || error instanceof TypeError) {
      return response(
        { ok: false, requestId, code: "invalid_batch", message: error.message },
        400,
        requestId,
      );
    }
    console.error("[SignalOps] canonical ingest failed", { requestId, error });
    return response(
      { ok: false, requestId, code: "storage_unavailable", message: "SignalOps storage is unavailable." },
      503,
      requestId,
    );
  }
}
