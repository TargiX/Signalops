import assert from "node:assert/strict";
import {
  createSignalOpsClient,
  createSignalOpsEventId,
  SignalOpsHttpError,
} from "../packages/signalops-node/src/index.ts";

const diagnostics = {
  readiness: "pilot_ready",
  coverage: {
    generationLifecycle: {
      started: false,
      completed: true,
      failed: false,
      retrying: false,
    },
    providerHealth: true,
    latency: true,
    cost: true,
    retries: true,
    providers: 1,
    models: 1,
  },
  gaps: [],
  nextActions: ["send the same payload to token-protected ingest after durable storage is configured"],
};

function createFetchMock() {
  const calls = [];
  const fetchMock = async (url, init) => {
    calls.push({ url: String(url), init });
    const body = JSON.parse(String(init.body));

    if (String(url).endsWith("/api/events/validate")) {
      return Response.json({
        ok: true,
        verificationOnly: true,
        validEvents: Array.isArray(body.events) ? body.events.length : 1,
        rejectedEvents: 0,
        eventTypes: ["generation.completed"],
        providerIds: ["fal"],
        modelIds: ["flux-2-pro"],
        privacyMode: "redact",
        diagnostics,
        ingestPolicy: {
          maxBatchEvents: 100,
          maxBodyBytes: 262144,
          maxBodyKb: 256,
          privacyMode: "redact",
        },
        storedEvents: 0,
        rejected: [],
        requestId: "req_validate",
      });
    }

    if (String(url).endsWith("/api/events")) {
      if (init.headers.authorization !== "Bearer sop_live_test") {
        return Response.json({ ok: false, code: "unauthorized", requestId: "req_auth" }, { status: 401 });
      }

      return Response.json({
        ok: true,
        accepted: Array.isArray(body.events) ? body.events.length : 1,
        storedEvents: 1,
        duplicateEvents: 0,
        storedEventIds: ["generation.completed:gen_1"],
        duplicateEventIds: [],
        receipt: {
          type: "signalops.source_event_receipt",
          requestId: "req_ingest",
          workspaceSlug: "demo",
          acceptedEventIds: ["generation.completed:gen_1"],
          storedEventIds: ["generation.completed:gen_1"],
          duplicateEvents: 0,
          duplicateEventIds: [],
          storage: {
            adapter: "cloudflare_d1",
            durable: true,
            ready: true,
          },
          proof: {
            demoDataIncluded: false,
            sourceOnlyReportPath: "/source-report?range=24h",
            exactSourceReportPath: "/source-report?range=all&eventId=generation.completed%3Agen_1",
            durableWrite: true,
            existingEventCandidate: true,
            firstSourceEventCandidate: true,
          },
          nextActions: ["open the source-only report"],
        },
        diagnostics,
        rejected: [],
        ingestPolicy: {
          maxBatchEvents: 100,
          maxBodyBytes: 262144,
          maxBodyKb: 256,
          privacyMode: "redact",
        },
        requestId: "req_ingest",
      });
    }

    return Response.json({ ok: false }, { status: 404 });
  };

  return { calls, fetchMock };
}

const { calls, fetchMock } = createFetchMock();
const client = createSignalOpsClient({
  endpoint: "https://signalops.cc/",
  token: "sop_live_test",
  fetch: fetchMock,
});

assert.equal(createSignalOpsEventId("provider.health", "fal:status-page:2026-06-25T10:00Z"), "provider.health:fal:status-page:2026-06-25T10:00Z");
assert.throws(() => createSignalOpsEventId("provider.health", "   "), /stable key is required/);
assert.throws(() => createSignalOpsEventId("provider.health", "x".repeat(200)), /at most 160/);

const validation = await client.validate({
  type: "generation.completed",
  generationId: "gen_1",
  providerId: "fal",
  modelId: "flux-2-pro",
});
assert.equal(validation.storedEvents, 0);
assert.equal(validation.ingestPolicy.maxBatchEvents, 100);
assert.equal(validation.diagnostics.readiness, "pilot_ready");
assert.equal(calls[0].url, "https://signalops.cc/api/events/validate");
assert.equal(calls[0].init.headers.authorization, undefined);

const ingest = await client.generationCompleted({
  generationId: "gen_1",
  providerId: "fal",
  modelId: "flux-2-pro",
});
assert.equal(ingest.accepted, 1);
assert.equal(ingest.ingestPolicy.maxBodyBytes, 262144);
assert.equal(ingest.diagnostics.coverage.cost, true);
assert.equal(ingest.receipt?.proof.demoDataIncluded, false);
assert.equal(ingest.receipt?.proof.durableWrite, true);
assert.match(ingest.receipt?.proof.exactSourceReportPath ?? "", /eventId=/);
assert.equal(calls[1].url, "https://signalops.cc/api/events");
assert.equal(calls[1].init.headers.authorization, "Bearer sop_live_test");

const verification = await client.verifySource(
  {
    type: "generation.completed",
    generationId: "gen_verify_sdk",
    providerId: "fal",
    modelId: "flux-2-pro",
    status: "succeeded",
  },
  { allowStorageGate: true },
);
assert.equal(verification.mode, "authenticated_ingest");
assert.equal(verification.ingest.accepted, 1);
assert.equal(verification.ingest.receipt?.type, "signalops.source_event_receipt");
assert.equal(verification.validation.storedEvents, 0);

const ingestCallsBeforeTrack = calls.filter((call) => call.url.endsWith("/api/events")).length;
const tracked = await client.trackGeneration(
  {
    generationId: "gen_track",
    providerId: "fal",
    modelId: "flux-2-pro",
    source: "sdk-test",
  },
  async () => "image-url",
);
assert.equal(tracked, "image-url");
assert.equal(calls.filter((call) => call.url.endsWith("/api/events")).length, ingestCallsBeforeTrack + 2);

await client.generationRetrying({
  generationId: "gen_retry",
  providerId: "fal",
  modelId: "flux-2-pro",
  status: "retrying",
  retryCount: 2,
});
await client.providerHealth({
  eventId: createSignalOpsEventId("provider.health", "fal:status-page:2026-06-25T10:00Z"),
  providerId: "fal",
  status: "retrying",
  source: "provider-status-page",
});
await client.costRecorded({
  eventId: createSignalOpsEventId("cost.recorded", "gen_cost:final"),
  providerId: "fal",
  modelId: "flux-2-pro",
  generationId: "gen_cost",
  cost: 0.084,
});
const helperPayloads = calls.slice(-3).map((call) => JSON.parse(String(call.init.body)));
assert.deepEqual(helperPayloads.map((event) => event.type), [
  "generation.retrying",
  "provider.health",
  "cost.recorded",
]);
assert.equal(helperPayloads[0].retryCount, 2);
assert.equal(helperPayloads[1].providerId, "fal");
assert.equal(helperPayloads[1].eventId, "provider.health:fal:status-page:2026-06-25T10:00Z");
assert.equal(helperPayloads[2].cost, 0.084);
assert.equal(helperPayloads[2].eventId, "cost.recorded:gen_cost:final");

const validationOnly = createSignalOpsClient({
  endpoint: "https://signalops.cc",
  fetch: fetchMock,
});
const validationOnlyResult = await validationOnly.verifySource({
  type: "generation.completed",
  generationId: "gen_validation_only",
  providerId: "fal",
  modelId: "flux-2-pro",
});
assert.equal(validationOnlyResult.mode, "validation_only");
assert.match(validationOnlyResult.next, /SIGNALOPS_INGEST_TOKEN/);

const storageGateFetch = async (url, init) => {
  calls.push({ url: String(url), init });
  if (String(url).endsWith("/api/events/validate")) {
    return Response.json({
      ok: true,
      verificationOnly: true,
      validEvents: 1,
      rejectedEvents: 0,
      eventTypes: ["generation.completed"],
      providerIds: ["fal"],
      modelIds: ["flux-2-pro"],
      privacyMode: "redact",
      diagnostics,
      ingestPolicy: {
        maxBatchEvents: 100,
        maxBodyBytes: 262144,
        maxBodyKb: 256,
        privacyMode: "redact",
      },
      storedEvents: 0,
      rejected: [],
      requestId: "req_validate_storage_gate",
    });
  }

  return Response.json(
    {
      ok: false,
      code: "ingest_storage_not_configured",
      requestId: "req_storage_gate",
    },
    { status: 503 },
  );
};
const storageGate = createSignalOpsClient({
  endpoint: "https://signalops.cc",
  token: "sop_live_test",
  fetch: storageGateFetch,
});
const storageGateResult = await storageGate.verifySource(
  {
    type: "generation.completed",
    generationId: "gen_storage_gate",
    providerId: "fal",
    modelId: "flux-2-pro",
  },
  { allowStorageGate: true },
);
assert.equal(storageGateResult.mode, "storage_gate");
assert.equal(storageGateResult.ingest.code, "ingest_storage_not_configured");
assert.equal(storageGateResult.ingest.requestId, "req_storage_gate");

const workspaceGateFetch = async (url, init) => {
  calls.push({ url: String(url), init });
  if (String(url).endsWith("/api/events/validate")) {
    return Response.json({
      ok: true,
      verificationOnly: true,
      validEvents: 1,
      rejectedEvents: 0,
      eventTypes: ["generation.completed"],
      providerIds: ["fal"],
      modelIds: ["flux-2-pro"],
      privacyMode: "redact",
      diagnostics,
      ingestPolicy: {
        maxBatchEvents: 100,
        maxBodyBytes: 262144,
        maxBodyKb: 256,
        privacyMode: "redact",
      },
      storedEvents: 0,
      rejected: [],
      requestId: "req_validate_workspace_gate",
    });
  }

  return Response.json(
    {
      ok: false,
      code: "workspace_not_configured",
      requestId: "req_workspace_gate",
    },
    { status: 503 },
  );
};
const workspaceGate = createSignalOpsClient({
  endpoint: "https://signalops.cc",
  token: "sop_live_test",
  fetch: workspaceGateFetch,
});
const workspaceGateResult = await workspaceGate.verifySource(
  {
    type: "generation.completed",
    generationId: "gen_workspace_gate",
    providerId: "fal",
    modelId: "flux-2-pro",
  },
  { allowStorageGate: true },
);
assert.equal(workspaceGateResult.mode, "storage_gate");
assert.equal(workspaceGateResult.ingest.code, "workspace_not_configured");
assert.match(workspaceGateResult.next, /WORKSPACE_SLUG/);

function createCompletionFailureFetch() {
  const telemetryTypes = [];
  const fetchMock = async (url, init) => {
    const body = JSON.parse(String(init.body));
    telemetryTypes.push(body.type);
    if (body.type === "generation.completed") {
      return Response.json(
        { ok: false, code: "telemetry_down", requestId: "req_completion_down" },
        { status: 503 },
      );
    }

    return Response.json({
      ok: true,
      accepted: 1,
      storedEvents: 1,
      duplicateEvents: 0,
      storedEventIds: [body.eventId ?? `${body.type}:${body.generationId ?? "event"}`],
      duplicateEventIds: [],
      receipt: {
        type: "signalops.source_event_receipt",
        requestId: "req_ingest",
        workspaceSlug: "demo",
        acceptedEventIds: [body.eventId ?? `${body.type}:${body.generationId ?? "event"}`],
        storedEventIds: [body.eventId ?? `${body.type}:${body.generationId ?? "event"}`],
        duplicateEvents: 0,
        duplicateEventIds: [],
        storage: {
          adapter: "cloudflare_d1",
          durable: true,
          ready: true,
        },
        proof: {
          demoDataIncluded: false,
          sourceOnlyReportPath: "/source-report?range=24h",
          exactSourceReportPath: "/source-report?range=all&eventId=generation.completed%3Agen_fail_open",
          durableWrite: true,
          existingEventCandidate: true,
          firstSourceEventCandidate: true,
        },
        nextActions: [],
      },
      diagnostics,
      rejected: [],
      ingestPolicy: {
        maxBatchEvents: 100,
        maxBodyBytes: 262144,
        maxBodyKb: 256,
        privacyMode: "redact",
      },
      requestId: "req_ingest",
    });
  };

  return { telemetryTypes, fetchMock };
}

const failOpenTelemetryErrors = [];
const failOpenCompletion = createCompletionFailureFetch();
const failOpenClient = createSignalOpsClient({
  endpoint: "https://signalops.cc",
  token: "sop_live_test",
  fetch: failOpenCompletion.fetchMock,
  failOpen: true,
  onTelemetryError: (error) => failOpenTelemetryErrors.push(error),
});
const failOpenResult = await failOpenClient.trackGeneration(
  {
    generationId: "gen_fail_open",
    providerId: "fal",
    modelId: "flux-2-pro",
  },
  async () => "customer-result",
);
assert.equal(failOpenResult, "customer-result");
assert.deepEqual(failOpenCompletion.telemetryTypes, ["generation.started", "generation.completed"]);
assert.equal(failOpenTelemetryErrors.length, 1);
assert.equal(failOpenTelemetryErrors[0] instanceof SignalOpsHttpError, true);

const strictCompletion = createCompletionFailureFetch();
const strictClient = createSignalOpsClient({
  endpoint: "https://signalops.cc",
  token: "sop_live_test",
  fetch: strictCompletion.fetchMock,
  failOpen: false,
});
await assert.rejects(
  () =>
    strictClient.trackGeneration(
      {
        generationId: "gen_strict_completion",
        providerId: "fal",
        modelId: "flux-2-pro",
      },
      async () => "customer-result",
    ),
  (error) => error instanceof SignalOpsHttpError && error.code === "telemetry_down",
);
assert.deepEqual(strictCompletion.telemetryTypes, ["generation.started", "generation.completed"]);

const unauthorized = createSignalOpsClient({
  endpoint: "https://signalops.cc",
  token: "wrong",
  fetch: fetchMock,
});

await assert.rejects(
  () =>
    unauthorized.ingest({
      type: "generation.completed",
      generationId: "gen_2",
      providerId: "fal",
      modelId: "flux-2-pro",
    }),
  (error) => error instanceof SignalOpsHttpError && error.status === 401 && error.code === "unauthorized",
);

console.log("ok: SignalOps Node SDK");
