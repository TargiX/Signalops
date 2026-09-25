export type PilotQualification = {
  tier: "evaluate" | "strong_fit" | "urgent_fit";
  signals: string[];
};

export type PilotRequestStatus = "new" | "contacted" | "pilot_scoped" | "closed";

export type PilotRequestLifecycle = {
  status: PilotRequestStatus;
  operatorNote?: string;
  nextActionAt?: string;
  updatedAt: string;
};

export type PilotRequestActivity = {
  id: string;
  pilotRequestId: string;
  type: "submitted" | "lifecycle_updated";
  actor: "system" | "operator";
  status?: PilotRequestStatus;
  summary: string;
  createdAt: string;
};

export type PilotRequest = {
  id: string;
  createdAt: string;
  name: string;
  email: string;
  company?: string;
  productUrl?: string;
  generationVolume?: string;
  providers?: string;
  primaryPain?: string;
  urgency?: "exploring" | "this_month" | "blocked_now";
  desiredOutcome?: string;
  useCase: string;
  source: string;
  qualification: PilotQualification;
  lifecycle: PilotRequestLifecycle;
  activity: PilotRequestActivity[];
};

export type PilotRequestFallbackPackage = {
  type: "signalops.pilot_request";
  createdAt: string;
  requestId: string;
  qualification: PilotQualification;
  request: PilotRequest;
  links?: ReturnType<typeof pilotRequestToWebhookPayload>["links"];
  integration?: ReturnType<typeof pilotRequestToWebhookPayload>["integration"];
  operatorNextActions: string[];
  acceptanceChecklist: {
    preCall: string[];
    firstEventProof: string[];
    nonGoals: string[];
  };
  sourceEventSample: {
    type: "generation.completed";
    generationId: string;
    providerId: string;
    modelId: string;
    status: "succeeded";
    source: string;
    durationMs: number;
    cost: number;
  };
};

export type PilotRequestFollowUpFilter = "all" | "open" | "due" | "unscheduled";

export type PilotRequestOperatorFilters = {
  status?: PilotRequestStatus;
  tier?: PilotQualification["tier"];
  followUp?: PilotRequestFollowUpFilter;
};

const qualificationPriority: Record<PilotQualification["tier"], number> = {
  urgent_fit: 0,
  strong_fit: 1,
  evaluate: 2,
};

const lifecyclePriority: Record<PilotRequestStatus, number> = {
  new: 0,
  contacted: 1,
  pilot_scoped: 2,
  closed: 3,
};

function emptyStatusCounts(): Record<PilotRequestStatus, number> {
  return {
    new: 0,
    contacted: 0,
    pilot_scoped: 0,
    closed: 0,
  };
}

function emptyTierCounts(): Record<PilotQualification["tier"], number> {
  return {
    evaluate: 0,
    strong_fit: 0,
    urgent_fit: 0,
  };
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
}

export function isPilotRequestSpamTrapTriggered(input: unknown) {
  return isRecord(input) && readString(input.website, 240).length > 0;
}

function readUrgency(value: unknown): PilotRequest["urgency"] | undefined {
  const raw = readString(value, 40);
  return raw === "exploring" || raw === "this_month" || raw === "blocked_now" ? raw : undefined;
}

function readPilotRequestStatus(value: unknown): PilotRequestStatus | undefined {
  const raw = readString(value, 40);
  return raw === "new" || raw === "contacted" || raw === "pilot_scoped" || raw === "closed" ? raw : undefined;
}

function readIsoDate(value: unknown) {
  const raw = readString(value, 80);
  if (!raw) {
    return undefined;
  }

  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function includesAny(value: string | undefined, patterns: RegExp[]) {
  return Boolean(value && patterns.some((pattern) => pattern.test(value)));
}

function activityId() {
  return `act_${crypto.randomUUID()}`;
}

function qualifyPilotRequest(input: {
  generationVolume?: string;
  providers?: string;
  primaryPain?: string;
  urgency?: PilotRequest["urgency"];
  desiredOutcome?: string;
  useCase: string;
}): PilotQualification {
  const signals: string[] = [];

  if (input.urgency === "blocked_now") {
    signals.push("blocked_now");
  } else if (input.urgency === "this_month") {
    signals.push("near_term_need");
  }

  if (includesAny(input.generationVolume, [/\d{2,}/, /k|m|million|thousand|day|month/i])) {
    signals.push("meaningful_generation_volume");
  }

  if (includesAny(input.providers, [/,| and |openai|fal|replicate|gemini|anthropic|mistral|stability/i])) {
    signals.push("multi_provider_or_named_provider");
  }

  const painText = [input.primaryPain, input.useCase, input.desiredOutcome].filter(Boolean).join(" ");
  if (includesAny(painText, [/latency|p95|slow|timeout/i])) {
    signals.push("latency_pain");
  }
  if (includesAny(painText, [/retry|fail|error|incident|outage/i])) {
    signals.push("reliability_pain");
  }
  if (includesAny(painText, [/cost|spend|budget|margin|expensive/i])) {
    signals.push("cost_pain");
  }

  const uniqueSignals = [...new Set(signals)];
  const tier =
    uniqueSignals.includes("blocked_now") && uniqueSignals.length >= 4
      ? "urgent_fit"
      : uniqueSignals.length >= 3
        ? "strong_fit"
        : "evaluate";

  return {
    tier,
    signals: uniqueSignals,
  };
}

export function normalizePilotRequest(input: unknown): PilotRequest {
  if (!isRecord(input)) {
    throw new Error("pilot request must be an object");
  }

  const name = readString(input.name, 120);
  const email = readString(input.email, 180).toLowerCase();
  const company = readString(input.company, 160);
  const productUrl = readString(input.productUrl, 240);
  const generationVolume = readString(input.generationVolume, 120);
  const providers = readString(input.providers, 240);
  const primaryPain = readString(input.primaryPain, 500);
  const urgency = readUrgency(input.urgency);
  const desiredOutcome = readString(input.desiredOutcome, 500);
  const useCase = readString(input.useCase, 1400);
  const source = readString(input.source, 80) || "pilot-page";

  if (!name) {
    throw new Error("name is required");
  }

  if (!emailPattern.test(email)) {
    throw new Error("valid email is required");
  }

  if (!generationVolume) {
    throw new Error("generationVolume is required");
  }

  if (!providers) {
    throw new Error("providers is required");
  }

  if (!primaryPain) {
    throw new Error("primaryPain is required");
  }

  if (!urgency) {
    throw new Error("urgency is required");
  }

  if (!desiredOutcome) {
    throw new Error("desiredOutcome is required");
  }

  if (useCase.length < 20) {
    throw new Error("useCase must describe the product and AI generation workflow");
  }

  const createdAt = new Date().toISOString();
  const id = `pilot_${crypto.randomUUID()}`;

  return {
    id,
    createdAt,
    name,
    email,
    company: company || undefined,
    productUrl: productUrl || undefined,
    generationVolume: generationVolume || undefined,
    providers: providers || undefined,
    primaryPain: primaryPain || undefined,
    urgency,
    desiredOutcome: desiredOutcome || undefined,
    useCase,
    source,
    qualification: qualifyPilotRequest({
      generationVolume: generationVolume || undefined,
      providers: providers || undefined,
      primaryPain: primaryPain || undefined,
      urgency,
      desiredOutcome: desiredOutcome || undefined,
      useCase,
    }),
    lifecycle: {
      status: "new",
      updatedAt: createdAt,
    },
    activity: [
      {
        id: activityId(),
        pilotRequestId: id,
        type: "submitted",
        actor: "system",
        status: "new",
        summary: "Pilot request submitted",
        createdAt,
      },
    ],
  };
}

export function normalizePilotRequestLifecycleUpdate(input: unknown) {
  if (!isRecord(input)) {
    throw new Error("lifecycle update must be an object");
  }

  const id = readString(input.id, 120);
  const status = readPilotRequestStatus(input.status);
  const operatorNote = readString(input.operatorNote, 1200);
  const nextActionAt = readIsoDate(input.nextActionAt);

  if (!id) {
    throw new Error("id is required");
  }

  if (input.status && !status) {
    throw new Error("status must be new, contacted, pilot_scoped, or closed");
  }

  if (input.nextActionAt && !nextActionAt) {
    throw new Error("nextActionAt must be a valid date");
  }

  if (!status && !operatorNote && !nextActionAt && input.nextActionAt !== null) {
    throw new Error("status, operatorNote, or nextActionAt is required");
  }

  return {
    id,
    status,
    operatorNote: operatorNote || undefined,
    nextActionAt: input.nextActionAt === null ? null : nextActionAt,
    updatedAt: new Date().toISOString(),
  };
}

export type PilotRequestLifecycleUpdate = ReturnType<typeof normalizePilotRequestLifecycleUpdate>;

export function applyPilotRequestLifecycleUpdate(
  request: PilotRequest,
  update: PilotRequestLifecycleUpdate,
): PilotRequest {
  const lifecycle = request.lifecycle ?? { status: "new" as const, updatedAt: request.createdAt };
  const nextLifecycle = {
    status: update.status ?? lifecycle.status,
    operatorNote: update.operatorNote ?? lifecycle.operatorNote,
    nextActionAt: update.nextActionAt === null ? undefined : update.nextActionAt ?? lifecycle.nextActionAt,
    updatedAt: update.updatedAt,
  };
  const summaryParts = [
    update.status && update.status !== lifecycle.status ? `status ${lifecycle.status} -> ${update.status}` : "",
    update.nextActionAt === null
      ? "cleared next action"
      : update.nextActionAt
        ? `next action ${update.nextActionAt}`
        : "",
    update.operatorNote ? "operator note updated" : "",
  ].filter(Boolean);
  const activity: PilotRequestActivity = {
    id: activityId(),
    pilotRequestId: request.id,
    type: "lifecycle_updated",
    actor: "operator",
    status: nextLifecycle.status,
    summary: summaryParts.join("; ") || "Lifecycle updated",
    createdAt: update.updatedAt,
  };

  return {
    ...request,
    lifecycle: nextLifecycle,
    activity: [
      ...(request.activity ?? []),
      activity,
    ].slice(-50),
  };
}

function trimBaseUrl(value: string | undefined) {
  return value?.replace(/\/$/, "");
}

export function pilotRequestToWebhookPayload(request: PilotRequest, options: { baseUrl?: string } = {}) {
  const baseUrl = trimBaseUrl(options.baseUrl);

  return {
    type: "pilot.requested",
    createdAt: request.createdAt,
    pilotRequest: request,
    qualification: request.qualification,
    links: baseUrl
      ? {
          sourceKit: `${baseUrl}/api/source-kit`,
          docs: `${baseUrl}/docs`,
          publicStatus: `${baseUrl}/status`,
          setup: `${baseUrl}/setup`,
        }
      : undefined,
    integration: baseUrl
      ? {
          validateFirst: true,
          requiredServerEnv: ["SIGNALOPS_BASE_URL", "SIGNALOPS_INGEST_TOKEN"],
          preflightCommands: [
            `SIGNALOPS_BASE_URL=${baseUrl} pnpm verify:pilot-preflight -- --allow-storage-gate`,
            `SIGNALOPS_BASE_URL=${baseUrl} SIGNALOPS_INGEST_TOKEN=... SIGNALOPS_OPERATOR_TOKEN=... pnpm verify:pilot-preflight -- --require-pilot-ready`,
          ],
        }
      : undefined,
    operatorNextActions: [
      "Send the first qualification reply.",
      "Ask for one representative source-event payload from the server-side generation path.",
      "Run the source kit validator before enabling durable ingest.",
      "Agree on the first workflow and success signal for a controlled pilot.",
    ],
  };
}

function firstProviderId(request: PilotRequest) {
  return request.providers?.split(/,| and /i).map((item) => item.trim()).filter(Boolean)[0] || "provider-id";
}

export function pilotRequestToFallbackPackage(
  request: PilotRequest,
  options: { baseUrl?: string; requestId: string },
): PilotRequestFallbackPackage {
  const webhookPayload = pilotRequestToWebhookPayload(request, { baseUrl: options.baseUrl });
  const providerId = firstProviderId(request);

  return {
    type: "signalops.pilot_request",
    createdAt: new Date().toISOString(),
    requestId: options.requestId,
    qualification: request.qualification,
    request,
    links: webhookPayload.links,
    integration: webhookPayload.integration,
    operatorNextActions: webhookPayload.operatorNextActions,
    acceptanceChecklist: {
      preCall: [
        "Choose one server-side generation path for the first pilot workflow.",
        "Validate one representative generation.completed event before enabling durable ingest.",
        "Confirm who can add SIGNALOPS_BASE_URL and SIGNALOPS_INGEST_TOKEN to the source app.",
      ],
      firstEventProof: [
        "A non-validation event is accepted by /api/events after durable storage is connected.",
        "The event appears in /api/source-report with demoDataIncluded=false.",
        "The first source event gate is closed by stored source traffic, not by seeded demo data.",
      ],
      nonGoals: [
        "Do not count validation-only requests as real source traffic.",
        "Do not broaden instrumentation beyond one workflow before first-event proof is visible.",
        "Do not claim production readiness until durable storage, pilot delivery, operator access, and first source traffic are all proven.",
      ],
    },
    sourceEventSample: {
      type: "generation.completed",
      generationId: "gen_pilot_001",
      providerId,
      modelId: "model-id",
      status: "succeeded",
      source: request.source || "pilot-source-app",
      durationMs: 18420,
      cost: 0.052,
    },
  };
}

export function sortPilotRequestsForOperator(requests: PilotRequest[]) {
  return [...requests].sort((left, right) => {
    const lifecycleDelta =
      lifecyclePriority[left.lifecycle?.status ?? "new"] - lifecyclePriority[right.lifecycle?.status ?? "new"];
    if (lifecycleDelta !== 0) {
      return lifecycleDelta;
    }

    const tierDelta = qualificationPriority[left.qualification.tier] - qualificationPriority[right.qualification.tier];
    if (tierDelta !== 0) {
      return tierDelta;
    }

    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });
}

export function filterPilotRequestsForOperator(
  requests: PilotRequest[],
  filters: PilotRequestOperatorFilters,
  now = new Date(),
) {
  return requests.filter((request) => {
    const status = request.lifecycle?.status ?? "new";
    if (filters.status && status !== filters.status) {
      return false;
    }

    if (filters.tier && request.qualification.tier !== filters.tier) {
      return false;
    }

    const followUp = filters.followUp ?? "all";
    if (followUp === "all") {
      return true;
    }

    const isOpen = status !== "closed";
    if (followUp === "open") {
      return isOpen;
    }

    if (!isOpen) {
      return false;
    }

    const nextActionAt = request.lifecycle?.nextActionAt;
    if (followUp === "unscheduled") {
      return !nextActionAt;
    }

    if (followUp === "due") {
      return Boolean(nextActionAt && new Date(nextActionAt).getTime() <= now.getTime());
    }

    return true;
  });
}

export function buildPilotRequestOperatorSummary(requests: PilotRequest[], now = new Date()) {
  const byStatus = emptyStatusCounts();
  const byTier = emptyTierCounts();
  let openCount = 0;
  let urgentOpenCount = 0;
  let needsFollowUpCount = 0;
  let unscheduledOpenCount = 0;
  let latestCreatedAt: string | undefined;
  let nextActionDueAt: string | undefined;

  for (const request of requests) {
    const status = request.lifecycle?.status ?? "new";
    const tier = request.qualification.tier;
    const isOpen = status !== "closed";

    byStatus[status] += 1;
    byTier[tier] += 1;

    if (!latestCreatedAt || new Date(request.createdAt).getTime() > new Date(latestCreatedAt).getTime()) {
      latestCreatedAt = request.createdAt;
    }

    if (!isOpen) {
      continue;
    }

    openCount += 1;
    if (tier === "urgent_fit") {
      urgentOpenCount += 1;
    }

    const nextActionAt = request.lifecycle?.nextActionAt;
    if (!nextActionAt) {
      unscheduledOpenCount += 1;
      continue;
    }

    const nextActionTime = new Date(nextActionAt).getTime();
    if (Number.isFinite(nextActionTime) && nextActionTime <= now.getTime()) {
      needsFollowUpCount += 1;
      if (!nextActionDueAt || nextActionTime < new Date(nextActionDueAt).getTime()) {
        nextActionDueAt = nextActionAt;
      }
    }
  }

  return {
    total: requests.length,
    openCount,
    urgentOpenCount,
    needsFollowUpCount,
    unscheduledOpenCount,
    byStatus,
    byTier,
    latestCreatedAt,
    nextActionDueAt,
  };
}
