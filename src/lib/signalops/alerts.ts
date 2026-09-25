import { createHmac } from "node:crypto";

import type { SignalEvent } from "./events";
import { hasConfiguredSecret, isConfiguredDeliveryUrl } from "./runtime-config.ts";

export type SignalAlert = {
  type: "generation_failed" | "generation_retrying" | "provider_health" | "cost_threshold";
  severity: "warning" | "critical";
  eventId: string;
  providerId?: string;
  modelId?: string;
  generationId?: string;
  message: string;
  occurredAt: string;
};

export type SignalAlertDelivery = {
  target: "webhook";
  ok: boolean;
  status?: number;
  error?: string;
  alertCount: number;
};

function costThreshold() {
  const value = Number(process.env.SIGNALOPS_ALERT_COST_THRESHOLD_USD);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function signPayload(payload: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

export function evaluateSignalAlerts(events: SignalEvent[], threshold = costThreshold()) {
  const alerts: SignalAlert[] = [];

  for (const event of events) {
    if (event.type === "generation.failed") {
      alerts.push({
        type: "generation_failed",
        severity: "critical",
        eventId: event.eventId,
        providerId: event.providerId,
        modelId: event.modelId,
        generationId: event.generationId,
        occurredAt: event.occurredAt,
        message: `Generation ${event.generationId ?? event.eventId} failed on ${event.providerId ?? "unknown provider"}.`,
      });
    }

    if (event.type === "generation.retrying" || event.status === "retrying") {
      alerts.push({
        type: "generation_retrying",
        severity: "warning",
        eventId: event.eventId,
        providerId: event.providerId,
        modelId: event.modelId,
        generationId: event.generationId,
        occurredAt: event.occurredAt,
        message: `Generation ${event.generationId ?? event.eventId} is retrying on ${event.providerId ?? "unknown provider"}.`,
      });
    }

    if (event.type === "provider.health") {
      alerts.push({
        type: "provider_health",
        severity: "warning",
        eventId: event.eventId,
        providerId: event.providerId,
        occurredAt: event.occurredAt,
        message: `Provider health event received for ${event.providerId ?? "unknown provider"}.`,
      });
    }

    if (threshold != null && event.cost != null && event.cost >= threshold) {
      alerts.push({
        type: "cost_threshold",
        severity: "warning",
        eventId: event.eventId,
        providerId: event.providerId,
        modelId: event.modelId,
        generationId: event.generationId,
        occurredAt: event.occurredAt,
        message: `Event ${event.eventId} reported cost $${event.cost.toFixed(4)}, above threshold $${threshold.toFixed(4)}.`,
      });
    }
  }

  return alerts;
}

export function alertWebhookReady() {
  return isConfiguredDeliveryUrl(process.env.SIGNALOPS_ALERT_WEBHOOK_URL);
}

export async function dispatchSignalAlerts(
  alerts: SignalAlert[],
  context: { workspaceSlug: string; requestId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SignalAlertDelivery | null> {
  const url = process.env.SIGNALOPS_ALERT_WEBHOOK_URL;
  if (alerts.length === 0 || !isConfiguredDeliveryUrl(url)) {
    return null;
  }
  const webhookUrl = url ?? "";

  const payload = JSON.stringify({
    type: "signalops.alerts",
    workspaceSlug: context.workspaceSlug,
    requestId: context.requestId,
    createdAt: new Date().toISOString(),
    alerts,
  });
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  const secret = process.env.SIGNALOPS_ALERT_WEBHOOK_SECRET;
  if (typeof secret === "string" && hasConfiguredSecret(secret)) {
    headers["x-signalops-signature"] = signPayload(payload, secret);
  }

  try {
    const response = await fetchImpl(webhookUrl, {
      method: "POST",
      headers,
      body: payload,
    });

    return {
      target: "webhook",
      ok: response.ok,
      status: response.status,
      error: response.ok ? undefined : `alert webhook responded with ${response.status}`,
      alertCount: alerts.length,
    };
  } catch (error) {
    return {
      target: "webhook",
      ok: false,
      error: error instanceof Error ? error.message : "alert webhook delivery failed",
      alertCount: alerts.length,
    };
  }
}
