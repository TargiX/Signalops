import { readSignalOpsIngestPolicy } from "./ingest-policy";
import { readPilotRequestMaxBodyBytes, readSignalOpsDeliveryTimeoutMs, readSignalOpsRateLimitPolicy } from "./http";

export type SignalOpsSourceKit = {
  product: "SignalOps";
  apiVersion: "0.1";
  baseUrl: string;
  packageName: "@signalops/node";
  sdkVersion: "0.1.0";
  distribution: {
    status: "workspace_preview";
    npmPublished: false;
  };
  compatibility: {
    minSdkVersion: "0.1.0";
    validationResultIncludesIngestPolicy: true;
    validationResultIncludesDiagnostics: true;
    ingestResponseIncludesReceipt: true;
    ingestResponseIncludesDuplicateEventIds: true;
    failOpenRecommended: true;
  };
  idempotency: {
    eventIdMaxLength: 160;
    serverDefault: string;
    callerRequiredFor: string[];
    retryContract: string;
    helper: {
      name: "createSignalOpsEventId";
      import: string;
    };
    examples: {
      generationCompleted: string;
      providerHealth: string;
      costRecorded: string;
    };
  };
  storageStrategy: {
    mode: "reuse_existing_resource";
    newResourcesAllowed: false;
    preferredTargets: ["cloudflare_d1_existing", "supabase_existing"];
    discoveryCommand: string;
    schemaCommands: string[];
    note: string;
  };
  requiredServerEnv: string[];
  operatorEnv: string[];
  endpoints: {
    health: string;
    status: string;
    setupPlan: string;
    validate: string;
    ingest: string;
    openapi: string;
    sourceReport: string;
  };
  ingestPolicy: ReturnType<typeof readSignalOpsIngestPolicy>;
  rateLimitPolicy: ReturnType<typeof readSignalOpsRateLimitPolicy>;
  pilotIntakePolicy: {
    maxBodyBytes: number;
    maxBodyKb: number;
    deliveryTimeoutMs: number;
    acceptedContentTypes: ["application/json", "application/x-www-form-urlencoded", "multipart/form-data"];
  };
  sampleEvent: {
    type: "generation.completed";
    generationId: string;
    providerId: string;
    modelId: string;
    status: "succeeded";
    source: string;
    durationMs: number;
    cost: number;
    retryCount: number;
  };
  snippets: {
    validateCurl: string;
    ingestCurl: string;
    node: string;
  };
  verification: {
    readinessGates: string[];
    expectedPreCutover: {
      stage: "hosted_demo";
      unauthenticatedIngestStatus: 401;
      storageGateCode: "ingest_storage_not_configured";
    };
    commands: {
      softPreflight: string;
      strictPreflight: string;
      sourceSmoke: string;
      sourceReportByEvent: string;
      sourceReportJson: string;
      sourceReportMarkdown: string;
    };
  };
};

function trimTrailingSlash(value: string) {
  return value.replace(/\/$/, "");
}

export function buildSourceKit(baseUrl = "https://signalops.cc"): SignalOpsSourceKit {
  const canonicalBaseUrl = trimTrailingSlash(baseUrl);
  const sampleEvent = {
    type: "generation.completed" as const,
    generationId: "gen_prod_001",
    providerId: "fal",
    modelId: "flux-2-pro",
    status: "succeeded" as const,
    source: "production-api",
    durationMs: 18420,
    cost: 0.052,
    retryCount: 1,
  };
  const sampleEventJson = JSON.stringify(sampleEvent, null, 2);

  return {
    product: "SignalOps",
    apiVersion: "0.1",
    baseUrl: canonicalBaseUrl,
    packageName: "@signalops/node",
    sdkVersion: "0.1.0",
    distribution: {
      status: "workspace_preview",
      npmPublished: false,
    },
    compatibility: {
      minSdkVersion: "0.1.0",
      validationResultIncludesIngestPolicy: true,
      validationResultIncludesDiagnostics: true,
      ingestResponseIncludesReceipt: true,
      ingestResponseIncludesDuplicateEventIds: true,
      failOpenRecommended: true,
    },
    idempotency: {
      eventIdMaxLength: 160,
      serverDefault:
        "generation.* events default to '<type>:<generationId>'; events without generationId need a caller-supplied stable eventId for safe retries.",
      callerRequiredFor: ["provider.health", "cost.recorded events without generationId", "any source event retried across jobs"],
      retryContract:
        "Retry the same eventId to receive duplicateEventIds plus receipt.proof.exactSourceReportPath for the already stored event.",
      helper: {
        name: "createSignalOpsEventId",
        import: 'import { createSignalOpsEventId } from "@signalops/node";',
      },
      examples: {
        generationCompleted: "generation.completed:gen_prod_001",
        providerHealth: "provider.health:fal:status-page:2026-06-25T10:00Z",
        costRecorded: "cost.recorded:gen_prod_001:final",
      },
    },
    storageStrategy: {
      mode: "reuse_existing_resource",
      newResourcesAllowed: false,
      preferredTargets: ["cloudflare_d1_existing", "supabase_existing"],
      discoveryCommand: "CLOUDFLARE_API_TOKEN=... pnpm discover:cloudflare-d1 -- --existing-only --probe-schema",
      schemaCommands: [
        "pnpm prepare:cloudflare-d1-sql --write tmp/signalops-d1.sql",
        "CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_D1_DATABASE_ID=... pnpm apply:cloudflare-d1-schema -- --probe-schema",
        "pnpm prepare:supabase-sql --write tmp/signalops-supabase.sql",
      ],
      note:
        "Free-tier setup must reuse an existing Cloudflare D1 database or approved Supabase project; do not create new cloud projects/resources from this workflow.",
    },
    requiredServerEnv: ["SIGNALOPS_BASE_URL", "SIGNALOPS_INGEST_TOKEN", "SIGNALOPS_WORKSPACE_SLUG"],
    operatorEnv: ["SIGNALOPS_OPERATOR_TOKEN"],
    endpoints: {
      health: `${canonicalBaseUrl}/api/health`,
      status: `${canonicalBaseUrl}/api/status`,
      setupPlan: `${canonicalBaseUrl}/api/setup-plan`,
      validate: `${canonicalBaseUrl}/api/events/validate`,
      ingest: `${canonicalBaseUrl}/api/events`,
      openapi: `${canonicalBaseUrl}/api/openapi`,
      sourceReport: `${canonicalBaseUrl}/api/source-report`,
    },
    ingestPolicy: readSignalOpsIngestPolicy(),
    rateLimitPolicy: readSignalOpsRateLimitPolicy(),
    pilotIntakePolicy: {
      maxBodyBytes: readPilotRequestMaxBodyBytes(),
      maxBodyKb: Math.round(readPilotRequestMaxBodyBytes() / 1024),
      deliveryTimeoutMs: readSignalOpsDeliveryTimeoutMs(),
      acceptedContentTypes: ["application/json", "application/x-www-form-urlencoded", "multipart/form-data"],
    },
    sampleEvent,
    snippets: {
      validateCurl: `curl -X POST ${canonicalBaseUrl}/api/events/validate \\
  -H "content-type: application/json" \\
  -d '${sampleEventJson}'`,
      ingestCurl: `curl -X POST ${canonicalBaseUrl}/api/events \\
  -H "content-type: application/json" \\
  -H "authorization: Bearer $SIGNALOPS_INGEST_TOKEN" \\
  -d '${sampleEventJson}'`,
      node: `import { createSignalOpsClient, createSignalOpsEventId } from "@signalops/node";

const signalops = createSignalOpsClient({
  endpoint: process.env.SIGNALOPS_BASE_URL || "${canonicalBaseUrl}",
  token: process.env.SIGNALOPS_INGEST_TOKEN,
  failOpen: true,
});

await signalops.validate(${sampleEventJson});

const sourceVerification = await signalops.verifySource(${sampleEventJson}, {
  allowStorageGate: true,
});
console.log(sourceVerification.mode);
if (sourceVerification.mode === "authenticated_ingest") {
  console.log(sourceVerification.ingest.receipt?.proof);
}

await signalops.trackGeneration(
  {
    generationId: "gen_prod_001",
    providerId: "fal",
    modelId: "flux-2-pro",
    source: "production-api",
  },
  () => generateImage(),
);

await signalops.generationRetrying({
  generationId: "gen_prod_001",
  providerId: "fal",
  modelId: "flux-2-pro",
  status: "retrying",
  retryCount: 1,
});

await signalops.providerHealth({
  eventId: createSignalOpsEventId("provider.health", "fal:status-page:2026-06-25T10:00Z"),
  providerId: "fal",
  status: "retrying",
  source: "provider-status-page",
});

await signalops.costRecorded({
  eventId: createSignalOpsEventId("cost.recorded", "gen_prod_001:final"),
  generationId: "gen_prod_001",
  providerId: "fal",
  modelId: "flux-2-pro",
  cost: 0.052,
});`,
    },
    verification: {
      readinessGates: [
        "public_base_url",
        "durable_storage",
        "ingest_auth",
        "workspace_identity",
        "privacy_mode",
        "operator_access",
        "secret_boundaries",
        "pilot_delivery",
        "first_source_event",
      ],
      expectedPreCutover: {
        stage: "hosted_demo",
        unauthenticatedIngestStatus: 401,
        storageGateCode: "ingest_storage_not_configured",
      },
      commands: {
        softPreflight: `SIGNALOPS_BASE_URL=${canonicalBaseUrl} pnpm verify:pilot-preflight -- --allow-storage-gate`,
        strictPreflight: `SIGNALOPS_BASE_URL=${canonicalBaseUrl} SIGNALOPS_INGEST_TOKEN=... SIGNALOPS_OPERATOR_TOKEN=... pnpm verify:pilot-preflight -- --require-pilot-ready`,
        sourceSmoke: `SIGNALOPS_BASE_URL=${canonicalBaseUrl} SIGNALOPS_INGEST_TOKEN=... pnpm verify:source-smoke --allow-storage-gate`,
        sourceReportByEvent: `node packages/signalops-node/dist/cli.js source-report --endpoint ${canonicalBaseUrl} --operator-token "$SIGNALOPS_OPERATOR_TOKEN" --event-id "generation.completed:gen_prod_001"`,
        sourceReportJson: `node packages/signalops-node/dist/cli.js source-report --endpoint ${canonicalBaseUrl} --operator-token "$SIGNALOPS_OPERATOR_TOKEN" --range 24h --provider-id fal --model-id flux-2-pro`,
        sourceReportMarkdown: `node packages/signalops-node/dist/cli.js source-report --endpoint ${canonicalBaseUrl} --operator-token "$SIGNALOPS_OPERATOR_TOKEN" --range 24h --provider-id fal --format markdown`,
      },
    },
  };
}
