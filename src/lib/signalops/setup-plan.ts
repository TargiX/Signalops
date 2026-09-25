import "server-only";

import {
  isOperatorAccessConfigured,
  isOperatorAccessPilotReady,
  isOperatorApiTokenConfigured,
} from "@/lib/signalops/auth";
import { isSourceIngestTokenConfigured } from "@/lib/signalops/ingest-auth";
import { readSignalOpsIngestPolicy } from "@/lib/signalops/ingest-policy";
import {
  isPilotAlertWebhookFallbackConfigured,
  isPilotEmailDeliveryConfigured,
  isPilotEphemeralIntakeAllowed,
  isPilotWebhookDeliveryConfigured,
} from "@/lib/signalops/pilot-intake-readiness";
import { hasConfiguredSecret, isConfiguredPublicBaseUrl, isPlaceholderValue } from "@/lib/signalops/runtime-config";
import { getSignalOpsStore, getStoreHealth, getWorkspaceIdentity, getWorkspaceSlug } from "@/lib/signalops/store";

export type SetupGate = {
  id: string;
  label: string;
  ready: boolean;
  detail: string;
  commands: string[];
};

export type SetupPlan = {
  stage: "hosted_demo" | "pilot_setup";
  readyCount: number;
  totalCount: number;
  gates: SetupGate[];
  nextExternalSteps: string[];
};

async function checkFirstSourceEvent(durableStorageReady: boolean) {
  if (!durableStorageReady) {
    return {
      ready: false,
      detail:
        "This cannot be closed by synthetic/demo events. It needs durable storage first, then one real server-side generation path to send a non-validation event.",
    };
  }

  try {
    const events = await getSignalOpsStore().listEvents(getWorkspaceSlug(), 1);
    if (events.length > 0) {
      return {
        ready: true,
        detail: `Durable storage contains at least one source event for workspace "${getWorkspaceSlug()}".`,
      };
    }
  } catch (error) {
    return {
      ready: false,
      detail: `Durable storage is configured, but source-event evidence could not be read: ${
        error instanceof Error ? error.message : "unknown read failure"
      }.`,
    };
  }

  return {
    ready: false,
    detail:
      "Durable storage is configured, but no accepted source event has been observed yet. Send one real server-side generation event after auth setup.",
  };
}

function publicBaseUrlStatus() {
  const value = process.env.SIGNALOPS_PUBLIC_BASE_URL || process.env.SIGNALOPS_BASE_URL || "";
  if (isPlaceholderValue(value)) {
    return {
      ready: false,
      detail:
        "SIGNALOPS_PUBLIC_BASE_URL or SIGNALOPS_BASE_URL must be set to the HTTPS production URL before source kits and pilot handoff links are shared.",
    };
  }

  try {
    const url = new URL(value);
    const localHostnames = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);
    const ready = isConfiguredPublicBaseUrl(value) && !localHostnames.has(url.hostname);
    return {
      ready,
      detail: ready
        ? `Public source-kit and handoff links use ${url.origin}.`
        : "The public base URL must use HTTPS and cannot point at localhost for a controlled pilot.",
    };
  } catch {
    return {
      ready: false,
      detail: "SIGNALOPS_PUBLIC_BASE_URL or SIGNALOPS_BASE_URL is not a valid URL.",
    };
  }
}

function configuredSecretsMatch(left: string | undefined, right: string | undefined) {
  return hasConfiguredSecret(left) && hasConfiguredSecret(right) && left === right;
}

function secretBoundaryConflicts() {
  const pairs = [
    ["SIGNALOPS_INGEST_TOKEN", "SIGNALOPS_OPERATOR_TOKEN"],
    ["SIGNALOPS_INGEST_TOKEN", "SIGNALOPS_COCKPIT_PASSWORD"],
    ["SIGNALOPS_INGEST_TOKEN", "SIGNALOPS_SESSION_SECRET"],
    ["SIGNALOPS_OPERATOR_TOKEN", "SIGNALOPS_COCKPIT_PASSWORD"],
    ["SIGNALOPS_COCKPIT_PASSWORD", "SIGNALOPS_SESSION_SECRET"],
  ] as const;

  return pairs
    .filter(([left, right]) => configuredSecretsMatch(process.env[left], process.env[right]))
    .map(([left, right]) => `${left}/${right}`);
}

export async function buildSetupPlan(): Promise<SetupPlan> {
  const storage = getStoreHealth();
  const ingestTokenReady = isSourceIngestTokenConfigured();
  const workspaceIdentity = getWorkspaceIdentity();
  const ingestPolicy = readSignalOpsIngestPolicy();
  const privacyReady = ingestPolicy.privacyMode === "redact";
  const operatorTokenReady = isOperatorApiTokenConfigured();
  const operatorAccessConfigured = isOperatorAccessConfigured();
  const operatorAccessReady = isOperatorAccessPilotReady();
  const pilotWebhookReady = isPilotWebhookDeliveryConfigured();
  const alertWebhookReady = isPilotAlertWebhookFallbackConfigured();
  const pilotEmailReady = isPilotEmailDeliveryConfigured();
  const pilotEphemeralIntakeReady = isPilotEphemeralIntakeAllowed();
  const pilotIntakeReady =
    (storage.durable && storage.ready) ||
    pilotWebhookReady ||
    alertWebhookReady ||
    pilotEmailReady ||
    pilotEphemeralIntakeReady;
  const durableStorageReady = storage.durable && storage.ready;
  const sourceIngestReady = durableStorageReady && ingestTokenReady;
  const firstSourceEvent = await checkFirstSourceEvent(durableStorageReady);
  const publicBaseUrl = publicBaseUrlStatus();
  const secretConflicts = secretBoundaryConflicts();
  const secretBoundariesReady = secretConflicts.length === 0;
  const pilotSetupReady =
    publicBaseUrl.ready &&
    sourceIngestReady &&
    operatorAccessReady &&
    secretBoundariesReady &&
    workspaceIdentity.pilotReady &&
    privacyReady &&
    pilotIntakeReady &&
    firstSourceEvent.ready;

  const gates: SetupGate[] = [
    {
      id: "public_base_url",
      label: "Public base URL",
      ready: publicBaseUrl.ready,
      detail: publicBaseUrl.detail,
      commands: [
        "printf 'https://signalops.cc' | vercel env add SIGNALOPS_PUBLIC_BASE_URL production",
        "printf 'https://signalops.cc' | vercel env add SIGNALOPS_BASE_URL production",
        "SIGNALOPS_BASE_URL=https://signalops.cc pnpm verify:cutover --local-only --allow-blocked",
      ],
    },
    {
      id: "event_validation",
      label: "Public event validation",
      ready: true,
      detail: "Prospective source apps can validate the event contract without storing payloads.",
      commands: [
        `curl -X POST https://signalops.cc/api/events/validate -H "content-type: application/json" -d '{"type":"generation.completed","generationId":"gen_001","providerId":"fal","modelId":"flux-2-pro","status":"succeeded"}'`,
      ],
    },
    {
      id: "operator_access",
      label: "Operator access",
      ready: operatorAccessReady,
      detail: operatorAccessReady
        ? operatorTokenReady
          ? "Operator API token is configured for protected reports and queue automation."
          : "Cockpit password auth and an explicit session secret are configured for protected operator surfaces."
        : operatorAccessConfigured
          ? "Operator access is partially configured, but cockpit password auth needs SIGNALOPS_SESSION_SECRET before pilot use."
        : "Protected source reports, pilot queues, and handoff packs need cockpit auth or an operator API token before production use.",
      commands: [
        "# Browser/operator UI access:",
        "printf 'true' | vercel env add SIGNALOPS_REQUIRE_AUTH production",
        "vercel env add SIGNALOPS_COCKPIT_PASSWORD production",
        "vercel env add SIGNALOPS_SESSION_SECRET production",
        "",
        "# CLI/API automation for protected reports and queue reads:",
        "vercel env add SIGNALOPS_OPERATOR_TOKEN production",
      ],
    },
    {
      id: "secret_boundaries",
      label: "Secret boundaries",
      ready: secretBoundariesReady,
      detail: secretBoundariesReady
        ? "Ingest, operator, cockpit, and session secrets are separated so source-app tokens cannot read operator reports."
        : `Secrets are reused across pilot boundaries: ${secretConflicts.join(", ")}.`,
      commands: [
        "vercel env add SIGNALOPS_INGEST_TOKEN production",
        "vercel env add SIGNALOPS_OPERATOR_TOKEN production",
        "vercel env add SIGNALOPS_COCKPIT_PASSWORD production",
        "vercel env add SIGNALOPS_SESSION_SECRET production",
        "pnpm verify:cutover --local-only --allow-blocked",
      ],
    },
    {
      id: "durable_storage",
      label: "Durable storage",
      ready: durableStorageReady,
      detail:
        storage.adapter === "cloudflare_d1"
          ? storage.ready
            ? "Cloudflare D1 env is present."
            : `Cloudflare D1 is selected but missing ${storage.missing.join(", ")}.`
          : storage.adapter === "supabase"
            ? storage.ready
              ? "Supabase service-role env is present."
              : `Supabase is selected but missing ${storage.missing.join(", ")}.`
          : "Hosted production is still using memory storage, so real source events and durable intake stay blocked.",
      commands: [
        "# Option A: reuse an existing Cloudflare D1 database; do not create a new Cloudflare project/database",
        "CLOUDFLARE_API_TOKEN=... pnpm discover:cloudflare-d1 -- --existing-only --probe-schema",
        "pnpm prepare:cloudflare-d1-sql --write tmp/signalops-d1.sql",
        "CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_D1_DATABASE_ID=... pnpm apply:cloudflare-d1-schema -- --probe-schema",
        "printf 'cloudflare_d1' | vercel env add SIGNALOPS_DATABASE_TARGET production",
        "vercel env add CLOUDFLARE_ACCOUNT_ID production",
        "vercel env add CLOUDFLARE_D1_DATABASE_ID production",
        "vercel env add CLOUDFLARE_API_TOKEN production",
        "pnpm verify:cutover --probe-d1 --local-only",
        "",
        "# Option B: reuse an approved Supabase project",
        "pnpm prepare:supabase-sql --write tmp/signalops-supabase.sql",
        "# apply tmp/signalops-supabase.sql in Supabase SQL editor",
        "printf 'supabase' | vercel env add SIGNALOPS_DATABASE_TARGET production",
        "vercel env add SUPABASE_URL production",
        "vercel env add SUPABASE_SERVICE_ROLE_KEY production",
        "pnpm verify:cutover --probe-supabase --local-only",
      ],
    },
    {
      id: "ingest_auth",
      label: "Source ingest token",
      ready: ingestTokenReady,
      detail: ingestTokenReady
        ? "Production has an ingest token configured."
        : "Production source ingest remains closed until a server-side token is configured.",
      commands: ["vercel env add SIGNALOPS_INGEST_TOKEN production"],
    },
    {
      id: "workspace_identity",
      label: "Workspace identity",
      ready: workspaceIdentity.pilotReady,
      detail: workspaceIdentity.pilotReady
        ? `Source events are scoped to workspace "${workspaceIdentity.workspaceSlug}".`
        : workspaceIdentity.reason === "default_demo"
          ? "SIGNALOPS_WORKSPACE_SLUG is still set to demo. Controlled pilots need a real workspace slug so reports and receipts do not look like seeded demo evidence."
          : "SIGNALOPS_WORKSPACE_SLUG must be set to a real workspace slug before accepting controlled-pilot source events.",
      commands: [
        "printf 'signalops-pilot' | vercel env add SIGNALOPS_WORKSPACE_SLUG production",
        "SIGNALOPS_BASE_URL=https://signalops.cc pnpm verify:release-readiness --allow-blocked",
      ],
    },
    {
      id: "privacy_mode",
      label: "Sensitive field redaction",
      ready: privacyReady,
      detail: privacyReady
        ? "Source ingest redacts user and prompt fields by default before validation, storage, reports, and cockpit overlays."
        : "SIGNALOPS_EVENT_PRIVACY_MODE=raw exposes user and prompt fields. Controlled pilots should run with redact unless there is an explicit data-processing agreement.",
      commands: [
        "printf 'redact' | vercel env add SIGNALOPS_EVENT_PRIVACY_MODE production",
        "SIGNALOPS_BASE_URL=https://signalops.cc pnpm verify:live-contracts",
      ],
    },
    {
      id: "pilot_delivery",
      label: "Pilot request delivery",
      ready: pilotIntakeReady,
      detail: pilotIntakeReady
        ? pilotEphemeralIntakeReady
          ? "Pilot requests use explicit local-only ephemeral storage for sandbox verification."
          : "Pilot requests have at least one delivery/storage path."
        : "The pilot form intentionally returns 503 until D1, Supabase, webhook, or Resend delivery is connected.",
      commands: [
        "# Local-only sandbox, not for production:",
        "SIGNALOPS_ALLOW_EPHEMERAL_PILOT_INTAKE=true pnpm dev",
        "",
        "# Production delivery URLs must use HTTPS; http:// receivers are local-only.",
        "vercel env add SIGNALOPS_PILOT_REQUEST_WEBHOOK_URL production",
        "vercel env add SIGNALOPS_PILOT_REQUEST_WEBHOOK_SECRET production",
        "# or reuse the existing operator alert webhook:",
        "vercel env add SIGNALOPS_ALERT_WEBHOOK_URL production",
        "vercel env add SIGNALOPS_ALERT_WEBHOOK_SECRET production",
        "# or configure Resend:",
        "vercel env add SIGNALOPS_PILOT_REQUEST_EMAIL_TO production",
        "vercel env add SIGNALOPS_PILOT_REQUEST_EMAIL_FROM production",
        "vercel env add SIGNALOPS_RESEND_API_KEY production",
      ],
    },
    {
      id: "first_source_event",
      label: "First real source event",
      ready: sourceIngestReady && firstSourceEvent.ready,
      detail: firstSourceEvent.detail,
      commands: [
        `curl -X POST https://signalops.cc/api/events -H "content-type: application/json" -H "authorization: Bearer $SIGNALOPS_INGEST_TOKEN" -d '{"type":"generation.completed","generationId":"gen_prod_001","providerId":"fal","modelId":"flux-2-pro","status":"succeeded"}'`,
        "SIGNALOPS_BASE_URL=https://signalops.cc pnpm verify:source-smoke --allow-storage-gate",
        "SIGNALOPS_BASE_URL=https://signalops.cc SIGNALOPS_INGEST_TOKEN=... SIGNALOPS_OPERATOR_TOKEN=... pnpm verify:pilot-preflight -- --require-pilot-ready",
        "pnpm verify:cutover --probe-d1",
      ],
    },
  ];

  return {
    stage: pilotSetupReady ? "pilot_setup" : "hosted_demo",
    readyCount: gates.filter((gate) => gate.ready).length,
    totalCount: gates.length,
    gates,
    nextExternalSteps: gates.filter((gate) => !gate.ready).map((gate) => gate.id),
  };
}
