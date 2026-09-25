import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";

import {
  buildPilotRequestOperatorSummary,
  filterPilotRequestsForOperator,
  isPilotRequestSpamTrapTriggered,
  normalizePilotRequest,
  normalizePilotRequestLifecycleUpdate,
  pilotRequestToFallbackPackage,
  pilotRequestToWebhookPayload,
  type PilotRequest,
  type PilotRequestFollowUpFilter,
  type PilotRequestOperatorFilters,
  type PilotRequestStatus,
} from "@/lib/signalops/pilot-requests";
import { hasValidCockpitSessionFromRequest, isOperatorAccessPilotReady } from "@/lib/signalops/auth";
import {
  acceptsJson,
  acceptsPilotRequestBody,
  checkSignalOpsRateLimit,
  fetchWithTimeout,
  payloadTooLargeBody,
  rateLimitedBody,
  readSignalOpsDeliveryTimeoutMs,
  requestContentType,
  readPilotRequestMaxBodyBytes,
  requestContentLengthExceeds,
  unsupportedMediaTypeBody,
  utf8ByteLength,
} from "@/lib/signalops/http";
import { isProductionRuntime } from "@/lib/signalops/ingest-auth";
import {
  getPilotEmailDeliveryConfig,
  isPilotAlertWebhookFallbackConfigured,
  isPilotEmailDeliveryConfigured,
  isPilotEphemeralIntakeAllowed,
  isPilotWebhookDeliveryConfigured,
} from "@/lib/signalops/pilot-intake-readiness";
import { hasConfiguredSecret, isConfiguredDeliveryUrl } from "@/lib/signalops/runtime-config";
import { getSignalOpsStore, getStoreHealth } from "@/lib/signalops/store";

export const runtime = "nodejs";

type DeliveryResult = {
  target: "storage" | "ephemeral_storage" | "webhook" | "alert_webhook" | "email";
  ok: boolean;
  deliveryId: string;
  attemptedAt: string;
  durationMs?: number;
  status?: number;
  signed?: boolean;
  error?: string;
};

function requestId() {
  return `req_${crypto.randomUUID()}`;
}

function deliveryId(target: DeliveryResult["target"]) {
  return `del_${target}_${crypto.randomUUID()}`;
}

async function parseBody(request: Request) {
  const contentType = requestContentType(request);

  if (contentType.includes("application/json")) {
    return JSON.parse(await request.text());
  }

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const formData = await request.formData();
    return Object.fromEntries(formData.entries());
  }

  throw new Error("content-type must be application/json or form data");
}

function signPayload(payload: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

async function deliverWebhook(request: PilotRequest, options: { baseUrl: string }): Promise<DeliveryResult | null> {
  const pilotWebhookUrl = isConfiguredDeliveryUrl(process.env.SIGNALOPS_PILOT_REQUEST_WEBHOOK_URL)
    ? process.env.SIGNALOPS_PILOT_REQUEST_WEBHOOK_URL
    : undefined;
  const alertWebhookUrl = isConfiguredDeliveryUrl(process.env.SIGNALOPS_ALERT_WEBHOOK_URL)
    ? process.env.SIGNALOPS_ALERT_WEBHOOK_URL
    : undefined;
  const url = pilotWebhookUrl || alertWebhookUrl;
  if (!url) {
    return null;
  }

  const payload = JSON.stringify(pilotRequestToWebhookPayload(request, { baseUrl: options.baseUrl }));
  const secret = hasConfiguredSecret(process.env.SIGNALOPS_PILOT_REQUEST_WEBHOOK_SECRET)
    ? process.env.SIGNALOPS_PILOT_REQUEST_WEBHOOK_SECRET
    : hasConfiguredSecret(process.env.SIGNALOPS_ALERT_WEBHOOK_SECRET)
      ? process.env.SIGNALOPS_ALERT_WEBHOOK_SECRET
      : undefined;
  const id = deliveryId(pilotWebhookUrl ? "webhook" : "alert_webhook");
  const attemptedAt = new Date().toISOString();
  const startedAt = Date.now();
  const timeoutMs = readSignalOpsDeliveryTimeoutMs();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-signalops-delivery-id": id,
    "x-signalops-event": "pilot.requested",
  };
  const target = pilotWebhookUrl ? "webhook" : "alert_webhook";

  if (secret) {
    headers["x-signalops-signature"] = signPayload(payload, secret);
  }

  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers,
      body: payload,
    }, timeoutMs);

    return {
      target,
      ok: response.ok,
      deliveryId: id,
      attemptedAt,
      durationMs: Date.now() - startedAt,
      status: response.status,
      signed: Boolean(secret),
      error: response.ok ? undefined : `webhook responded with ${response.status}`,
    };
  } catch (error) {
    return {
      target,
      ok: false,
      deliveryId: id,
      attemptedAt,
      durationMs: Date.now() - startedAt,
      signed: Boolean(secret),
      error:
        error instanceof Error && error.name === "AbortError"
          ? `webhook delivery timed out after ${timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : "webhook delivery failed",
    };
  }
}

async function deliverEmail(request: PilotRequest): Promise<DeliveryResult | null> {
  const config = getPilotEmailDeliveryConfig();
  if (!config) {
    return null;
  }
  const id = deliveryId("email");
  const attemptedAt = new Date().toISOString();
  const startedAt = Date.now();
  const timeoutMs = readSignalOpsDeliveryTimeoutMs();

  const text = [
    "New SignalOps pilot request",
    "",
    `Name: ${request.name}`,
    `Email: ${request.email}`,
    `Company: ${request.company ?? "-"}`,
    `Product URL: ${request.productUrl ?? "-"}`,
    `Generation volume: ${request.generationVolume ?? "-"}`,
    `Providers: ${request.providers ?? "-"}`,
    `Primary pain: ${request.primaryPain ?? "-"}`,
    `Urgency: ${request.urgency ?? "-"}`,
    `Desired outcome: ${request.desiredOutcome ?? "-"}`,
    `Qualification: ${request.qualification.tier}`,
    `Signals: ${request.qualification.signals.join(", ") || "-"}`,
    `Source: ${request.source}`,
    "",
    request.useCase,
  ].join("\n");

  try {
    const response = await fetchWithTimeout(
      "https://api.resend.com/emails",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: config.from,
          to: config.to,
          subject: `SignalOps pilot request: ${request.company ?? request.name}`,
          text,
        }),
      },
      timeoutMs,
    );

    return {
      target: "email",
      ok: response.ok,
      deliveryId: id,
      attemptedAt,
      durationMs: Date.now() - startedAt,
      status: response.status,
      error: response.ok ? undefined : `email provider responded with ${response.status}`,
    };
  } catch (error) {
    return {
      target: "email",
      ok: false,
      deliveryId: id,
      attemptedAt,
      durationMs: Date.now() - startedAt,
      error:
        error instanceof Error && error.name === "AbortError"
          ? `email delivery timed out after ${timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : "email delivery failed",
    };
  }
}

function fallbackEmail() {
  return process.env.SIGNALOPS_PILOT_FALLBACK_EMAIL || process.env.NEXT_PUBLIC_SIGNALOPS_PILOT_FALLBACK_EMAIL || null;
}

function readLimit(request: Request) {
  const value = Number(new URL(request.url).searchParams.get("limit") ?? "25");
  if (!Number.isFinite(value)) {
    return 25;
  }

  return Math.max(1, Math.min(Math.floor(value), 100));
}

function readFilters(request: Request): PilotRequestOperatorFilters {
  const params = new URL(request.url).searchParams;
  const status = params.get("status");
  const tier = params.get("tier");
  const followUp = params.get("followUp");

  return {
    status:
      status === "new" || status === "contacted" || status === "pilot_scoped" || status === "closed"
        ? (status as PilotRequestStatus)
        : undefined,
    tier:
      tier === "evaluate" || tier === "strong_fit" || tier === "urgent_fit"
        ? (tier as PilotRequest["qualification"]["tier"])
        : undefined,
    followUp:
      followUp === "open" || followUp === "due" || followUp === "unscheduled" || followUp === "all"
        ? (followUp as PilotRequestFollowUpFilter)
        : undefined,
  };
}

function csvValue(value: unknown) {
  const raw = value == null ? "" : String(value);
  const text = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function pilotRequestsCsv(requests: PilotRequest[]) {
  const columns = [
    "id",
    "created_at",
    "status",
    "qualification_tier",
    "name",
    "email",
    "company",
    "product_url",
    "generation_volume",
    "providers",
    "urgency",
    "next_action_at",
    "operator_note",
    "latest_activity",
  ];
  const rows = requests.map((request) => [
    request.id,
    request.createdAt,
    request.lifecycle?.status ?? "new",
    request.qualification.tier,
    request.name,
    request.email,
    request.company,
    request.productUrl,
    request.generationVolume,
    request.providers,
    request.urgency,
    request.lifecycle?.nextActionAt,
    request.lifecycle?.operatorNote,
    request.activity?.at(-1)?.summary,
  ]);

  return [columns.join(","), ...rows.map((row) => row.map(csvValue).join(","))].join("\r\n");
}

function productionOperatorAuthIsMissing() {
  return isProductionRuntime() && !isOperatorAccessPilotReady();
}

function allowsEphemeralPilotIntake() {
  return isPilotEphemeralIntakeAllowed();
}

function assertOperatorAccess(request: Request, id: string) {
  if (productionOperatorAuthIsMissing()) {
    return NextResponse.json(
      {
        ok: false,
        code: "operator_auth_not_configured",
        error: "operator auth must be configured before reading pilot requests in production",
        requestId: id,
      },
      { status: 503 },
    );
  }

  if (!hasValidCockpitSessionFromRequest(request)) {
    return NextResponse.json(
      {
        ok: false,
        code: "unauthorized",
        error: "operator session required",
        requestId: id,
      },
      { status: 401 },
    );
  }

  return null;
}

export async function GET(request: Request) {
  const id = requestId();
  const authError = assertOperatorAccess(request, id);
  if (authError) {
    return authError;
  }

  const limit = readLimit(request);
  const filters = readFilters(request);
  const format = new URL(request.url).searchParams.get("format");
  const storage = getStoreHealth();

  try {
    const allPilotRequests = await getSignalOpsStore().listPilotRequests(100);
    const pilotRequests = filterPilotRequestsForOperator(allPilotRequests, filters).slice(0, limit);
    const summary = buildPilotRequestOperatorSummary(pilotRequests);
    if (format === "csv") {
      return new Response(pilotRequestsCsv(pilotRequests), {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="signalops-pilot-requests.csv"',
        },
      });
    }

    return NextResponse.json({
      ok: true,
      storage,
      limit,
      filters,
      count: pilotRequests.length,
      summary,
      pilotRequests,
      requestId: id,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code: "pilot_request_read_failed",
        error: error instanceof Error ? error.message : "pilot request read failed",
        storage,
        requestId: id,
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const id = requestId();
  const authError = assertOperatorAccess(request, id);
  if (authError) {
    return authError;
  }

  if (!acceptsJson(request)) {
    return NextResponse.json(unsupportedMediaTypeBody(id, ["application/json"]), { status: 415 });
  }

  let update: ReturnType<typeof normalizePilotRequestLifecycleUpdate>;
  try {
    update = normalizePilotRequestLifecycleUpdate(await parseBody(request));
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code: "invalid_pilot_request_lifecycle_update",
        error: error instanceof Error ? error.message : "invalid lifecycle update",
        requestId: id,
      },
      { status: 422 },
    );
  }

  const storage = getStoreHealth();
  try {
    const pilotRequest = await getSignalOpsStore().updatePilotRequestLifecycle(update);
    if (!pilotRequest) {
      return NextResponse.json(
        {
          ok: false,
          code: "pilot_request_not_found",
          error: "pilot request was not found",
          storage,
          requestId: id,
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      storage,
      pilotRequest,
      requestId: id,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code: "pilot_request_update_failed",
        error: error instanceof Error ? error.message : "pilot request update failed",
        storage,
        requestId: id,
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const id = requestId();
  const requestUrl = new URL(request.url);
  const baseUrl = process.env.SIGNALOPS_PUBLIC_BASE_URL || process.env.SIGNALOPS_BASE_URL || requestUrl.origin;
  const maxBodyBytes = readPilotRequestMaxBodyBytes();

  if (!acceptsPilotRequestBody(request)) {
    return NextResponse.json(
      unsupportedMediaTypeBody(id, ["application/json", "application/x-www-form-urlencoded", "multipart/form-data"]),
      { status: 415 },
    );
  }

  if (requestContentLengthExceeds(request, maxBodyBytes)) {
    return NextResponse.json(payloadTooLargeBody(id, maxBodyBytes), { status: 413 });
  }

  const rateLimit = checkSignalOpsRateLimit(request, "pilot_request");
  if (rateLimit.limited) {
    return NextResponse.json(rateLimitedBody(id, rateLimit), {
      status: 429,
      headers: rateLimit.headers,
    });
  }

  let rawPilotRequest: unknown;
  let pilotRequest: PilotRequest;
  try {
    const contentType = requestContentType(request);
    if (contentType.includes("multipart/form-data")) {
      rawPilotRequest = await parseBody(request);
    } else {
      const rawBody = await request.text();
      if (utf8ByteLength(rawBody) > maxBodyBytes) {
        return NextResponse.json(payloadTooLargeBody(id, maxBodyBytes), { status: 413 });
      }
      rawPilotRequest = contentType.includes("application/json")
        ? JSON.parse(rawBody)
        : Object.fromEntries(new URLSearchParams(rawBody).entries());
    }
    if (isPilotRequestSpamTrapTriggered(rawPilotRequest)) {
      return NextResponse.json(
        {
          ok: false,
          code: "spam_detected",
          error: "pilot request rejected",
          requestId: id,
        },
        { status: 422 },
      );
    }
    pilotRequest = normalizePilotRequest(rawPilotRequest);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code: "invalid_pilot_request",
        error: error instanceof Error ? error.message : "invalid pilot request",
        requestId: id,
      },
      { status: 422 },
    );
  }

  const storage = getStoreHealth();
  const canPersist = storage.durable && storage.ready;
  const canPersistEphemerally = allowsEphemeralPilotIntake();
  const hasWebhook = Boolean(isPilotWebhookDeliveryConfigured() || isPilotAlertWebhookFallbackConfigured());
  const hasEmail = isPilotEmailDeliveryConfigured();

  if (!canPersist && !canPersistEphemerally && !hasWebhook && !hasEmail) {
    return NextResponse.json(
      {
        ok: false,
        code: "pilot_intake_not_configured",
        fallbackEmail: fallbackEmail(),
        fallbackPackage: pilotRequestToFallbackPackage(pilotRequest, { baseUrl, requestId: id }),
        qualification: pilotRequest.qualification,
        requestId: id,
      },
      { status: 503 },
    );
  }

  const deliveries: DeliveryResult[] = [];

  if (canPersist || canPersistEphemerally) {
    const target = canPersist ? "storage" : "ephemeral_storage";
    const id = deliveryId(target);
    const attemptedAt = new Date().toISOString();
    const startedAt = Date.now();
    try {
      await getSignalOpsStore().storePilotRequest(pilotRequest);
      deliveries.push({ target, ok: true, deliveryId: id, attemptedAt, durationMs: Date.now() - startedAt });
    } catch (error) {
      deliveries.push({
        target,
        ok: false,
        deliveryId: id,
        attemptedAt,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "storage write failed",
      });
    }
  }

  const [webhookDelivery, emailDelivery] = await Promise.all([
    deliverWebhook(pilotRequest, { baseUrl }),
    deliverEmail(pilotRequest),
  ]);

  if (webhookDelivery) {
    deliveries.push(webhookDelivery);
  }

  if (emailDelivery) {
    deliveries.push(emailDelivery);
  }

  if (!deliveries.some((delivery) => delivery.ok)) {
    return NextResponse.json(
      {
        ok: false,
        code: "pilot_intake_delivery_failed",
        deliveries,
        fallbackEmail: fallbackEmail(),
        fallbackPackage: pilotRequestToFallbackPackage(pilotRequest, { baseUrl, requestId: id }),
        qualification: pilotRequest.qualification,
        requestId: id,
      },
      { status: 424 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      pilotRequestId: pilotRequest.id,
      qualification: pilotRequest.qualification,
      deliveries,
      requestId: id,
    },
    { status: 202 },
  );
}
