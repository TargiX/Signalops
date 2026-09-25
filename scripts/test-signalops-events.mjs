import assert from "node:assert/strict";
import {
  normalizeSignalEventBatch,
  summarizeSignalEventValidation,
} from "../src/lib/signalops/events.ts";
import {
  applyPilotRequestLifecycleUpdate,
  buildPilotRequestOperatorSummary,
  filterPilotRequestsForOperator,
  isPilotRequestSpamTrapTriggered,
  normalizePilotRequest,
  normalizePilotRequestLifecycleUpdate,
  pilotRequestToWebhookPayload,
  sortPilotRequestsForOperator,
} from "../src/lib/signalops/pilot-requests.ts";

const batch = normalizeSignalEventBatch({
  events: [
    {
      type: "generation.completed",
      generationId: "gen_1",
      providerId: "fal",
      modelId: "flux-2-pro",
      status: "succeeded",
      user: "person@example.com",
      prompt: "secret prompt",
      cost: 0.05,
      durationMs: 1200,
      retryCount: 1,
    },
    {
      type: "provider.health",
      providerId: "fal",
    },
  ],
});

assert.equal(batch.events.length, 2);
assert.equal(batch.rejected.length, 0);
assert.equal(batch.events[0].eventId, "generation.completed:gen_1");
assert.equal(batch.events[0].user, "[redacted]");
assert.equal(batch.events[0].prompt, "[redacted]");

const summary = summarizeSignalEventValidation(batch);
assert.deepEqual(summary.eventTypes, ["generation.completed", "provider.health"]);
assert.deepEqual(summary.providerIds, ["fal"]);
assert.deepEqual(summary.modelIds, ["flux-2-pro"]);
assert.equal(summary.storedEvents, 0);
assert.equal(summary.diagnostics.readiness, "pilot_ready");
assert.equal(summary.diagnostics.coverage.latency, true);
assert.equal(summary.diagnostics.coverage.cost, true);
assert.equal(summary.diagnostics.coverage.retries, true);
assert.equal(summary.diagnostics.coverage.providerHealth, true);
assert.deepEqual(summary.diagnostics.gaps, []);

const rawBatch = normalizeSignalEventBatch(
  {
    type: "generation.failed",
    generationId: "gen_2",
    providerId: "openai",
    modelId: "gpt-image-2",
    status: "failed",
    user: "ops@example.com",
  },
  "raw",
);

assert.equal(rawBatch.events[0].user, "ops@example.com");

const invalid = normalizeSignalEventBatch({ type: "generation.completed", generationId: "gen_3" });
assert.equal(invalid.events.length, 0);
assert.equal(invalid.rejected.length, 1);

const invalidTelemetry = normalizeSignalEventBatch({
  events: [
    {
      type: "generation.completed",
      generationId: "gen_negative_duration",
      providerId: "fal",
      modelId: "flux-2-pro",
      status: "succeeded",
      durationMs: -1,
    },
    {
      type: "generation.completed",
      generationId: "gen_fractional_retry",
      providerId: "fal",
      modelId: "flux-2-pro",
      status: "succeeded",
      retryCount: 1.5,
    },
    {
      type: "provider.health",
      providerId: "p".repeat(81),
    },
  ],
});
assert.equal(invalidTelemetry.events.length, 0);
assert.deepEqual(
  invalidTelemetry.rejected.map((item) => item.error),
  [
    "durationMs must be greater than or equal to 0",
    "retryCount must be an integer",
    "providerId must be at most 80 characters",
  ],
);

const thinSummary = summarizeSignalEventValidation(
  normalizeSignalEventBatch({
    type: "provider.health",
    providerId: "fal",
  }),
);
assert.equal(thinSummary.diagnostics.readiness, "insufficient");
assert.ok(thinSummary.diagnostics.gaps.includes("send generation outcome events"));
assert.ok(thinSummary.diagnostics.gaps.includes("include durationMs for latency analysis"));

assert.throws(
  () =>
    normalizeSignalEventBatch(
      {
        events: [
          { type: "provider.health", providerId: "fal" },
          { type: "provider.health", providerId: "openai" },
        ],
      },
      "redact",
      { maxBatchEvents: 1 },
    ),
  /event batches are limited to 1 events/,
);

const pilotRequest = normalizePilotRequest({
  name: "Maya Chen",
  email: "MAYA@EXAMPLE.COM",
  company: "Image Studio",
  generationVolume: "50k images/month",
  providers: "fal, OpenAI",
  primaryPain: "Provider latency spikes and retry storms",
  urgency: "this_month",
  desiredOutcome: "Know which provider/model is causing user-visible failures before support tickets arrive.",
  useCase: "We run image generation jobs across providers and need latency, retry, and cost visibility.",
});

assert.equal(pilotRequest.email, "maya@example.com");
assert.equal(pilotRequest.generationVolume, "50k images/month");
assert.equal(pilotRequest.providers, "fal, OpenAI");
assert.equal(pilotRequest.urgency, "this_month");
assert.equal(pilotRequest.qualification.tier, "strong_fit");
assert.equal(pilotRequest.lifecycle.status, "new");
assert.equal(pilotRequest.activity.length, 1);
assert.equal(pilotRequest.activity[0].type, "submitted");
assert.ok(pilotRequest.qualification.signals.includes("near_term_need"));
assert.ok(pilotRequest.qualification.signals.includes("meaningful_generation_volume"));
assert.ok(pilotRequest.qualification.signals.includes("multi_provider_or_named_provider"));
assert.ok(pilotRequest.qualification.signals.includes("latency_pain"));
assert.ok(pilotRequest.qualification.signals.includes("reliability_pain"));
assert.equal(pilotRequest.source, "pilot-page");
assert.match(pilotRequest.id, /^pilot_/);
assert.equal(isPilotRequestSpamTrapTriggered({ ...pilotRequest, website: "" }), false);
assert.equal(isPilotRequestSpamTrapTriggered({ ...pilotRequest, website: "https://spam.example" }), true);

const webhookPayload = pilotRequestToWebhookPayload(pilotRequest, { baseUrl: "https://signalops.cc/" });
assert.equal(webhookPayload.type, "pilot.requested");
assert.equal(webhookPayload.links.sourceKit, "https://signalops.cc/api/source-kit");
assert.equal(webhookPayload.integration.validateFirst, true);
assert.ok(webhookPayload.integration.preflightCommands[1].includes("--require-pilot-ready"));
assert.ok(webhookPayload.operatorNextActions.some((action) => /source-event payload/.test(action)));

const urgentPilotRequest = normalizePilotRequest({
  name: "Sam Rivera",
  email: "sam@example.com",
  company: "Render Desk",
  generationVolume: "100k jobs/day",
  providers: "OpenAI, Replicate, fal",
  primaryPain: "Generation failures, timeout incidents, and retry storms are blocking launch now.",
  urgency: "blocked_now",
  desiredOutcome: "Reduce provider incidents before launch.",
  useCase: "We run high-volume image generation and need immediate reliability triage before launch.",
});

const evaluatePilotRequest = normalizePilotRequest({
  name: "Lee Park",
  email: "lee@example.com",
  generationVolume: "early prototype",
  providers: "undecided",
  primaryPain: "Exploring whether generation observability will be needed later.",
  urgency: "exploring",
  desiredOutcome: "Understand whether this should be revisited after launch.",
  useCase: "We are exploring AI generation observability for a possible future project.",
});

assert.deepEqual(
  sortPilotRequestsForOperator([pilotRequest, evaluatePilotRequest, urgentPilotRequest]).map(
    (request) => request.qualification.tier,
  ),
  ["urgent_fit", "strong_fit", "evaluate"],
);

const lifecycleUpdate = normalizePilotRequestLifecycleUpdate({
  id: pilotRequest.id,
  status: "contacted",
  operatorNote: "Asked for a source-event sample and a 30-minute setup call.",
  nextActionAt: "2026-06-30T10:00:00.000Z",
});
const contactedPilotRequest = applyPilotRequestLifecycleUpdate(pilotRequest, lifecycleUpdate);
assert.equal(contactedPilotRequest.lifecycle.status, "contacted");
assert.equal(contactedPilotRequest.activity.at(-1).type, "lifecycle_updated");
assert.equal(contactedPilotRequest.activity.at(-1).actor, "operator");
assert.match(contactedPilotRequest.activity.at(-1).summary, /status new -> contacted/);
assert.equal(
  contactedPilotRequest.lifecycle.operatorNote,
  "Asked for a source-event sample and a 30-minute setup call.",
);
assert.equal(contactedPilotRequest.lifecycle.nextActionAt, "2026-06-30T10:00:00.000Z");

const closedUrgentPilotRequest = applyPilotRequestLifecycleUpdate(
  urgentPilotRequest,
  normalizePilotRequestLifecycleUpdate({
    id: urgentPilotRequest.id,
    status: "closed",
  }),
);
assert.deepEqual(
  sortPilotRequestsForOperator([closedUrgentPilotRequest, evaluatePilotRequest]).map(
    (request) => request.lifecycle.status,
  ),
  ["new", "closed"],
);
const operatorSummary = buildPilotRequestOperatorSummary(
  [contactedPilotRequest, closedUrgentPilotRequest, evaluatePilotRequest],
  new Date("2026-07-01T00:00:00.000Z"),
);
assert.equal(operatorSummary.total, 3);
assert.equal(operatorSummary.openCount, 2);
assert.equal(operatorSummary.needsFollowUpCount, 1);
assert.equal(operatorSummary.unscheduledOpenCount, 1);
assert.equal(operatorSummary.byStatus.contacted, 1);
assert.equal(operatorSummary.byStatus.closed, 1);
assert.equal(operatorSummary.byTier.urgent_fit, 1);
assert.deepEqual(
  filterPilotRequestsForOperator(
    [contactedPilotRequest, closedUrgentPilotRequest, evaluatePilotRequest],
    { followUp: "due" },
    new Date("2026-07-01T00:00:00.000Z"),
  ).map((request) => request.id),
  [contactedPilotRequest.id],
);
assert.deepEqual(
  filterPilotRequestsForOperator(
    [contactedPilotRequest, closedUrgentPilotRequest, evaluatePilotRequest],
    { status: "contacted", tier: "strong_fit" },
  ).map((request) => request.id),
  [contactedPilotRequest.id],
);
assert.deepEqual(
  filterPilotRequestsForOperator(
    [contactedPilotRequest, closedUrgentPilotRequest, evaluatePilotRequest],
    { followUp: "unscheduled" },
  ).map((request) => request.id),
  [evaluatePilotRequest.id],
);

assert.throws(
  () =>
    normalizePilotRequest({
      name: "No Email",
      email: "bad",
      generationVolume: "10k images/month",
      providers: "fal",
      primaryPain: "Latency and retries",
      urgency: "this_month",
      desiredOutcome: "Reduce incidents",
      useCase: "We run image generation jobs and need reliability visibility.",
    }),
  /valid email is required/,
);

assert.throws(
  () =>
    normalizePilotRequest({
      name: "Missing Qualification",
      email: "missing@example.com",
      useCase: "We run image generation jobs and need reliability visibility.",
    }),
  /generationVolume is required/,
);

assert.throws(
  () => normalizePilotRequestLifecycleUpdate({ id: pilotRequest.id, status: "later" }),
  /status must be new, contacted, pilot_scoped, or closed/,
);

console.log("ok: SignalOps event contract");
