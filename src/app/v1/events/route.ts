import { NextResponse } from "next/server";

import { resolveSignalOpsTenantPrincipalV1 } from "@/lib/signalops/v1/auth";
import { SignalOpsHttpErrorV1, readSignalOpsJsonBodyV1 } from "@/lib/signalops/v1/http";
import { ingestSignalOpsEventsV1 } from "@/lib/signalops/v1/ingest";
import { getSignalOpsRuntimeStoreV1 } from "@/lib/signalops/v1/runtime";

export const runtime = "nodejs";

function response(body: unknown, status: number, requestId: string) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-request-id": requestId },
  });
}

export async function POST(request: Request) {
  const requestId = `req_${crypto.randomUUID()}`;
  try {
    const principal = await resolveSignalOpsTenantPrincipalV1(request);
    if (!principal) {
      return response(
        { ok: false, requestId, code: "unauthorized", message: "A valid tenant ingest credential is required." },
        401,
        requestId,
      );
    }
    const receipt = await ingestSignalOpsEventsV1({
      principal,
      payload: await readSignalOpsJsonBodyV1(request),
      store: getSignalOpsRuntimeStoreV1(),
    });
    return response({ ok: true, requestId, receipt, rejected: receipt.rejected }, 200, requestId);
  } catch (error) {
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
