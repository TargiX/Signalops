import { createHash } from "node:crypto";

export const DEFAULT_MEMORY_INGEST_CAPACITY = 1_000;

export type IngestibleSignalEvent = {
  eventId: string;
  receivedAt?: string;
};

export type SignalEventSinkWriteResult = {
  acceptedEvents: number;
  storedEvents: number;
  duplicateEvents: number;
  conflictEvents: number;
  evictedEvents: number;
  retainedEvents: number;
  storedEventIds: string[];
  duplicateEventIds: string[];
  conflictEventIds: string[];
};

export type SignalEventSink = {
  adapter: string;
  durable: boolean;
  capacity: number | null;
  store(events: readonly IngestibleSignalEvent[]): Promise<SignalEventSinkWriteResult>;
};

export type MemorySignalEventSink = SignalEventSink & {
  adapter: "memory";
  durable: false;
  capacity: number;
  reset(): void;
  snapshot(): IngestibleSignalEvent[];
};

const globalIngestState = globalThis as typeof globalThis & {
  __signalopsDevelopmentIngestSink?: MemorySignalEventSink;
};

function payloadFingerprint(event: IngestibleSignalEvent) {
  const stablePayload = Object.entries(event)
    .filter(([key, value]) => key !== "receivedAt" && value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));

  return createHash("sha256").update(JSON.stringify(stablePayload), "utf8").digest("hex");
}

export function createMemorySignalEventSink(
  options: { capacity?: number } = {},
): MemorySignalEventSink {
  const capacity = options.capacity ?? DEFAULT_MEMORY_INGEST_CAPACITY;
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10_000) {
    throw new RangeError("Memory ingest capacity must be an integer between 1 and 10000.");
  }

  const events = new Map<
    string,
    { event: IngestibleSignalEvent; payloadFingerprint: string }
  >();

  return {
    adapter: "memory",
    durable: false,
    capacity,
    async store(incomingEvents) {
      const duplicateEventIds: string[] = [];
      const conflictEventIds: string[] = [];
      let evictedEvents = 0;

      const incoming = incomingEvents.map((event) => ({
        event,
        payloadFingerprint: payloadFingerprint(event),
      }));
      const knownFingerprints = new Map(
        [...events].map(([eventId, stored]) => [eventId, stored.payloadFingerprint]),
      );
      const pendingEvents = new Map<
        string,
        { event: IngestibleSignalEvent; payloadFingerprint: string }
      >();

      for (const candidate of incoming) {
        const knownFingerprint = knownFingerprints.get(candidate.event.eventId);
        if (knownFingerprint === undefined) {
          knownFingerprints.set(candidate.event.eventId, candidate.payloadFingerprint);
          pendingEvents.set(candidate.event.eventId, candidate);
        } else if (knownFingerprint !== candidate.payloadFingerprint) {
          conflictEventIds.push(candidate.event.eventId);
        } else {
          duplicateEventIds.push(candidate.event.eventId);
        }
      }

      if (conflictEventIds.length > 0) {
        return {
          acceptedEvents: incomingEvents.length,
          storedEvents: 0,
          duplicateEvents: 0,
          conflictEvents: new Set(conflictEventIds).size,
          evictedEvents: 0,
          retainedEvents: events.size,
          storedEventIds: [],
          duplicateEventIds: [],
          conflictEventIds: [...new Set(conflictEventIds)],
        };
      }

      for (const candidate of pendingEvents.values()) {
        events.set(candidate.event.eventId, {
          event: { ...candidate.event },
          payloadFingerprint: candidate.payloadFingerprint,
        });

        if (events.size > capacity) {
          const oldestEventId = events.keys().next().value;
          if (oldestEventId) {
            events.delete(oldestEventId);
            evictedEvents += 1;
          }
        }
      }

      return {
        acceptedEvents: incomingEvents.length,
        storedEvents: pendingEvents.size,
        duplicateEvents: duplicateEventIds.length,
        conflictEvents: 0,
        evictedEvents,
        retainedEvents: events.size,
        storedEventIds: [...pendingEvents.keys()],
        duplicateEventIds,
        conflictEventIds,
      };
    },
    reset() {
      events.clear();
    },
    snapshot() {
      return [...events.values()].map(({ event }) => ({ ...event }));
    },
  };
}

export function getDevelopmentSignalEventSink() {
  if (!globalIngestState.__signalopsDevelopmentIngestSink) {
    globalIngestState.__signalopsDevelopmentIngestSink = createMemorySignalEventSink();
  }

  return globalIngestState.__signalopsDevelopmentIngestSink;
}

const unavailableProductionSink: SignalEventSink = {
  adapter: "unconfigured",
  durable: false,
  capacity: null,
  async store() {
    throw new Error("Production ingest storage is unavailable.");
  },
};

export function getSignalEventSinkForRuntime(
  env: Record<string, string | undefined> = process.env,
) {
  return env.NODE_ENV === "production" || Boolean(env.VERCEL)
    ? unavailableProductionSink
    : getDevelopmentSignalEventSink();
}
