import type { SignalEvent } from "./events";
import { summarizeSignalEventValidation, type SignalEventDiagnostics } from "./events";

export type SourceProviderReport = {
  providerId: string;
  eventCount: number;
  generationCount: number;
  successCount: number;
  failureCount: number;
  retryCount: number;
  successRate: number;
  failureRate: number;
  retryRate: number;
  p95Ms: number | null;
  totalCost: number;
  models: string[];
  lastSeenAt: string;
  status: "healthy" | "watch" | "degraded";
};

export type SourceModelReport = {
  modelId: string;
  providerId: string;
  generationCount: number;
  successRate: number;
  failureRate: number;
  p95Ms: number | null;
  totalCost: number;
  lastSeenAt: string;
};

export type SourcePilotEvidence = {
  level: "none" | "partial" | "pilot_ready";
  readyForOperatorReview: boolean;
  summary: string;
  missingCoverage: string[];
  recommendedScope: string[];
};

export type SourceOperatorBrief = {
  decision: "wait_for_source_event" | "review_narrow_pilot" | "pilot_review_ready";
  headline: string;
  talkingPoints: string[];
  proofChecklist: string[];
  nonGoals: string[];
};

export type SourceOperationalReport = {
  workspaceSlug: string;
  generatedAt: string;
  sourceOnly: true;
  demoDataIncluded: false;
  filters: SourceReportFilters;
  totalEvents: number;
  generationEvents: number;
  providerHealthEvents: number;
  costEvents: number;
  storedEventWindow: {
    firstSeenAt?: string;
    lastSeenAt?: string;
  };
  diagnostics: SignalEventDiagnostics;
  providers: SourceProviderReport[];
  models: SourceModelReport[];
  risks: string[];
  nextActions: string[];
  pilotEvidence: SourcePilotEvidence;
  operatorBrief: SourceOperatorBrief;
};

export type SourceReportRange = "all" | "24h" | "7d" | "30d";

export type SourceReportFilters = {
  range: SourceReportRange;
  eventId?: string;
  providerId?: string;
  modelId?: string;
};

type EventGroup = {
  key: string;
  events: SignalEvent[];
};

function percentile(values: number[], percentileValue: number) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return null;
  }

  const index = Math.ceil((percentileValue / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

function rate(count: number, total: number) {
  if (total === 0) {
    return 0;
  }

  return Number(((count / total) * 100).toFixed(1));
}

function latest(events: SignalEvent[]) {
  return events
    .map((event) => event.occurredAt)
    .sort()
    .at(-1) ?? new Date(0).toISOString();
}

function groupBy(events: SignalEvent[], getKey: (event: SignalEvent) => string | undefined): EventGroup[] {
  const groups = new Map<string, SignalEvent[]>();
  for (const event of events) {
    const key = getKey(event);
    if (!key) {
      continue;
    }

    groups.set(key, [...(groups.get(key) ?? []), event]);
  }

  return [...groups.entries()].map(([key, groupEvents]) => ({ key, events: groupEvents }));
}

function isGenerationEvent(event: SignalEvent) {
  return event.type.startsWith("generation.");
}

function eventFailed(event: SignalEvent) {
  return event.status === "failed" || event.status === "blocked" || event.type === "generation.failed";
}

function eventSucceeded(event: SignalEvent) {
  return event.status === "succeeded" || event.type === "generation.completed";
}

function eventRetried(event: SignalEvent) {
  return event.status === "retrying" || event.type === "generation.retrying" || (event.retryCount ?? 0) > 0;
}

function rangeStart(range: SourceReportRange, now: Date) {
  if (range === "24h") {
    return now.getTime() - 24 * 60 * 60 * 1000;
  }
  if (range === "7d") {
    return now.getTime() - 7 * 24 * 60 * 60 * 1000;
  }
  if (range === "30d") {
    return now.getTime() - 30 * 24 * 60 * 60 * 1000;
  }

  return null;
}

export function filterSourceEventsForReport(
  events: SignalEvent[],
  filters: SourceReportFilters,
  now = new Date(),
) {
  const start = rangeStart(filters.range, now);

  return events.filter((event) => {
    if (filters.eventId && event.eventId !== filters.eventId) {
      return false;
    }

    if (filters.providerId && event.providerId !== filters.providerId) {
      return false;
    }

    if (filters.modelId && event.modelId !== filters.modelId) {
      return false;
    }

    if (start == null) {
      return true;
    }

    const occurredAt = new Date(event.occurredAt).getTime();
    return Number.isFinite(occurredAt) && occurredAt >= start && occurredAt <= now.getTime() + 5 * 60 * 1000;
  });
}

function providerStatus(failureRate: number, retryRate: number) {
  if (failureRate >= 10 || retryRate >= 25) {
    return "degraded";
  }

  if (failureRate > 0 || retryRate >= 10) {
    return "watch";
  }

  return "healthy";
}

function buildProviderReports(events: SignalEvent[]) {
  return groupBy(events, (event) => event.providerId)
    .map(({ key, events: providerEvents }) => {
      const generationEvents = providerEvents.filter(isGenerationEvent);
      const failureCount = generationEvents.filter(eventFailed).length;
      const retryCount = generationEvents.filter(eventRetried).length;
      const successCount = generationEvents.filter(eventSucceeded).length;
      const failureRate = rate(failureCount, generationEvents.length);
      const retryRate = rate(retryCount, generationEvents.length);

      return {
        providerId: key,
        eventCount: providerEvents.length,
        generationCount: generationEvents.length,
        successCount,
        failureCount,
        retryCount,
        successRate: rate(successCount, generationEvents.length),
        failureRate,
        retryRate,
        p95Ms: percentile(generationEvents.map((event) => event.durationMs ?? Number.NaN), 95),
        totalCost: Number(providerEvents.reduce((sum, event) => sum + (event.cost ?? 0), 0).toFixed(4)),
        models: [...new Set(providerEvents.map((event) => event.modelId).filter((value): value is string => Boolean(value)))].sort(),
        lastSeenAt: latest(providerEvents),
        status: providerStatus(failureRate, retryRate),
      } satisfies SourceProviderReport;
    })
    .sort((left, right) => {
      const statusPriority = { degraded: 0, watch: 1, healthy: 2 };
      const statusDelta = statusPriority[left.status] - statusPriority[right.status];
      if (statusDelta !== 0) {
        return statusDelta;
      }

      return right.eventCount - left.eventCount;
    });
}

function buildModelReports(events: SignalEvent[]) {
  return groupBy(events.filter(isGenerationEvent), (event) =>
    event.providerId && event.modelId ? `${event.providerId}:${event.modelId}` : undefined,
  )
    .map(({ events: modelEvents }) => {
      const first = modelEvents[0];
      const failureCount = modelEvents.filter(eventFailed).length;
      const successCount = modelEvents.filter(eventSucceeded).length;

      return {
        modelId: first.modelId!,
        providerId: first.providerId!,
        generationCount: modelEvents.length,
        successRate: rate(successCount, modelEvents.length),
        failureRate: rate(failureCount, modelEvents.length),
        p95Ms: percentile(modelEvents.map((event) => event.durationMs ?? Number.NaN), 95),
        totalCost: Number(modelEvents.reduce((sum, event) => sum + (event.cost ?? 0), 0).toFixed(4)),
        lastSeenAt: latest(modelEvents),
      } satisfies SourceModelReport;
    })
    .sort((left, right) => right.generationCount - left.generationCount);
}

function buildRisks(providers: SourceProviderReport[], diagnostics: SignalEventDiagnostics) {
  const risks: string[] = [];
  const degradedProviders = providers.filter((provider) => provider.status === "degraded");
  const watchProviders = providers.filter((provider) => provider.status === "watch");

  if (degradedProviders.length > 0) {
    risks.push(`degraded providers: ${degradedProviders.map((provider) => provider.providerId).join(", ")}`);
  }
  if (watchProviders.length > 0) {
    risks.push(`providers to watch: ${watchProviders.map((provider) => provider.providerId).join(", ")}`);
  }
  if (!diagnostics.coverage.providerHealth) {
    risks.push("provider health events are missing");
  }
  if (!diagnostics.coverage.cost) {
    risks.push("cost visibility is missing");
  }
  if (!diagnostics.coverage.latency) {
    risks.push("latency visibility is missing");
  }

  return risks;
}

function buildPilotEvidence(
  events: SignalEvent[],
  providers: SourceProviderReport[],
  models: SourceModelReport[],
  diagnostics: SignalEventDiagnostics,
  risks: string[],
): SourcePilotEvidence {
  if (events.length === 0) {
    return {
      level: "none",
      readyForOperatorReview: false,
      summary: "No source-only evidence has been captured yet.",
      missingCoverage: diagnostics.gaps,
      recommendedScope: [
        "send one validate-first generation.completed event from a real server-side workflow",
        "confirm durable storage and operator report access before inviting a pilot user",
      ],
    };
  }

  if (diagnostics.readiness === "pilot_ready") {
    const topProvider = providers[0];
    const topModel = models[0];
    return {
      level: "pilot_ready",
      readyForOperatorReview: true,
      summary: `Source evidence is ready for a controlled pilot review across ${providers.length} provider(s) and ${models.length} model(s).`,
      missingCoverage: diagnostics.gaps,
      recommendedScope: [
        topProvider
          ? `watch ${topProvider.providerId}${topModel ? `/${topModel.modelId}` : ""} reliability, p95 latency, retries, and cost for the first pilot workflow`
          : "watch reliability, p95 latency, retries, and cost for the first pilot workflow",
        risks.length > 0
          ? "review degraded/watch provider signals before widening traffic"
          : "compare the source-only report with the cockpit view after each pilot day",
        "keep the first pilot limited to one production workflow until event coverage stays stable",
      ],
    };
  }

  return {
    level: "partial",
    readyForOperatorReview: true,
    summary: "Some source evidence exists, but coverage is not complete enough for a confident pilot-ready claim.",
    missingCoverage: diagnostics.gaps,
    recommendedScope: [
      "keep the first review to one provider/model workflow",
      "close the missing coverage gaps before treating this as pilot-ready evidence",
      "use the source report to decide which provider/model should be instrumented next",
    ],
  };
}

function buildOperatorBrief(
  report: {
    totalEvents: number;
    providers: SourceProviderReport[];
    models: SourceModelReport[];
    risks: string[];
    diagnostics: SignalEventDiagnostics;
    pilotEvidence: SourcePilotEvidence;
  },
): SourceOperatorBrief {
  if (report.totalEvents === 0) {
    return {
      decision: "wait_for_source_event",
      headline: "Wait for one real source event before scheduling a pilot review.",
      talkingPoints: [
        "The source-only report is still empty, so there is no auditable source evidence yet.",
        "Start with one generation.completed event from the server-side workflow selected for the pilot.",
      ],
      proofChecklist: [
        "durable storage selected and reachable",
        "token-protected /api/events accepts one non-validation source event",
        "/api/source-report shows demoDataIncluded=false and totalEvents > 0",
      ],
      nonGoals: [
        "do not count seeded cockpit data as pilot evidence",
        "do not count /api/events/validate calls as stored source traffic",
      ],
    };
  }

  const topProvider = report.providers[0];
  const topModel = report.models[0];
  const scope = topProvider
    ? `${topProvider.providerId}${topModel ? `/${topModel.modelId}` : ""}`
    : "the first instrumented workflow";

  if (report.pilotEvidence.level === "pilot_ready") {
    return {
      decision: "pilot_review_ready",
      headline: `Review ${scope} with the pilot operator; source evidence is ready enough for a narrow workflow review.`,
      talkingPoints: [
        `${report.totalEvents} source event(s) are stored with demo data excluded.`,
        report.risks.length > 0
          ? `Open risk: ${report.risks[0]}.`
          : "No degraded/watch provider risk is currently visible in this report.",
        `Coverage readiness is ${report.diagnostics.readiness}.`,
      ],
      proofChecklist: [
        "source-only report has demoDataIncluded=false",
        "provider/model coverage is visible",
        "latency, retry, cost, and provider-health coverage are represented",
        "operator has a next action date for the pilot queue",
      ],
      nonGoals: [
        "do not widen beyond one production workflow until coverage stays stable",
        "do not claim production readiness from one pilot-ready report alone",
      ],
    };
  }

  return {
    decision: "review_narrow_pilot",
    headline: `Review ${scope}, but treat the evidence as partial until coverage gaps close.`,
    talkingPoints: [
      `${report.totalEvents} source event(s) exist, so the workflow can be discussed with real evidence.`,
      report.pilotEvidence.missingCoverage.length > 0
        ? `Missing coverage: ${report.pilotEvidence.missingCoverage.join(", ")}.`
        : "Coverage gaps are not fully diagnosed yet.",
      "Keep the pilot scope narrow and ask for the next event type that closes the biggest gap.",
    ],
    proofChecklist: [
      "source-only report has demoDataIncluded=false",
      "at least one provider/model is represented",
      "missing coverage is named before broadening instrumentation",
    ],
    nonGoals: [
      "do not present partial coverage as pilot-ready",
      "do not broaden instrumentation until missing coverage is resolved",
    ],
  };
}

export function buildSourceOperationalReport(
  events: SignalEvent[],
  options: { workspaceSlug?: string; generatedAt?: string; filters?: Partial<SourceReportFilters>; now?: Date } = {},
): SourceOperationalReport {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const workspaceSlug = options.workspaceSlug ?? "demo";
  const filters: SourceReportFilters = {
    range: options.filters?.range ?? "all",
    eventId: options.filters?.eventId,
    providerId: options.filters?.providerId,
    modelId: options.filters?.modelId,
  };
  const filteredEvents = filterSourceEventsForReport(events, filters, options.now ?? new Date(generatedAt));
  const sortedEvents = [...filteredEvents].sort((left, right) => new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime());
  const generationEvents = sortedEvents.filter(isGenerationEvent);
  const diagnostics = summarizeSignalEventValidation({ events: sortedEvents, rejected: [] }).diagnostics;
  const providers = buildProviderReports(sortedEvents);
  const models = buildModelReports(sortedEvents);
  const risks = buildRisks(providers, diagnostics);
  const pilotEvidence = buildPilotEvidence(sortedEvents, providers, models, diagnostics, risks);
  const nextActions =
    sortedEvents.length === 0
      ? ["send one validate-first generation.completed event from a real server-side workflow"]
      : risks.length > 0
        ? [...diagnostics.nextActions, "review the top provider/model report before widening instrumentation"].slice(0, 5)
        : ["keep sending source events and compare this source-only report with the cockpit view"];

  return {
    workspaceSlug,
    generatedAt,
    sourceOnly: true,
    demoDataIncluded: false,
    filters,
    totalEvents: sortedEvents.length,
    generationEvents: generationEvents.length,
    providerHealthEvents: sortedEvents.filter((event) => event.type === "provider.health").length,
    costEvents: sortedEvents.filter((event) => event.type === "cost.recorded" || typeof event.cost === "number").length,
    storedEventWindow: {
      firstSeenAt: sortedEvents[0]?.occurredAt,
      lastSeenAt: sortedEvents.at(-1)?.occurredAt,
    },
    diagnostics,
    providers,
    models,
    risks,
    nextActions,
    pilotEvidence,
    operatorBrief: buildOperatorBrief({
      totalEvents: sortedEvents.length,
      providers,
      models,
      risks,
      diagnostics,
      pilotEvidence,
    }),
  };
}

function csvValue(value: unknown) {
  const raw = value == null ? "" : String(value);
  const text = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function sourceOperationalReportToCsv(report: SourceOperationalReport) {
  const columns = [
    "row_type",
    "provider_id",
    "model_id",
    "status",
    "event_count",
    "generation_count",
    "success_rate",
    "failure_rate",
    "retry_rate",
    "p95_ms",
    "total_cost",
    "last_seen_at",
  ];
  const providerRows = report.providers.map((provider) => [
    "provider",
    provider.providerId,
    "",
    provider.status,
    provider.eventCount,
    provider.generationCount,
    provider.successRate,
    provider.failureRate,
    provider.retryRate,
    provider.p95Ms,
    provider.totalCost,
    provider.lastSeenAt,
  ]);
  const modelRows = report.models.map((model) => [
    "model",
    model.providerId,
    model.modelId,
    "",
    "",
    model.generationCount,
    model.successRate,
    model.failureRate,
    "",
    model.p95Ms,
    model.totalCost,
    model.lastSeenAt,
  ]);

  return [columns, ...providerRows, ...modelRows]
    .map((row) => row.map(csvValue).join(","))
    .join("\r\n");
}

function markdownList(items: string[]) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- none";
}

function markdownTable(headers: string[], rows: Array<Array<string | number | null>>) {
  if (rows.length === 0) {
    return "No rows.";
  }

  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((value) => value ?? "n/a").join(" | ")} |`),
  ].join("\n");
}

export function sourceOperationalReportToMarkdown(report: SourceOperationalReport) {
  return [
    `# SignalOps Source Report: ${report.workspaceSlug}`,
    "",
    `Generated: ${report.generatedAt}`,
    `Source only: ${report.sourceOnly}`,
    `Demo data included: ${report.demoDataIncluded}`,
    `Filters: range=${report.filters.range}${report.filters.eventId ? `, event=${report.filters.eventId}` : ""}${report.filters.providerId ? `, provider=${report.filters.providerId}` : ""}${report.filters.modelId ? `, model=${report.filters.modelId}` : ""}`,
    "",
    "## Summary",
    "",
    `- Total events: ${report.totalEvents}`,
    `- Generation events: ${report.generationEvents}`,
    `- Provider health events: ${report.providerHealthEvents}`,
    `- Cost events: ${report.costEvents}`,
    `- Readiness: ${report.diagnostics.readiness}`,
    `- First seen: ${report.storedEventWindow.firstSeenAt ?? "none"}`,
    `- Last seen: ${report.storedEventWindow.lastSeenAt ?? "none"}`,
    "",
    "## Risks",
    "",
    markdownList(report.risks),
    "",
    "## Pilot Evidence",
    "",
    `- Level: ${report.pilotEvidence.level}`,
    `- Ready for operator review: ${report.pilotEvidence.readyForOperatorReview}`,
    `- Summary: ${report.pilotEvidence.summary}`,
    "",
    "### Missing Coverage",
    "",
    markdownList(report.pilotEvidence.missingCoverage),
    "",
    "### Recommended Pilot Scope",
    "",
    markdownList(report.pilotEvidence.recommendedScope),
    "",
    "## Operator Brief",
    "",
    `- Decision: ${report.operatorBrief.decision}`,
    `- Headline: ${report.operatorBrief.headline}`,
    "",
    "### Talking Points",
    "",
    markdownList(report.operatorBrief.talkingPoints),
    "",
    "### Proof Checklist",
    "",
    markdownList(report.operatorBrief.proofChecklist),
    "",
    "### Non-goals",
    "",
    markdownList(report.operatorBrief.nonGoals),
    "",
    "## Providers",
    "",
    markdownTable(
      ["Provider", "Status", "Events", "Generations", "Success", "Failure", "Retry", "p95 ms", "Cost"],
      report.providers.map((provider) => [
        provider.providerId,
        provider.status,
        provider.eventCount,
        provider.generationCount,
        `${provider.successRate}%`,
        `${provider.failureRate}%`,
        `${provider.retryRate}%`,
        provider.p95Ms,
        provider.totalCost,
      ]),
    ),
    "",
    "## Models",
    "",
    markdownTable(
      ["Provider", "Model", "Generations", "Success", "Failure", "p95 ms", "Cost"],
      report.models.map((model) => [
        model.providerId,
        model.modelId,
        model.generationCount,
        `${model.successRate}%`,
        `${model.failureRate}%`,
        model.p95Ms,
        model.totalCost,
      ]),
    ),
    "",
    "## Next Actions",
    "",
    markdownList(report.nextActions),
  ].join("\n");
}
