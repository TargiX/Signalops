import { NextResponse } from "next/server";

import {
  isCockpitAuthRequired,
  isCockpitSessionSecretConfigured,
  isOperatorAccessConfigured,
  isOperatorAccessPilotReady,
  isOperatorApiTokenConfigured,
} from "@/lib/signalops/auth";
import {
  readPilotRequestMaxBodyBytes,
  readSignalOpsDeliveryTimeoutMs,
  readSignalOpsRateLimitPolicy,
} from "@/lib/signalops/http";
import {
  isProductionRuntime,
  isSourceIngestTokenConfigured,
  sourceIngestAllowsEphemeralStorage,
} from "@/lib/signalops/ingest-auth";
import { readSignalOpsIngestPolicy } from "@/lib/signalops/ingest-policy";
import {
  isPilotAlertWebhookFallbackConfigured,
  isPilotEmailDeliveryConfigured,
  isPilotEphemeralIntakeAllowed,
  isPilotWebhookDeliveryConfigured,
} from "@/lib/signalops/pilot-intake-readiness";
import { isConfiguredPublicBaseUrl } from "@/lib/signalops/runtime-config";
import { getSignalOpsStore, getStoreHealth, getWorkspaceIdentity, getWorkspaceSlug } from "@/lib/signalops/store";

export const runtime = "nodejs";

export async function GET() {
  const storage = getStoreHealth();
  const workspaceSlug = getWorkspaceSlug();
  const workspaceIdentity = getWorkspaceIdentity();
  const ingestPolicy = readSignalOpsIngestPolicy();
  const ingestProtected = isSourceIngestTokenConfigured();
  const productionRuntime = isProductionRuntime();
  const pilotWebhookReady = isPilotWebhookDeliveryConfigured();
  const alertWebhookConfigured = isPilotAlertWebhookFallbackConfigured();
  const pilotEmailReady = isPilotEmailDeliveryConfigured();
  const pilotEphemeralIntakeReady = isPilotEphemeralIntakeAllowed();
  const pilotRequestMaxBodyBytes = readPilotRequestMaxBodyBytes();
  const rateLimitPolicy = readSignalOpsRateLimitPolicy();
  const publicBaseUrl = process.env.SIGNALOPS_PUBLIC_BASE_URL || process.env.SIGNALOPS_BASE_URL || "";
  const publicBaseUrlReady = isConfiguredPublicBaseUrl(publicBaseUrl);
  const pilotIntakeReady =
    (storage.durable && storage.ready) ||
    pilotWebhookReady ||
    alertWebhookConfigured ||
    pilotEmailReady ||
    pilotEphemeralIntakeReady;
  const allowEphemeralIngest = sourceIngestAllowsEphemeralStorage();
  const eventIngestReady =
    (storage.durable && storage.ready && ingestProtected && workspaceIdentity.pilotReady) ||
    (allowEphemeralIngest && (ingestProtected || !productionRuntime));
  const operatorAccessConfigured = isOperatorAccessConfigured();
  const operatorAccessReady = isOperatorAccessPilotReady();
  let firstSourceEvent = {
    ready: false,
    durable: storage.durable && storage.ready,
    checked: false,
    workspaceSlug,
    error: undefined as string | undefined,
  };
  if (storage.durable && storage.ready) {
    firstSourceEvent = { ...firstSourceEvent, checked: true };
    try {
      const events = await getSignalOpsStore().listEvents(workspaceSlug, 1);
      firstSourceEvent = { ...firstSourceEvent, ready: events.length > 0 };
    } catch (error) {
      firstSourceEvent = {
        ...firstSourceEvent,
        error: error instanceof Error ? error.message : "source event read failed",
      };
    }
  }

  return NextResponse.json(
    {
      ok: true,
      service: "signalops",
      storage,
      publicBaseUrl: {
        ready: publicBaseUrlReady,
        url: publicBaseUrl,
        requiresHttps: true,
      },
      eventValidation: {
        ready: true,
        requiresAuth: false,
        storesEvents: false,
        rateLimit: {
          mode: rateLimitPolicy.mode,
          windowMs: rateLimitPolicy.windowMs,
          limit: rateLimitPolicy.buckets.event_validation,
        },
      },
      eventIngest: {
        ready: eventIngestReady,
        requiresAuth: ingestProtected || productionRuntime,
        durable: storage.durable && storage.ready,
        allowsEphemeralStorage: allowEphemeralIngest,
        alertWebhook: alertWebhookConfigured,
        policy: ingestPolicy,
        rateLimit: {
          mode: rateLimitPolicy.mode,
          windowMs: rateLimitPolicy.windowMs,
          limit: rateLimitPolicy.buckets.event_ingest,
        },
      },
      workspace: workspaceIdentity,
      privacy: {
        ready: ingestPolicy.privacyMode === "redact",
        mode: ingestPolicy.privacyMode,
        defaultRedactsSensitiveFields: true,
        sensitiveFields: ["user", "prompt"],
      },
      pilotIntake: {
        ready: pilotIntakeReady,
        durable: storage.durable && storage.ready,
        webhook: pilotWebhookReady,
        alertWebhookFallback: alertWebhookConfigured,
        email: pilotEmailReady,
        allowsEphemeralStorage: pilotEphemeralIntakeReady,
        maxBodyBytes: pilotRequestMaxBodyBytes,
        maxBodyKb: Math.round(pilotRequestMaxBodyBytes / 1024),
        deliveryTimeoutMs: readSignalOpsDeliveryTimeoutMs(),
        rateLimit: {
          mode: rateLimitPolicy.mode,
          windowMs: rateLimitPolicy.windowMs,
          limit: rateLimitPolicy.buckets.pilot_request,
        },
        acceptedContentTypes: ["application/json", "application/x-www-form-urlencoded", "multipart/form-data"],
      },
      cockpitAccess: {
        requiresAuth: isCockpitAuthRequired(),
        sessionSecret: isCockpitSessionSecretConfigured(),
        operatorApiToken: isOperatorApiTokenConfigured(),
        sessionCookie: "httpOnly",
        pilotReady: operatorAccessReady,
      },
      firstSourceEvent,
      nextExternalSteps: [
        ...(publicBaseUrlReady ? [] : ["set_signalops_public_base_url"]),
        ...(storage.durable && storage.ready ? [] : ["connect_cloudflare_d1_or_approved_database"]),
        ...(workspaceIdentity.pilotReady ? [] : ["set_signalops_workspace_slug"]),
        ...(operatorAccessReady ? [] : [operatorAccessConfigured ? "set_cockpit_session_secret" : "set_operator_access"]),
        ...(ingestProtected ? [] : ["set_signalops_ingest_token"]),
        ...(ingestPolicy.privacyMode === "redact" ? [] : ["set_signalops_event_privacy_mode_redact"]),
        ...(pilotIntakeReady ? [] : ["connect_pilot_request_delivery"]),
        ...(firstSourceEvent.ready ? [] : ["send_first_real_source_event"]),
      ],
    },
    { status: 200 },
  );
}
