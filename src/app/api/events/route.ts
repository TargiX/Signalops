import { NextResponse } from "next/server";

import { dispatchSignalAlerts, evaluateSignalAlerts } from "@/lib/signalops/alerts";
import { normalizeSignalEventBatch, summarizeSignalEventValidation } from "@/lib/signalops/events";
import {
  acceptsJson,
  checkSignalOpsRateLimit,
  payloadTooLargeBody,
  rateLimitedBody,
  requestContentLengthExceeds,
  unsupportedMediaTypeBody,
  utf8ByteLength,
} from "@/lib/signalops/http";
import {
  isProductionRuntime,
  isSourceIngestAuthorized,
  sourceIngestAllowsEphemeralStorage,
} from "@/lib/signalops/ingest-auth";
import { readSignalOpsIngestPolicy } from "@/lib/signalops/ingest-policy";
import { buildSourceEventReceipt } from "@/lib/signalops/ingest-receipt";
import { getSignalOpsStore, getStoreHealth, getWorkspaceIdentity, getWorkspaceSlug } from "@/lib/signalops/store";

export const runtime = "nodejs";

function requestId() {
  return `req_${crypto.randomUUID()}`;
}

export async function POST(request: Request) {
  const id = requestId();
  const policy = readSignalOpsIngestPolicy();

  if (!isSourceIngestAuthorized(request.headers)) {
    return NextResponse.json({ ok: false, code: "unauthorized", requestId: id }, { status: 401 });
  }

  if (!acceptsJson(request)) {
    return NextResponse.json(unsupportedMediaTypeBody(id, ["application/json"]), { status: 415 });
  }

  if (requestContentLengthExceeds(request, policy.maxBodyBytes)) {
    return NextResponse.json(payloadTooLargeBody(id, policy.maxBodyBytes), { status: 413 });
  }

  const rateLimit = checkSignalOpsRateLimit(request, "event_ingest");
  if (rateLimit.limited) {
    return NextResponse.json(rateLimitedBody(id, rateLimit), {
      status: 429,
      headers: rateLimit.headers,
    });
  }

  const storage = getStoreHealth();
  const allowEphemeralIngest = sourceIngestAllowsEphemeralStorage();

  if ((!storage.durable || !storage.ready) && !allowEphemeralIngest) {
    return NextResponse.json(
      {
        ok: false,
        code: "ingest_storage_not_configured",
        storage,
        requestId: id,
      },
      { status: 503 },
    );
  }

  const workspaceIdentity = getWorkspaceIdentity();
  if (isProductionRuntime() && !workspaceIdentity.pilotReady) {
    return NextResponse.json(
      {
        ok: false,
        code: "workspace_not_configured",
        workspace: workspaceIdentity,
        requestId: id,
      },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  if (utf8ByteLength(rawBody) > policy.maxBodyBytes) {
    return NextResponse.json(payloadTooLargeBody(id, policy.maxBodyBytes), { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, code: "invalid_json", requestId: id }, { status: 400 });
  }

  try {
    const batch = normalizeSignalEventBatch(body, policy.privacyMode, {
      maxBatchEvents: policy.maxBatchEvents,
    });
    if (batch.events.length === 0) {
      return NextResponse.json(
        { ok: false, code: "invalid_event", rejected: batch.rejected, requestId: id },
        { status: 422 },
      );
    }

    const workspaceSlug = getWorkspaceSlug();
    const result = await getSignalOpsStore().storeEvents(workspaceSlug, batch.events);
    const summary = summarizeSignalEventValidation(batch, policy.privacyMode);
    const alerts = evaluateSignalAlerts(batch.events);
    const alertDelivery = await dispatchSignalAlerts(alerts, { workspaceSlug, requestId: id });
    const receipt = buildSourceEventReceipt({
      requestId: id,
      workspaceSlug,
      events: batch.events,
      result,
      storage,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      receipt,
      diagnostics: summary.diagnostics,
      rejected: batch.rejected,
      ingestPolicy: policy,
      alerts: {
        evaluated: alerts.length,
        delivery: alertDelivery,
      },
      requestId: id,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code: "invalid_event",
        error: error instanceof Error ? error.message : "Invalid event payload",
        requestId: id,
      },
      { status: 422 },
    );
  }
}
