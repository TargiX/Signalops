import { isProductionRuntime } from "./ingest-auth.ts";
import { firstConfiguredSecret, hasConfiguredSecret, isConfiguredDeliveryUrl } from "./runtime-config.ts";

type RuntimeEnv = Record<string, string | undefined>;

export function isPilotEphemeralIntakeAllowed(env: RuntimeEnv = process.env) {
  return env.SIGNALOPS_ALLOW_EPHEMERAL_PILOT_INTAKE === "true" && !isProductionRuntime(env);
}

export function isPilotWebhookDeliveryConfigured(env: RuntimeEnv = process.env) {
  return isConfiguredDeliveryUrl(env.SIGNALOPS_PILOT_REQUEST_WEBHOOK_URL, env);
}

export function isPilotAlertWebhookFallbackConfigured(env: RuntimeEnv = process.env) {
  return isConfiguredDeliveryUrl(env.SIGNALOPS_ALERT_WEBHOOK_URL, env);
}

export function getPilotEmailDeliveryConfig(env: RuntimeEnv = process.env) {
  const apiKey = firstConfiguredSecret(env.SIGNALOPS_RESEND_API_KEY, env.RESEND_API_KEY);
  const to = hasConfiguredSecret(env.SIGNALOPS_PILOT_REQUEST_EMAIL_TO)
    ? env.SIGNALOPS_PILOT_REQUEST_EMAIL_TO
    : undefined;
  const from = hasConfiguredSecret(env.SIGNALOPS_PILOT_REQUEST_EMAIL_FROM)
    ? env.SIGNALOPS_PILOT_REQUEST_EMAIL_FROM
    : undefined;

  return apiKey && to && from ? { apiKey, to, from } : null;
}

export function isPilotEmailDeliveryConfigured(env: RuntimeEnv = process.env) {
  return Boolean(getPilotEmailDeliveryConfig(env));
}
