import { NextResponse } from "next/server";

import {
  buildSignalOpsOpsSnapshotV1,
  rangeStartV1,
  type SignalOpsOpsRangeV1,
} from "@/lib/signalops/v1/ops-snapshot";
import { getSignalOpsRuntimeStoreV1 } from "@/lib/signalops/v1/runtime";
import { readSignalOpsOperatorSessionV1 } from "@/lib/signalops/v1/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = readSignalOpsOperatorSessionV1(request);
  if (!session) {
    return NextResponse.json(
      { ok: false, code: "operator_session_required" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  const requestedRange = new URL(request.url).searchParams.get("range");
  const range: SignalOpsOpsRangeV1 =
    requestedRange === "7d" || requestedRange === "30d" || requestedRange === "90d"
      ? requestedRange
      : "24h";
  try {
    const store = getSignalOpsRuntimeStoreV1();
    const records = await store.list(session.tenantId, {
      since: rangeStartV1(range),
      limit: 10_000,
    });
    const snapshot = buildSignalOpsOpsSnapshotV1({
      tenantId: session.tenantId,
      tenantName: session.tenantName,
      range,
      records,
    });
    return NextResponse.json(
      { ok: true, snapshot },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("[SignalOps] snapshot failed", { error });
    return NextResponse.json(
      { ok: false, code: "storage_unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
