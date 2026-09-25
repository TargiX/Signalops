import type { Generation, Model, OpsSnapshot, Provider } from "@/lib/mock-data";
import type { SignalEvent } from "@/lib/signalops/events";

const providerColors = ["#3459df", "#3F9070", "#D89A3F", "#C04B3A", "#6B5FD6", "#27828A"];

function toGenerationStatus(event: SignalEvent): Generation["status"] {
  if (event.status) {
    return event.status;
  }

  if (event.type === "generation.completed") {
    return "succeeded";
  }
  if (event.type === "generation.failed") {
    return "failed";
  }
  if (event.type === "generation.retrying") {
    return "retrying";
  }

  return "running";
}

function eventToGeneration(event: SignalEvent): Generation | null {
  if (!event.type.startsWith("generation.") || !event.generationId || !event.providerId || !event.modelId) {
    return null;
  }

  return {
    id: event.generationId,
    createdAt: event.occurredAt,
    user: event.user ?? "external-source",
    prompt: event.prompt ?? `External event ${event.eventId}`,
    modelId: event.modelId,
    providerId: event.providerId,
    source: event.source ?? "api",
    status: toGenerationStatus(event),
    durationMs: event.durationMs ?? 0,
    cost: event.cost ?? 0,
    credits: Math.max(1, Math.round((event.cost ?? 0.01) * 100)),
    retryCount: event.retryCount ?? 0,
  };
}

export function overlaySignalEvents(
  snapshot: OpsSnapshot,
  events: SignalEvent[],
  options: { durableSourceStorage?: boolean; sourceOnlyReportPath?: string } = {},
) {
  const externalGenerations = events.map(eventToGeneration).filter((event): event is Generation => Boolean(event));
  const sourceOverlay = {
    demoDataIncluded: true as const,
    sourceEventsIncluded: events.length > 0,
    durableSourceStorage: Boolean(options.durableSourceStorage),
    sourceEventCount: events.length,
    sourceGenerationCount: externalGenerations.length,
    sourceProviders: [...new Set(events.map((event) => event.providerId).filter((value): value is string => Boolean(value)))].sort(),
    sourceModels: [...new Set(events.map((event) => event.modelId).filter((value): value is string => Boolean(value)))].sort(),
    sourceOnlyReportPath: options.sourceOnlyReportPath ?? "/source-report",
  };

  if (externalGenerations.length === 0) {
    return { ...snapshot, sourceOverlay } satisfies OpsSnapshot;
  }

  const providers = [...snapshot.providers];
  const models = [...snapshot.models];
  const providerIds = new Set(providers.map((provider) => provider.id));
  const modelIds = new Set(models.map((model) => model.id));

  for (const generation of externalGenerations) {
    if (!providerIds.has(generation.providerId)) {
      const providerEvents = externalGenerations.filter((event) => event.providerId === generation.providerId);
      const failures = providerEvents.filter((event) => ["failed", "blocked", "retrying"].includes(event.status)).length;
      const p95Ms = Math.max(...providerEvents.map((event) => event.durationMs || 1));

      providers.unshift({
        id: generation.providerId,
        name: generation.providerId,
        status: failures > 0 ? "degraded" : "healthy",
        region: "external",
        p95Ms,
        failureRate: Number(((failures / providerEvents.length) * 100).toFixed(1)),
        spend: Number(providerEvents.reduce((sum, event) => sum + event.cost, 0).toFixed(2)),
        volume: providerEvents.length,
        color: providerColors[providers.length % providerColors.length],
      } satisfies Provider);
      providerIds.add(generation.providerId);
    }

    if (!modelIds.has(generation.modelId)) {
      const modelEvents = externalGenerations.filter((event) => event.modelId === generation.modelId);
      const successEvents = modelEvents.filter((event) => event.status === "succeeded").length;

      models.unshift({
        id: generation.modelId,
        name: generation.modelId,
        providerId: generation.providerId,
        medianMs: Math.round(modelEvents.reduce((sum, event) => sum + event.durationMs, 0) / modelEvents.length),
        p95Ms: Math.max(...modelEvents.map((event) => event.durationMs || 1)),
        costPerImage: Number((modelEvents.reduce((sum, event) => sum + event.cost, 0) / modelEvents.length).toFixed(4)),
        successRate: Number(((successEvents / modelEvents.length) * 100).toFixed(1)),
        volume: modelEvents.length,
      } satisfies Model);
      modelIds.add(generation.modelId);
    }
  }

  return {
    ...snapshot,
    providers,
    models,
    generations: [...externalGenerations, ...snapshot.generations],
    sourceOverlay,
    generatedAt: new Date().toISOString(),
  } satisfies OpsSnapshot;
}
