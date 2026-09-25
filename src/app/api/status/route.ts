import { NextResponse } from "next/server";

import {
  isCockpitAuthRequired,
  isCockpitSessionSecretConfigured,
  isOperatorAccessConfigured,
  isOperatorAccessPilotReady,
  isOperatorApiTokenConfigured,
} from "@/lib/signalops/auth";
import {
  isSourceIngestTokenConfigured,
  sourceIngestAllowsUnauthenticated,
} from "@/lib/signalops/ingest-auth";
import {
  readPilotRequestMaxBodyBytes,
  readSignalOpsDeliveryTimeoutMs,
  readSignalOpsRateLimitPolicy,
} from "@/lib/signalops/http";
import { readSignalOpsIngestPolicy } from "@/lib/signalops/ingest-policy";
import {
  isPilotAlertWebhookFallbackConfigured,
  isPilotEmailDeliveryConfigured,
  isPilotWebhookDeliveryConfigured,
} from "@/lib/signalops/pilot-intake-readiness";
import { isConfiguredPublicBaseUrl } from "@/lib/signalops/runtime-config";
import { getSignalOpsStore, getStoreHealth, getWorkspaceIdentity, getWorkspaceSlug } from "@/lib/signalops/store";

export const runtime = "nodejs";

export async function GET() {
  const store = getStoreHealth();
  const ingestProtected = isSourceIngestTokenConfigured();
  const unauthenticatedDevIngest = sourceIngestAllowsUnauthenticated();
  const durableStorageReady = store.durable && store.ready;
  const operatorAccessConfigured = isOperatorAccessConfigured();
  const operatorAccessReady = isOperatorAccessPilotReady();
  const workspaceIdentity = getWorkspaceIdentity();
  const ingestPolicy = readSignalOpsIngestPolicy();
  const rateLimitPolicy = readSignalOpsRateLimitPolicy();
  const pilotRequestMaxBodyBytes = readPilotRequestMaxBodyBytes();
  const privacyReady = ingestPolicy.privacyMode === "redact";
  const publicBaseUrl = process.env.SIGNALOPS_PUBLIC_BASE_URL || process.env.SIGNALOPS_BASE_URL || "";
  const publicBaseUrlReady = isConfiguredPublicBaseUrl(publicBaseUrl);
  const canAcceptSourceEvents = durableStorageReady && ingestProtected && workspaceIdentity.pilotReady && privacyReady;
  const canAcceptPilotRequests = Boolean(
    (store.durable && store.ready) ||
      isPilotWebhookDeliveryConfigured() ||
      isPilotAlertWebhookFallbackConfigured() ||
      isPilotEmailDeliveryConfigured(),
  );
  let firstRealSourceTraffic = false;
  if (durableStorageReady) {
    try {
      const events = await getSignalOpsStore().listEvents(getWorkspaceSlug(), 1);
      firstRealSourceTraffic = events.length > 0;
    } catch {
      firstRealSourceTraffic = false;
    }
  }
  const stage =
    canAcceptSourceEvents &&
      publicBaseUrlReady &&
      operatorAccessReady &&
      workspaceIdentity.pilotReady &&
      privacyReady &&
      canAcceptPilotRequests &&
      firstRealSourceTraffic
      ? "pilot_setup"
      : "hosted_demo";
  const offer =
    stage === "pilot_setup"
      ? "Controlled pilot setup for AI generation products that want provider, latency, failure, and cost visibility."
      : canAcceptSourceEvents || canAcceptPilotRequests || operatorAccessConfigured
        ? "Partially connected pilot infrastructure; SignalOps stays in hosted_demo until public URLs, durable storage, protected ingest, real workspace identity, redacted privacy mode, separated operator/source secrets, pilot delivery, and first real source traffic are all proven."
        : "Interactive hosted demo plus a public event validator; durable ingest and pilot intake are not connected on this deployment yet.";

  return NextResponse.json({
    product: "SignalOps",
    stage,
    canValidateEvents: true,
    canAcceptPilotRequests,
    canAcceptSourceEvents,
    canClaimProductionReady: false,
    storage: store,
    requirements: {
      durableStorage: durableStorageReady,
      pilotIntake: canAcceptPilotRequests,
      ingestAuth: ingestProtected,
      workspace: workspaceIdentity,
      privacyMode: ingestPolicy.privacyMode,
      redactsSensitiveFields: privacyReady,
      firstRealSourceTraffic,
      unauthenticatedDevIngest,
      cockpitAuth: isCockpitAuthRequired(),
      cockpitSessionSecret: isCockpitSessionSecretConfigured(),
      operatorApiToken: isOperatorApiTokenConfigured(),
      operatorAccess: operatorAccessReady,
      operatorAccessConfigured,
      publicBaseUrl,
      publicBaseUrlReady,
      pilotRequestMaxBodyBytes,
      pilotRequestMaxBodyKb: Math.round(pilotRequestMaxBodyBytes / 1024),
      deliveryTimeoutMs: readSignalOpsDeliveryTimeoutMs(),
      rateLimitPolicy,
    },
    offer,
  });
}
