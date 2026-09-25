import type { SignalEvent } from "@/lib/signalops/events";
import type { StoreHealth, StoreWriteResult } from "@/lib/signalops/store";

export type SourceEventReceipt = {
  type: "signalops.source_event_receipt";
  requestId: string;
  workspaceSlug: string;
  acceptedEventIds: string[];
  storedEventIds: string[];
  duplicateEvents: number;
  duplicateEventIds: string[];
  storage: {
    adapter: StoreHealth["adapter"];
    durable: boolean;
    ready: boolean;
  };
  proof: {
    demoDataIncluded: false;
    sourceOnlyReportPath: string;
    exactSourceReportPath: string | null;
    durableWrite: boolean;
    existingEventCandidate: boolean;
    firstSourceEventCandidate: boolean;
  };
  nextActions: string[];
};

export function buildSourceEventReceipt(options: {
  requestId: string;
  workspaceSlug: string;
  events: SignalEvent[];
  result: StoreWriteResult;
  storage: StoreHealth;
}): SourceEventReceipt {
  const durableWrite = options.storage.durable && options.storage.ready && options.result.storedEvents > 0;
  const sourceOnlyReportPath = `/source-report?range=24h`;
  const proofEventId = options.result.storedEventIds[0] ?? options.result.duplicateEventIds[0];
  const existingEventCandidate = options.storage.ready && Boolean(proofEventId);
  const duplicateOnlyProof = options.result.storedEvents === 0 && options.result.duplicateEvents > 0 && existingEventCandidate;
  const exactSourceReportPath = proofEventId
    ? `/source-report?range=all&eventId=${encodeURIComponent(proofEventId)}`
    : null;

  return {
    type: "signalops.source_event_receipt",
    requestId: options.requestId,
    workspaceSlug: options.workspaceSlug,
    acceptedEventIds: options.events.map((event) => event.eventId),
    storedEventIds: options.result.storedEventIds,
    duplicateEvents: options.result.duplicateEvents,
    duplicateEventIds: options.result.duplicateEventIds,
    storage: {
      adapter: options.storage.adapter,
      durable: options.storage.durable,
      ready: options.storage.ready,
    },
    proof: {
      demoDataIncluded: false,
      sourceOnlyReportPath,
      exactSourceReportPath,
      durableWrite,
      existingEventCandidate,
      firstSourceEventCandidate: durableWrite,
    },
    nextActions: durableWrite
      ? [
          `Open ${exactSourceReportPath ?? sourceOnlyReportPath} with operator access and verify demoDataIncluded=false.`,
          "Run SIGNALOPS_BASE_URL=https://signalops.cc SIGNALOPS_INGEST_TOKEN=... SIGNALOPS_OPERATOR_TOKEN=... pnpm verify:pilot-preflight -- --require-pilot-ready.",
        ]
      : duplicateOnlyProof
        ? [
            `Open ${exactSourceReportPath ?? sourceOnlyReportPath} with operator access and verify demoDataIncluded=false.`,
            "Duplicate ingest did not create a new row; use the exact report path to verify the existing source event.",
          ]
      : [
          "This receipt proves validation and acceptance only; durable proof still requires D1 or Supabase storage.",
          "Connect an existing Cloudflare D1 database or approved Supabase project, then send one real server-side source event.",
        ],
  };
}
