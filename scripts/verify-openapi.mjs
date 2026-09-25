import assert from "node:assert/strict";
import { buildOpenApiSpec } from "../src/lib/signalops/openapi.ts";

const spec = buildOpenApiSpec();

const requiredPaths = [
  "/api/status",
  "/api/health",
  "/api/setup-plan",
  "/api/source-kit",
  "/api/events/validate",
  "/api/events",
  "/api/source-report",
  "/api/pilot-requests",
  "/api/pilot-requests/{id}/handoff",
  "/api/snapshot",
];

assert.equal(spec.openapi, "3.1.0");

for (const path of requiredPaths) {
  assert.ok(spec.paths[path], `missing OpenAPI path ${path}`);
}

assert.ok(spec.components.securitySchemes.bearerAuth, "bearer auth scheme is required");
assert.ok(spec.components.securitySchemes.cookieAuth, "operator cookie auth scheme is required");
assert.ok(spec.paths["/api/events"].post.security, "ingest endpoint must require bearer auth");
assert.ok(spec.paths["/api/events"].post.responses["401"], "ingest endpoint must document unauthorized");
assert.ok(spec.paths["/api/events"].post.responses["503"], "ingest endpoint must document storage-not-configured");
assert.ok(spec.paths["/api/events"].post.responses["415"], "ingest endpoint must document unsupported media type");
assert.ok(
  spec.paths["/api/events/validate"].post.responses["415"],
  "event validation endpoint must document unsupported media type",
);
assert.match(
  spec.components.responses.IngestStorageNotConfigured.description,
  /workspace identity/,
  "ingest 503 response must document workspace identity setup gates",
);
assert.ok(spec.paths["/api/source-kit"].get, "source kit endpoint must be documented");
assert.ok(spec.paths["/api/pilot-requests"].get.security, "pilot request queue must require operator auth");

function assertCookieOrBearerSecurity(security, label) {
  assert.ok(
    security.some((item) => Object.hasOwn(item, "cookieAuth")),
    `${label} must document cookie auth`,
  );
  assert.ok(
    security.some((item) => Object.hasOwn(item, "bearerAuth")),
    `${label} must document operator bearer token auth`,
  );
}

assertCookieOrBearerSecurity(spec.paths["/api/pilot-requests"].get.security, "pilot request queue");
assertCookieOrBearerSecurity(spec.paths["/api/pilot-requests"].patch.security, "pilot request lifecycle update");
assertCookieOrBearerSecurity(
  spec.paths["/api/pilot-requests/{id}/handoff"].get.security,
  "pilot handoff pack",
);
assertCookieOrBearerSecurity(spec.paths["/api/source-report"].get.security, "source report");
const pilotRequestListParameters = spec.paths["/api/pilot-requests"].get.parameters.map((parameter) => parameter.name);
for (const parameterName of ["limit", "status", "tier", "followUp", "format"]) {
  assert.ok(
    pilotRequestListParameters.includes(parameterName),
    `pilot request queue must document ${parameterName} query parameter`,
  );
}
assert.ok(
  spec.paths["/api/pilot-requests"].get.responses["200"].content["text/csv"],
  "pilot request queue must document CSV export",
);
assert.ok(
  spec.paths["/api/pilot-requests"].get.responses["503"],
  "pilot request queue must document production auth guard",
);
assert.ok(spec.paths["/api/pilot-requests"].patch.security, "pilot request lifecycle update must require auth");
assert.ok(
  spec.paths["/api/pilot-requests"].patch.responses["415"],
  "pilot request lifecycle update must document unsupported media type",
);
assert.ok(
  spec.paths["/api/pilot-requests"].patch.requestBody.content["application/json"].schema.$ref.includes(
    "PilotRequestLifecycleUpdateInput",
  ),
  "pilot request lifecycle update input must be documented",
);
assert.ok(spec.paths["/api/pilot-requests"].post.responses["503"], "pilot intake must document fail-closed 503");
assert.ok(spec.paths["/api/pilot-requests"].post.responses["413"], "pilot intake must document payload limits");
assert.ok(spec.paths["/api/pilot-requests"].post.responses["415"], "pilot intake must document unsupported media type");
assert.ok(spec.paths["/api/pilot-requests"].post.responses["424"], "pilot intake must document delivery failure");
assert.ok(
  spec.components.schemas.PilotRequestAcceptedResponse.properties.deliveries.items.$ref.includes(
    "PilotDeliveryResult",
  ),
  "pilot intake accepted response must document delivery result shape",
);
for (const property of ["target", "ok", "deliveryId", "attemptedAt", "durationMs"]) {
  assert.ok(
    spec.components.schemas.PilotDeliveryResult.properties[property],
    `pilot delivery result must document ${property}`,
  );
}
assert.ok(
  spec.components.schemas.ErrorResponse.properties.deliveries.items.$ref.includes("PilotDeliveryResult"),
  "pilot delivery failure must document delivery diagnostics",
);
assert.ok(
  spec.components.schemas.ErrorResponse.properties.fallbackPackage.$ref.includes("PilotRequestFallbackPackage"),
  "pilot intake failures must document the fallback package",
);
assert.deepEqual(
  spec.components.schemas.PilotRequestFallbackPackage.properties.acceptanceChecklist.required,
  ["preCall", "firstEventProof", "nonGoals"],
);

const validationSchema = spec.components.schemas.EventValidationResponse;
assert.equal(validationSchema.properties.verificationOnly.const, true);
assert.equal(validationSchema.properties.storedEvents.const, 0);
assert.ok(validationSchema.properties.ingestPolicy.$ref.includes("IngestPolicy"));
assert.ok(validationSchema.properties.diagnostics.$ref.includes("SignalEventDiagnostics"));
assert.deepEqual(spec.components.schemas.SignalEventDiagnostics.properties.readiness.enum, [
  "insufficient",
  "partial",
  "pilot_ready",
]);

const ingestSchema = spec.components.schemas.EventIngestResponse;
assert.ok(ingestSchema.required.includes("receipt"), "ingest response must require a source-event receipt");
assert.ok(ingestSchema.required.includes("duplicateEventIds"), "ingest response must expose duplicate event ids");
assert.ok(ingestSchema.properties.receipt.$ref.includes("SourceEventReceipt"));
assert.equal(spec.components.schemas.SourceEventReceipt.properties.type.const, "signalops.source_event_receipt");
assert.equal(spec.components.schemas.SourceEventReceipt.properties.proof.properties.demoDataIncluded.const, false);
assert.ok(
  spec.components.schemas.SourceEventReceipt.required.includes("duplicateEventIds"),
  "source event receipt must expose duplicate event ids",
);
assert.ok(
  spec.components.schemas.SourceEventReceipt.properties.proof.required.includes("exactSourceReportPath"),
  "source event receipt must expose an exact source-report path",
);
assert.ok(
  spec.components.schemas.SourceEventReceipt.properties.proof.required.includes("existingEventCandidate"),
  "source event receipt must describe existing event proof candidates",
);

const ingestPolicySchema = spec.components.schemas.IngestPolicy;
assert.equal(ingestPolicySchema.properties.maxBatchEvents.default, 100);
assert.equal(ingestPolicySchema.properties.maxBodyBytes.default, 262144);

const signalEventInputSchema = spec.components.schemas.SignalEventInput;
assert.equal(signalEventInputSchema.properties.eventId.maxLength, 160);
assert.equal(signalEventInputSchema.properties.providerId.maxLength, 80);
assert.equal(signalEventInputSchema.properties.generationId.maxLength, 120);
assert.equal(signalEventInputSchema.properties.source.maxLength, 80);
assert.equal(signalEventInputSchema.properties.durationMs.minimum, 0);
assert.equal(signalEventInputSchema.properties.cost.minimum, 0);
assert.equal(signalEventInputSchema.properties.retryCount.type, "integer");
assert.equal(signalEventInputSchema.properties.retryCount.minimum, 0);

const statusRequired = spec.components.schemas.StatusResponse.required;
assert.ok(statusRequired.includes("canValidateEvents"));
assert.ok(statusRequired.includes("canAcceptPilotRequests"));
assert.ok(statusRequired.includes("canAcceptSourceEvents"));
assert.ok(statusRequired.includes("canClaimProductionReady"));

const setupPlanSchema = spec.components.schemas.SetupPlanResponse;
assert.ok(setupPlanSchema.properties.plan.properties.gates.items.$ref.includes("SetupGate"));
assert.ok(setupPlanSchema.properties.plan.properties.nextExternalSteps);
const healthSchema = spec.components.schemas.HealthResponse;
assert.ok(healthSchema.required.includes("firstSourceEvent"), "health must expose first source event readiness");
assert.ok(healthSchema.required.includes("publicBaseUrl"), "health must expose public base URL readiness");
assert.equal(healthSchema.properties.publicBaseUrl.properties.requiresHttps.const, true);
assert.ok(healthSchema.properties.firstSourceEvent.properties.ready, "health first source event must expose ready");
assert.ok(healthSchema.required.includes("workspace"), "health must expose workspace identity readiness");
assert.equal(healthSchema.properties.workspace.properties.reason.enum.includes("default_demo"), true);
assert.ok(healthSchema.required.includes("privacy"), "health must expose source-event privacy readiness");
assert.equal(healthSchema.properties.privacy.properties.defaultRedactsSensitiveFields.const, true);
assert.equal(healthSchema.properties.pilotIntake.properties.maxBodyBytes.default, 32768);
assert.equal(healthSchema.properties.pilotIntake.properties.deliveryTimeoutMs.default, 5000);
assert.equal(spec.components.schemas.RateLimitPolicy.properties.mode.const, "instance_memory");
assert.equal(spec.components.schemas.RateLimitPolicy.properties.buckets.properties.event_validation.default, 60);
assert.equal(spec.components.schemas.RateLimitPolicy.properties.buckets.properties.event_ingest.default, 120);
assert.equal(spec.components.schemas.RateLimitPolicy.properties.buckets.properties.pilot_request.default, 10);

const sourceKitSchema = spec.components.schemas.SourceKitResponse;
assert.equal(sourceKitSchema.properties.kit.properties.packageName.const, "@signalops/node");
assert.equal(sourceKitSchema.properties.kit.properties.distribution.properties.npmPublished.const, false);
assert.equal(
  sourceKitSchema.properties.kit.properties.compatibility.properties.validationResultIncludesIngestPolicy.const,
  true,
);
assert.equal(
  sourceKitSchema.properties.kit.properties.compatibility.properties.validationResultIncludesDiagnostics.const,
  true,
);
assert.equal(
  sourceKitSchema.properties.kit.properties.compatibility.properties.ingestResponseIncludesReceipt.const,
  true,
);
assert.equal(
  sourceKitSchema.properties.kit.properties.compatibility.properties.ingestResponseIncludesDuplicateEventIds.const,
  true,
);
assert.ok(sourceKitSchema.properties.kit.properties.ingestPolicy.$ref.includes("IngestPolicy"));
assert.ok(sourceKitSchema.properties.kit.properties.rateLimitPolicy.$ref.includes("RateLimitPolicy"));
assert.ok(sourceKitSchema.properties.kit.required.includes("idempotency"));
assert.ok(sourceKitSchema.properties.kit.required.includes("storageStrategy"));
assert.equal(sourceKitSchema.properties.kit.properties.idempotency.properties.eventIdMaxLength.const, 160);
assert.equal(
  sourceKitSchema.properties.kit.properties.idempotency.properties.helper.properties.name.const,
  "createSignalOpsEventId",
);
assert.equal(
  sourceKitSchema.properties.kit.properties.storageStrategy.properties.mode.const,
  "reuse_existing_resource",
);
assert.equal(
  sourceKitSchema.properties.kit.properties.storageStrategy.properties.newResourcesAllowed.const,
  false,
);
assert.ok(sourceKitSchema.properties.kit.required.includes("operatorEnv"));
assert.ok(sourceKitSchema.properties.kit.required.includes("verification"));
assert.ok(sourceKitSchema.properties.kit.required.includes("pilotIntakePolicy"));
assert.ok(sourceKitSchema.properties.kit.required.includes("rateLimitPolicy"));
assert.equal(sourceKitSchema.properties.kit.properties.pilotIntakePolicy.properties.maxBodyBytes.default, 32768);
assert.equal(sourceKitSchema.properties.kit.properties.pilotIntakePolicy.properties.deliveryTimeoutMs.default, 5000);
assert.ok(sourceKitSchema.properties.kit.properties.verification.properties.commands.required.includes("strictPreflight"));
assert.ok(sourceKitSchema.properties.kit.properties.verification.properties.commands.required.includes("sourceReportByEvent"));
assert.equal(
  sourceKitSchema.properties.kit.properties.verification.properties.expectedPreCutover.properties.stage.const,
  "hosted_demo",
);
assert.equal(
  sourceKitSchema.properties.kit.properties.verification.properties.expectedPreCutover.properties.storageGateCode.const,
  "ingest_storage_not_configured",
);
for (const path of ["/api/events/validate", "/api/events", "/api/pilot-requests"]) {
  assert.ok(spec.paths[path].post.responses["429"].$ref.includes("RateLimited"), `${path} must document 429`);
}
assert.ok(spec.components.responses.RateLimited.headers["Retry-After"]);
assert.ok(spec.components.responses.RateLimited.headers["X-RateLimit-Reset"]);

const pilotRequestSchema = spec.components.schemas.PilotRequestInput;
for (const property of ["generationVolume", "providers", "primaryPain", "urgency", "desiredOutcome", "website"]) {
  assert.ok(pilotRequestSchema.properties[property], `pilot request must document ${property}`);
}
for (const property of ["generationVolume", "providers", "primaryPain", "urgency", "desiredOutcome", "useCase"]) {
  assert.ok(pilotRequestSchema.required.includes(property), `pilot request must require ${property}`);
}
assert.deepEqual(pilotRequestSchema.properties.urgency.enum, ["exploring", "this_month", "blocked_now"]);
assert.deepEqual(spec.components.schemas.PilotQualification.properties.tier.enum, [
  "evaluate",
  "strong_fit",
  "urgent_fit",
]);
assert.ok(
  spec.components.schemas.PilotRequestAcceptedResponse.properties.qualification.$ref.includes("PilotQualification"),
);
assert.ok(spec.components.schemas.PilotRequest.properties.qualification.$ref.includes("PilotQualification"));
assert.ok(spec.components.schemas.PilotRequest.properties.lifecycle.$ref.includes("PilotRequestLifecycle"));
assert.ok(spec.components.schemas.PilotRequest.properties.activity.items.$ref.includes("PilotRequestActivity"));
assert.deepEqual(spec.components.schemas.PilotRequestLifecycle.properties.status.enum, [
  "new",
  "contacted",
  "pilot_scoped",
  "closed",
]);
assert.deepEqual(spec.components.schemas.PilotRequestActivity.properties.type.enum, [
  "submitted",
  "lifecycle_updated",
]);
assert.ok(spec.components.schemas.PilotRequestListResponse.properties.storage.$ref.includes("StoreHealth"));
assert.ok(
  spec.components.schemas.PilotRequestListResponse.properties.filters.$ref.includes("PilotRequestOperatorFilters"),
);
assert.ok(
  spec.components.schemas.PilotRequestListResponse.properties.summary.$ref.includes("PilotRequestOperatorSummary"),
);
assert.ok(spec.components.schemas.PilotRequestListResponse.properties.pilotRequests.items.$ref.includes("PilotRequest"));
assert.deepEqual(spec.components.schemas.PilotRequestOperatorFilters.properties.followUp.enum, [
  "all",
  "open",
  "due",
  "unscheduled",
]);
assert.ok(spec.components.schemas.PilotRequestOperatorSummary.properties.needsFollowUpCount);
assert.ok(spec.components.schemas.PilotRequestOperatorSummary.properties.unscheduledOpenCount);
assert.ok(
  spec.components.schemas.PilotRequestLifecycleUpdateResponse.properties.pilotRequest.$ref.includes("PilotRequest"),
);
assert.ok(
  spec.paths["/api/pilot-requests/{id}/handoff"].get.security,
  "pilot handoff pack must require operator auth",
);
assert.ok(
  spec.paths["/api/pilot-requests/{id}/handoff"].get.responses["200"].content["text/markdown"],
  "pilot handoff pack must document Markdown export",
);
assert.ok(spec.components.schemas.PilotHandoffResponse.properties.handoff.$ref.includes("PilotHandoffPack"));
assert.ok(spec.components.schemas.PilotHandoffPack.properties.emailDraft);
assert.ok(spec.components.schemas.PilotHandoffPack.required.includes("acceptanceChecklist"));
assert.deepEqual(
  spec.components.schemas.PilotHandoffPack.properties.acceptanceChecklist.required,
  ["preCall", "firstEventProof", "operatorReview", "nonGoals"],
);
assert.ok(spec.components.schemas.PilotHandoffPack.properties.sourceIntegration);
for (const property of ["validateCurl", "ingestCurl", "nodeSnippet", "preflightCommands"]) {
  assert.ok(
    spec.components.schemas.PilotHandoffPack.properties.sourceIntegration.properties[property],
    `pilot handoff source integration must document ${property}`,
  );
}
assert.ok(
  spec.components.schemas.EventIngestResponse.properties.diagnostics.$ref.includes("SignalEventDiagnostics"),
);
assert.ok(
  spec.paths["/api/snapshot"].get.responses["200"].content["application/json"].schema.$ref.includes(
    "OpsSnapshotResponse",
  ),
  "snapshot endpoint must document its response shape",
);
assertCookieOrBearerSecurity(spec.paths["/api/snapshot"].get.security, "cockpit snapshot");
assert.ok(spec.paths["/api/snapshot"].get.responses["401"], "snapshot must document unauthorized");
assert.ok(spec.paths["/api/snapshot"].get.responses["503"], "snapshot must document operator auth guard");
assert.ok(
  spec.components.schemas.OpsSnapshotResponse.required.includes("sourceOverlay"),
  "snapshot must include source overlay provenance",
);
assert.equal(spec.components.schemas.OpsSnapshotSourceOverlay.properties.demoDataIncluded.const, true);
assert.ok(spec.components.schemas.OpsSnapshotSourceOverlay.properties.durableSourceStorage);
assert.ok(spec.paths["/api/source-report"].get, "source report endpoint must be documented");
assert.ok(spec.paths["/api/source-report"].get.security, "source report must require operator auth");
const sourceReportParameters = spec.paths["/api/source-report"].get.parameters.map((parameter) => parameter.name);
assert.ok(sourceReportParameters.includes("format"), "source report must document export format parameter");
for (const parameterName of ["range", "eventId", "providerId", "modelId"]) {
  assert.ok(
    sourceReportParameters.includes(parameterName),
    `source report must document ${parameterName} filter parameter`,
  );
}
assert.ok(
  spec.paths["/api/source-report"].get.responses["200"].content["text/markdown"],
  "source report must document Markdown export",
);
assert.ok(
  spec.paths["/api/source-report"].get.responses["200"].content["text/csv"],
  "source report must document CSV export",
);
assert.ok(spec.components.schemas.SourceReportResponse.properties.report.$ref.includes("SourceOperationalReport"));
assert.equal(spec.components.schemas.SourceOperationalReport.properties.sourceOnly.const, true);
assert.equal(spec.components.schemas.SourceOperationalReport.properties.demoDataIncluded.const, false);
assert.ok(
  spec.components.schemas.SourceOperationalReport.required.includes("pilotEvidence"),
  "source report must include pilot evidence summary",
);
assert.ok(
  spec.components.schemas.SourceOperationalReport.required.includes("operatorBrief"),
  "source report must include operator brief",
);
assert.deepEqual(spec.components.schemas.SourceOperatorBrief.properties.decision.enum, [
  "wait_for_source_event",
  "review_narrow_pilot",
  "pilot_review_ready",
]);
assert.ok(spec.components.schemas.SourceOperationalReport.properties.filters.$ref.includes("SourceReportFilters"));
assert.deepEqual(spec.components.schemas.SourceReportFilters.properties.range.enum, ["all", "24h", "7d", "30d"]);
assert.ok(spec.components.schemas.SourceReportFilters.properties.eventId);
assert.ok(spec.components.schemas.SourceOperationalReport.properties.providers.items.$ref.includes("SourceProviderReport"));
assert.deepEqual(spec.components.schemas.SourcePilotEvidence.properties.level.enum, ["none", "partial", "pilot_ready"]);
assert.ok(spec.components.schemas.SourcePilotEvidence.required.includes("recommendedScope"));

console.log(
  `ok: OpenAPI ${Object.keys(spec.paths).length} paths / ${Object.keys(spec.components.schemas).length} schemas`,
);
