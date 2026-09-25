import type { PilotRequest } from "@/lib/signalops/pilot-requests";
import { buildSourceKit } from "@/lib/signalops/source-kit";

export type PilotHandoffPack = {
  pilotRequestId: string;
  generatedAt: string;
  company: string;
  contact: {
    name: string;
    email: string;
    productUrl?: string;
  };
  qualification: PilotRequest["qualification"];
  recommendedPilot: {
    targetOutcome: string;
    scope: string[];
    successSignals: string[];
    nextSteps: string[];
  };
  emailDraft: {
    subject: string;
    body: string;
  };
  callAgenda: string[];
  acceptanceChecklist: {
    preCall: string[];
    firstEventProof: string[];
    operatorReview: string[];
    nonGoals: string[];
  };
  sourceIntegration: {
    requiredServerEnv: string[];
    validateEndpoint: string;
    ingestEndpoint: string;
    sampleEvent: ReturnType<typeof buildSourceKit>["sampleEvent"];
    validateCurl: string;
    ingestCurl: string;
    curl: string;
    nodeSnippet: string;
    preflightCommands: string[];
  };
  markdown: string;
};

function companyName(request: PilotRequest) {
  return request.company || request.name;
}

function targetOutcome(request: PilotRequest) {
  return (
    request.desiredOutcome ||
    "Prove that SignalOps can identify provider, model, latency, retry, and cost issues before they become user-visible incidents."
  );
}

function pilotScope(request: PilotRequest) {
  const scope = [
    "Connect one server-side generation path with validate-first source events.",
    "Send generation.completed and generation.failed events for one production workflow.",
    "Review latency, retry, provider-health, and cost signals in the operator cockpit.",
  ];

  if (request.providers) {
    scope.push(`Tag provider IDs from the current stack: ${request.providers}.`);
  }

  if (request.generationVolume) {
    scope.push(`Use the reported volume as the baseline: ${request.generationVolume}.`);
  }

  return scope;
}

function successSignals(request: PilotRequest) {
  return [
    "At least one real source event is accepted into durable storage.",
    "A failing or retrying generation path is visible in the cockpit within the pilot window.",
    "The team can name the provider/model or workflow responsible for a real operational issue.",
    targetOutcome(request),
  ];
}

function nextSteps(request: PilotRequest) {
  const status = request.lifecycle?.status ?? "new";
  const steps = [
    status === "new" ? "Send the first qualification reply." : "Follow up from the current lifecycle state.",
    "Ask for one representative source-event payload from the server-side generation path.",
    "Schedule a 30-minute setup call and agree on the first workflow to instrument.",
  ];

  if (request.lifecycle?.nextActionAt) {
    steps.push(`Keep the next operator action on ${request.lifecycle.nextActionAt}.`);
  } else {
    steps.push("Set a next-action date after the first reply.");
  }

  return steps;
}

function acceptanceChecklist(request: PilotRequest): PilotHandoffPack["acceptanceChecklist"] {
  return {
    preCall: [
      "Confirm the source app has one server-side generation path selected for instrumentation.",
      "Confirm who can add SIGNALOPS_BASE_URL and SIGNALOPS_INGEST_TOKEN to that source app.",
      request.providers
        ? `Map the reported provider list to stable providerId values: ${request.providers}.`
        : "Map provider names to stable providerId values before sending events.",
      "Validate one representative generation.completed payload before enabling durable ingest.",
    ],
    firstEventProof: [
      "Durable storage is configured in the existing SignalOps deployment.",
      "A non-validation event is accepted by /api/events with the source app ingest token.",
      "The same event appears in /api/source-report with demoDataIncluded=false.",
      "The first-source-event gate is closed by stored source traffic, not by seeded demo data.",
    ],
    operatorReview: [
      "Review the source-only report for provider/model coverage, latency, cost, and retry gaps.",
      "Decide whether the pilot has enough signal to move from contacted to pilot_scoped.",
      "Set the next operator action date and keep the pilot queue lifecycle current.",
    ],
    nonGoals: [
      "Do not count validation-only requests as real source traffic.",
      "Do not broaden instrumentation beyond one workflow before first-event proof is visible.",
      "Do not claim production readiness until durable storage, pilot delivery, operator access, and first source traffic are all proven.",
    ],
  };
}

function emailBody(request: PilotRequest, baseUrl: string) {
  const lines = [
    `Hi ${request.name},`,
    "",
    `Thanks for sharing the ${companyName(request)} generation workflow. Based on your notes, the first useful SignalOps pilot should stay narrow: one production generation path, real source events, and a clear read on latency/retry/provider reliability.`,
    "",
    `What I would like to prove first: ${targetOutcome(request)}`,
    "",
    "Suggested next step: send one example generation event from the server side, or we can walk through it together on a 30-minute setup call.",
    "",
    `Source kit: ${baseUrl.replace(/\/$/, "")}/api/source-kit`,
    `Validator: ${baseUrl.replace(/\/$/, "")}/docs`,
    "",
    "If this looks right, I will scope the first workflow and the success signal before asking you to connect anything broader.",
  ];

  return lines.join("\n");
}

function markdownList(items: string[]) {
  return items.map((item) => `- ${item}`).join("\n");
}

function buildMarkdown(pack: Omit<PilotHandoffPack, "markdown">) {
  return [
    `# SignalOps Pilot Handoff: ${pack.company}`,
    "",
    `Generated: ${pack.generatedAt}`,
    `Pilot request: ${pack.pilotRequestId}`,
    `Qualification: ${pack.qualification.tier}`,
    `Contact: ${pack.contact.name} <${pack.contact.email}>`,
    pack.contact.productUrl ? `Product: ${pack.contact.productUrl}` : "",
    "",
    "## Target Outcome",
    "",
    pack.recommendedPilot.targetOutcome,
    "",
    "## Pilot Scope",
    "",
    markdownList(pack.recommendedPilot.scope),
    "",
    "## Success Signals",
    "",
    markdownList(pack.recommendedPilot.successSignals),
    "",
    "## Next Steps",
    "",
    markdownList(pack.recommendedPilot.nextSteps),
    "",
    "## Call Agenda",
    "",
    markdownList(pack.callAgenda),
    "",
    "## Acceptance Checklist",
    "",
    "Pre-call:",
    markdownList(pack.acceptanceChecklist.preCall),
    "",
    "First event proof:",
    markdownList(pack.acceptanceChecklist.firstEventProof),
    "",
    "Operator review:",
    markdownList(pack.acceptanceChecklist.operatorReview),
    "",
    "Non-goals:",
    markdownList(pack.acceptanceChecklist.nonGoals),
    "",
    "## Email Draft",
    "",
    `Subject: ${pack.emailDraft.subject}`,
    "",
    pack.emailDraft.body,
    "",
    "## Source Integration",
    "",
    `Validate endpoint: ${pack.sourceIntegration.validateEndpoint}`,
    `Ingest endpoint: ${pack.sourceIntegration.ingestEndpoint}`,
    "",
    "Required server env:",
    markdownList(pack.sourceIntegration.requiredServerEnv),
    "",
    "Validate without storing:",
    "",
    "```bash",
    pack.sourceIntegration.validateCurl,
    "```",
    "",
    "Store after ingest token and durable storage are ready:",
    "",
    "```bash",
    pack.sourceIntegration.ingestCurl,
    "```",
    "",
    "SDK snippet:",
    "",
    "```ts",
    pack.sourceIntegration.nodeSnippet,
    "```",
    "",
    "Preflight commands:",
    "",
    "```bash",
    pack.sourceIntegration.preflightCommands.join("\n"),
    "```",
  ].filter(Boolean).join("\n");
}

export function buildPilotHandoffPack(
  request: PilotRequest,
  options: { baseUrl?: string; generatedAt?: string } = {},
): PilotHandoffPack {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const sourceKit = buildSourceKit(options.baseUrl);
  const company = companyName(request);
  const packWithoutMarkdown: Omit<PilotHandoffPack, "markdown"> = {
    pilotRequestId: request.id,
    generatedAt,
    company,
    contact: {
      name: request.name,
      email: request.email,
      productUrl: request.productUrl,
    },
    qualification: request.qualification,
    recommendedPilot: {
      targetOutcome: targetOutcome(request),
      scope: pilotScope(request),
      successSignals: successSignals(request),
      nextSteps: nextSteps(request),
    },
    emailDraft: {
      subject: `SignalOps pilot for ${company}`,
      body: emailBody(request, sourceKit.baseUrl),
    },
    callAgenda: [
      "Confirm the generation workflow, provider stack, and where source events can be emitted.",
      "Pick one event path to validate before enabling durable ingest.",
      "Agree on a pilot success signal and the first follow-up date.",
      "Decide whether this pilot should use D1, Supabase, webhook, or email delivery first.",
    ],
    acceptanceChecklist: acceptanceChecklist(request),
    sourceIntegration: {
      requiredServerEnv: sourceKit.requiredServerEnv,
      validateEndpoint: sourceKit.endpoints.validate,
      ingestEndpoint: sourceKit.endpoints.ingest,
      sampleEvent: sourceKit.sampleEvent,
      validateCurl: sourceKit.snippets.validateCurl,
      ingestCurl: sourceKit.snippets.ingestCurl,
      curl: sourceKit.snippets.ingestCurl,
      nodeSnippet: sourceKit.snippets.node,
      preflightCommands: [
        `SIGNALOPS_BASE_URL=${sourceKit.baseUrl} pnpm verify:pilot-preflight -- --allow-storage-gate`,
        `SIGNALOPS_BASE_URL=${sourceKit.baseUrl} SIGNALOPS_INGEST_TOKEN=... SIGNALOPS_OPERATOR_TOKEN=... pnpm verify:pilot-preflight -- --require-pilot-ready`,
      ],
    },
  };

  return {
    ...packWithoutMarkdown,
    markdown: buildMarkdown(packWithoutMarkdown),
  };
}
