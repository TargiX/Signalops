import "server-only";

import type { SignalEvent } from "@/lib/signalops/events";
import {
  applyPilotRequestLifecycleUpdate,
  sortPilotRequestsForOperator,
  type PilotRequest,
  type PilotRequestActivity,
  type PilotRequestLifecycleUpdate,
} from "@/lib/signalops/pilot-requests";
import { isPlaceholderValue, missingConfiguredEnv } from "@/lib/signalops/runtime-config";
import type { SourceReportFilters } from "@/lib/signalops/source-report";

export type StoreHealth = {
  adapter: "memory" | "cloudflare_d1" | "supabase";
  durable: boolean;
  ready: boolean;
  missing: string[];
};

export type StoreWriteResult = {
  accepted: number;
  storedEvents: number;
  duplicateEvents: number;
  storedEventIds: string[];
  duplicateEventIds: string[];
};

export type EventListOptions = {
  filters?: SourceReportFilters;
  now?: Date;
};

type SignalOpsStore = {
  health(): StoreHealth;
  listEvents(workspaceSlug: string, limit: number, options?: EventListOptions): Promise<SignalEvent[]>;
  listPilotRequests(limit: number): Promise<PilotRequest[]>;
  updatePilotRequestLifecycle(update: PilotRequestLifecycleUpdate): Promise<PilotRequest | null>;
  storeEvents(workspaceSlug: string, events: SignalEvent[]): Promise<StoreWriteResult>;
  storePilotRequest(request: PilotRequest): Promise<void>;
};

const globalStore = globalThis as typeof globalThis & {
  __signalopsMemoryEvents?: Map<string, SignalEvent>;
  __signalopsPilotRequests?: Map<string, PilotRequest>;
};

function getMemoryEvents() {
  if (!globalStore.__signalopsMemoryEvents) {
    globalStore.__signalopsMemoryEvents = new Map();
  }

  return globalStore.__signalopsMemoryEvents;
}

function eventStorageKey(workspaceSlug: string, eventId: string) {
  return `${workspaceSlug}:${eventId}`;
}

function getMemoryPilotRequests() {
  if (!globalStore.__signalopsPilotRequests) {
    globalStore.__signalopsPilotRequests = new Map();
  }

  return globalStore.__signalopsPilotRequests;
}

function sourceReportRangeStart(filters: SourceReportFilters | undefined, now: Date) {
  if (!filters || filters.range === "all") {
    return null;
  }

  const dayMs = 24 * 60 * 60 * 1000;
  if (filters.range === "24h") {
    return new Date(now.getTime() - dayMs).toISOString();
  }
  if (filters.range === "7d") {
    return new Date(now.getTime() - 7 * dayMs).toISOString();
  }

  return new Date(now.getTime() - 30 * dayMs).toISOString();
}

function sourceReportRangeEnd(now: Date) {
  return new Date(now.getTime() + 5 * 60 * 1000).toISOString();
}

function eventMatchesFilters(event: SignalEvent, filters: SourceReportFilters | undefined, now: Date) {
  if (!filters) {
    return true;
  }

  if (filters.eventId && event.eventId !== filters.eventId) {
    return false;
  }

  if (filters.providerId && event.providerId !== filters.providerId) {
    return false;
  }

  if (filters.modelId && event.modelId !== filters.modelId) {
    return false;
  }

  const start = sourceReportRangeStart(filters, now);
  if (!start) {
    return true;
  }

  return event.occurredAt >= start && event.occurredAt <= sourceReportRangeEnd(now);
}

class MemorySignalOpsStore implements SignalOpsStore {
  health(): StoreHealth {
    return {
      adapter: "memory",
      durable: false,
      ready: true,
      missing: [],
    };
  }

  async listEvents(workspaceSlug: string, limit: number, options: EventListOptions = {}) {
    const now = options.now ?? new Date();
    return [...getMemoryEvents().entries()]
      .filter(([key]) => key.startsWith(`${workspaceSlug}:`))
      .map(([, event]) => event)
      .filter((event) => eventMatchesFilters(event, options.filters, now))
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
      .slice(0, limit);
  }

  async storeEvents(workspaceSlug: string, events: SignalEvent[]) {
    const memoryEvents = getMemoryEvents();
    const storedEventIds: string[] = [];
    const duplicateEventIds: string[] = [];
    let duplicateEvents = 0;

    for (const event of events) {
      const key = eventStorageKey(workspaceSlug, event.eventId);
      if (memoryEvents.has(key)) {
        duplicateEvents += 1;
        duplicateEventIds.push(event.eventId);
        continue;
      }

      memoryEvents.set(key, event);
      storedEventIds.push(event.eventId);
    }

    return {
      accepted: events.length,
      storedEvents: storedEventIds.length,
      duplicateEvents,
      storedEventIds,
      duplicateEventIds,
    };
  }

  async listPilotRequests(limit: number) {
    return sortPilotRequestsForOperator([...getMemoryPilotRequests().values()]).slice(0, limit);
  }

  async updatePilotRequestLifecycle(update: PilotRequestLifecycleUpdate) {
    const requests = getMemoryPilotRequests();
    const existing = requests.get(update.id);
    if (!existing) {
      return null;
    }

    const updated = applyPilotRequestLifecycleUpdate(existing, update);
    requests.set(update.id, updated);
    return updated;
  }

  async storePilotRequest(request: PilotRequest) {
    getMemoryPilotRequests().set(request.id, request);
  }
}

type D1QueryResult<T> = {
  result?: Array<{ results?: T[] }>;
  success?: boolean;
  errors?: Array<{ message?: string }>;
};

type SupabaseEventRow = {
  event_id: string;
  payload_json: SignalEvent | string;
};

type SupabasePilotRequestRow = {
  payload_json: PilotRequest | string;
};

function latestActivity(request: PilotRequest) {
  return request.activity?.at(-1) ?? null;
}

class CloudflareD1SignalOpsStore implements SignalOpsStore {
  constructor(
    private readonly accountId: string,
    private readonly databaseId: string,
    private readonly apiToken: string,
  ) {}

  health(): StoreHealth {
    return {
      adapter: "cloudflare_d1",
      durable: true,
      ready: true,
      missing: [],
    };
  }

  private async query<T extends object>(sql: string, params: Array<string | number | null> = []) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/d1/database/${this.databaseId}/query`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ sql, params }),
      },
    );

    const json = (await response.json()) as D1QueryResult<T>;
    if (!response.ok || json.success === false) {
      const message = json.errors?.map((error) => error.message).filter(Boolean).join("; ");
      throw new Error(message || `Cloudflare D1 query failed with ${response.status}`);
    }

    return json.result?.[0]?.results ?? [];
  }

  async listEvents(workspaceSlug: string, limit: number, options: EventListOptions = {}) {
    const where = ["workspace_slug = ?"];
    const params: Array<string | number | null> = [workspaceSlug];
    if (options.filters?.eventId) {
      where.push("event_id = ?");
      params.push(options.filters.eventId);
    }
    if (options.filters?.providerId) {
      where.push("provider_id = ?");
      params.push(options.filters.providerId);
    }
    if (options.filters?.modelId) {
      where.push("model_id = ?");
      params.push(options.filters.modelId);
    }
    const now = options.now ?? new Date();
    const start = sourceReportRangeStart(options.filters, now);
    if (start) {
      where.push("occurred_at >= ?");
      params.push(start);
      where.push("occurred_at <= ?");
      params.push(sourceReportRangeEnd(now));
    }
    params.push(limit);

    const rows = await this.query<{ payload_json: string }>(
      `SELECT payload_json
       FROM signalops_events
       WHERE ${where.join(" AND ")}
       ORDER BY occurred_at DESC
       LIMIT ?`,
      params,
    );

    return rows.map((row) => JSON.parse(row.payload_json) as SignalEvent);
  }

  async listPilotRequests(limit: number) {
    const rows = await this.query<{ payload_json: string }>(
      `SELECT payload_json
       FROM signalops_pilot_requests
       ORDER BY
         CASE lifecycle_status
           WHEN 'new' THEN 0
           WHEN 'contacted' THEN 1
           WHEN 'pilot_scoped' THEN 2
           ELSE 3
         END,
         CASE qualification_tier
           WHEN 'urgent_fit' THEN 0
           WHEN 'strong_fit' THEN 1
           ELSE 2
         END,
         created_at DESC
       LIMIT ?`,
      [limit],
    );

    return rows.map((row) => JSON.parse(row.payload_json) as PilotRequest);
  }

  async updatePilotRequestLifecycle(update: PilotRequestLifecycleUpdate) {
    const rows = await this.query<{ payload_json: string }>(
      `SELECT payload_json
       FROM signalops_pilot_requests
       WHERE id = ?
       LIMIT 1`,
      [update.id],
    );
    const existing = rows[0]?.payload_json ? (JSON.parse(rows[0].payload_json) as PilotRequest) : null;
    if (!existing) {
      return null;
    }

    const updated = applyPilotRequestLifecycleUpdate(existing, update);
    await this.query(
      `UPDATE signalops_pilot_requests
       SET lifecycle_status = ?,
           operator_note = ?,
           next_action_at = ?,
           updated_at = ?,
           payload_json = ?
       WHERE id = ?`,
      [
        updated.lifecycle.status,
        updated.lifecycle.operatorNote ?? null,
        updated.lifecycle.nextActionAt ?? null,
        updated.lifecycle.updatedAt,
        JSON.stringify(updated),
        updated.id,
      ],
    );
    const activity = latestActivity(updated);
    if (activity) {
      await this.insertPilotRequestActivity(activity);
    }

    return updated;
  }

  private async insertPilotRequestActivity(activity: PilotRequestActivity) {
    await this.query(
      `INSERT OR IGNORE INTO signalops_pilot_request_activity
        (id, pilot_request_id, created_at, type, actor, status, summary, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        activity.id,
        activity.pilotRequestId,
        activity.createdAt,
        activity.type,
        activity.actor,
        activity.status ?? null,
        activity.summary,
        JSON.stringify(activity),
      ],
    );
  }

  async storeEvents(workspaceSlug: string, events: SignalEvent[]) {
    const storedEventIds: string[] = [];
    const duplicateEventIds: string[] = [];
    let duplicateEvents = 0;

    for (const event of events) {
      const rows = await this.query<{ changes: number }>(
        `INSERT OR IGNORE INTO signalops_events
          (event_id, workspace_slug, type, generation_id, provider_id, model_id, status, source, duration_ms, cost, retry_count, occurred_at, received_at, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING 1 as changes`,
        [
          event.eventId,
          workspaceSlug,
          event.type,
          event.generationId ?? null,
          event.providerId ?? null,
          event.modelId ?? null,
          event.status ?? null,
          event.source ?? null,
          event.durationMs ?? null,
          event.cost ?? null,
          event.retryCount ?? null,
          event.occurredAt,
          event.receivedAt,
          JSON.stringify(event),
        ],
      );

      if (rows.length === 0) {
        duplicateEvents += 1;
        duplicateEventIds.push(event.eventId);
      } else {
        storedEventIds.push(event.eventId);
      }
    }

    return {
      accepted: events.length,
      storedEvents: storedEventIds.length,
      duplicateEvents,
      storedEventIds,
      duplicateEventIds,
    };
  }

  async storePilotRequest(request: PilotRequest) {
    await this.query(
      `INSERT INTO signalops_pilot_requests
        (id, created_at, name, email, company, product_url, generation_volume, providers, primary_pain, urgency, desired_outcome, qualification_tier, qualification_signals, lifecycle_status, operator_note, next_action_at, updated_at, use_case, source, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        request.id,
        request.createdAt,
        request.name,
        request.email,
        request.company ?? null,
        request.productUrl ?? null,
        request.generationVolume ?? null,
        request.providers ?? null,
        request.primaryPain ?? null,
        request.urgency ?? null,
        request.desiredOutcome ?? null,
        request.qualification.tier,
        JSON.stringify(request.qualification.signals),
        request.lifecycle.status,
        request.lifecycle.operatorNote ?? null,
        request.lifecycle.nextActionAt ?? null,
        request.lifecycle.updatedAt,
        request.useCase,
        request.source,
        JSON.stringify(request),
      ],
    );

    for (const activity of request.activity ?? []) {
      await this.insertPilotRequestActivity(activity);
    }
  }
}

class SupabaseSignalOpsStore implements SignalOpsStore {
  constructor(
    private readonly url: string,
    private readonly serviceRoleKey: string,
  ) {}

  health(): StoreHealth {
    return {
      adapter: "supabase",
      durable: true,
      ready: true,
      missing: [],
    };
  }

  private async request<T>(path: string, init: RequestInit = {}) {
    const response = await fetch(`${this.url.replace(/\/$/, "")}/rest/v1${path}`, {
      ...init,
      headers: {
        apikey: this.serviceRoleKey,
        authorization: `Bearer ${this.serviceRoleKey}`,
        accept: "application/json",
        "content-type": "application/json",
        ...init.headers,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      let message = text;
      try {
        const json = JSON.parse(text) as { message?: string; details?: string; hint?: string };
        message = [json.message, json.details, json.hint].filter(Boolean).join("; ");
      } catch {
        // Keep the raw response text when Supabase does not return JSON.
      }
      throw new Error(message || `Supabase request failed with ${response.status}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  async listEvents(workspaceSlug: string, limit: number, options: EventListOptions = {}) {
    const params = new URLSearchParams({
      workspace_slug: `eq.${workspaceSlug}`,
      select: "payload_json",
      order: "occurred_at.desc",
      limit: String(limit),
    });
    if (options.filters?.eventId) {
      params.set("event_id", `eq.${options.filters.eventId}`);
    }
    if (options.filters?.providerId) {
      params.set("provider_id", `eq.${options.filters.providerId}`);
    }
    if (options.filters?.modelId) {
      params.set("model_id", `eq.${options.filters.modelId}`);
    }
    const now = options.now ?? new Date();
    const start = sourceReportRangeStart(options.filters, now);
    if (start) {
      params.append("occurred_at", `gte.${start}`);
      params.append("occurred_at", `lte.${sourceReportRangeEnd(now)}`);
    }
    const rows = await this.request<Array<Pick<SupabaseEventRow, "payload_json">>>(
      `/signalops_events?${params.toString()}`,
    );

    return rows.map((row) =>
      typeof row.payload_json === "string"
        ? (JSON.parse(row.payload_json) as SignalEvent)
        : row.payload_json,
    );
  }

  async listPilotRequests(limit: number) {
    const params = new URLSearchParams({
      select: "payload_json",
      limit: String(limit),
    });
    params.append("order", "lifecycle_status.asc");
    params.append("order", "created_at.desc");
    const rows = await this.request<SupabasePilotRequestRow[]>(`/signalops_pilot_requests?${params.toString()}`);

    return sortPilotRequestsForOperator(
      rows.map((row) =>
        typeof row.payload_json === "string"
          ? (JSON.parse(row.payload_json) as PilotRequest)
          : row.payload_json,
      ),
    ).slice(0, limit);
  }

  async updatePilotRequestLifecycle(update: PilotRequestLifecycleUpdate) {
    const selectParams = new URLSearchParams({
      id: `eq.${update.id}`,
      select: "payload_json",
      limit: "1",
    });
    const rows = await this.request<SupabasePilotRequestRow[]>(
      `/signalops_pilot_requests?${selectParams.toString()}`,
    );
    const existing = rows[0]?.payload_json
      ? typeof rows[0].payload_json === "string"
        ? (JSON.parse(rows[0].payload_json) as PilotRequest)
        : rows[0].payload_json
      : null;
    if (!existing) {
      return null;
    }

    const updated = applyPilotRequestLifecycleUpdate(existing, update);
    const updateParams = new URLSearchParams({
      id: `eq.${updated.id}`,
    });
    const updatedRows = await this.request<SupabasePilotRequestRow[]>(
      `/signalops_pilot_requests?${updateParams.toString()}`,
      {
        method: "PATCH",
        headers: {
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          lifecycle_status: updated.lifecycle.status,
          operator_note: updated.lifecycle.operatorNote ?? null,
          next_action_at: updated.lifecycle.nextActionAt ?? null,
          updated_at: updated.lifecycle.updatedAt,
          payload_json: updated,
        }),
      },
    );

    const payload = updatedRows[0]?.payload_json;
    const persisted = typeof payload === "string" ? (JSON.parse(payload) as PilotRequest) : payload ?? updated;
    const activity = latestActivity(persisted);
    if (activity) {
      await this.insertPilotRequestActivity(activity);
    }

    return persisted;
  }

  private async insertPilotRequestActivity(activity: PilotRequestActivity) {
    await this.request("/signalops_pilot_request_activity", {
      method: "POST",
      headers: {
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify({
        id: activity.id,
        pilot_request_id: activity.pilotRequestId,
        created_at: activity.createdAt,
        type: activity.type,
        actor: activity.actor,
        status: activity.status ?? null,
        summary: activity.summary,
        payload_json: activity,
      }),
    });
  }

  async storeEvents(workspaceSlug: string, events: SignalEvent[]) {
    const rows = events.map((event) => ({
      event_id: event.eventId,
      workspace_slug: workspaceSlug,
      type: event.type,
      generation_id: event.generationId ?? null,
      provider_id: event.providerId ?? null,
      model_id: event.modelId ?? null,
      status: event.status ?? null,
      source: event.source ?? null,
      duration_ms: event.durationMs ?? null,
      cost: event.cost ?? null,
      retry_count: event.retryCount ?? null,
      occurred_at: event.occurredAt,
      received_at: event.receivedAt,
      payload_json: event,
    }));

    const inserted = await this.request<SupabaseEventRow[]>(
      "/signalops_events?on_conflict=workspace_slug,event_id",
      {
        method: "POST",
        headers: {
          Prefer: "resolution=ignore-duplicates,return=representation",
        },
        body: JSON.stringify(rows),
      },
    );
    const storedEventIds = inserted.map((row) => row.event_id);
    const storedEventIdSet = new Set(storedEventIds);
    const duplicateEventIds = events
      .map((event) => event.eventId)
      .filter((eventId) => !storedEventIdSet.has(eventId));

    return {
      accepted: events.length,
      storedEvents: storedEventIds.length,
      duplicateEvents: duplicateEventIds.length,
      storedEventIds,
      duplicateEventIds,
    };
  }

  async storePilotRequest(request: PilotRequest) {
    await this.request("/signalops_pilot_requests", {
      method: "POST",
      headers: {
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        id: request.id,
        created_at: request.createdAt,
        name: request.name,
        email: request.email,
        company: request.company ?? null,
        product_url: request.productUrl ?? null,
        generation_volume: request.generationVolume ?? null,
        providers: request.providers ?? null,
        primary_pain: request.primaryPain ?? null,
        urgency: request.urgency ?? null,
        desired_outcome: request.desiredOutcome ?? null,
        qualification_tier: request.qualification.tier,
        qualification_signals: request.qualification.signals,
        lifecycle_status: request.lifecycle.status,
        operator_note: request.lifecycle.operatorNote ?? null,
        next_action_at: request.lifecycle.nextActionAt ?? null,
        updated_at: request.lifecycle.updatedAt,
        use_case: request.useCase,
        source: request.source,
        payload_json: request,
      }),
    });

    for (const activity of request.activity ?? []) {
      await this.insertPilotRequestActivity(activity);
    }
  }
}

export type WorkspaceIdentity = {
  workspaceSlug: string;
  configured: boolean;
  pilotReady: boolean;
  reason: "configured" | "missing" | "default_demo" | "placeholder";
};

export function getWorkspaceSlug(env: NodeJS.ProcessEnv = process.env) {
  return env.SIGNALOPS_WORKSPACE_SLUG?.trim() || "demo";
}

export function getWorkspaceIdentity(env: NodeJS.ProcessEnv = process.env): WorkspaceIdentity {
  const raw = env.SIGNALOPS_WORKSPACE_SLUG?.trim();
  const workspaceSlug = getWorkspaceSlug(env);
  const configured = Boolean(raw);
  const placeholder = isPlaceholderValue(raw);
  const defaultDemo = workspaceSlug.toLowerCase() === "demo";

  return {
    workspaceSlug,
    configured,
    pilotReady: configured && !placeholder && !defaultDemo,
    reason: !configured ? "missing" : placeholder ? "placeholder" : defaultDemo ? "default_demo" : "configured",
  };
}

export function getStoreHealth(): StoreHealth {
  const target = process.env.SIGNALOPS_DATABASE_TARGET;
  if (target === "cloudflare_d1") {
    const missing = missingConfiguredEnv([
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_D1_DATABASE_ID",
      "CLOUDFLARE_API_TOKEN",
    ]);

    return {
      adapter: "cloudflare_d1",
      durable: true,
      ready: missing.length === 0,
      missing,
    };
  }

  if (target === "supabase") {
    const missing = missingConfiguredEnv(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);

    return {
      adapter: "supabase",
      durable: true,
      ready: missing.length === 0,
      missing,
    };
  }

  return new MemorySignalOpsStore().health();
}

export function getSignalOpsStore(): SignalOpsStore {
  const health = getStoreHealth();
  if (health.adapter === "cloudflare_d1" && health.ready) {
    return new CloudflareD1SignalOpsStore(
      process.env.CLOUDFLARE_ACCOUNT_ID!,
      process.env.CLOUDFLARE_D1_DATABASE_ID!,
      process.env.CLOUDFLARE_API_TOKEN!,
    );
  }

  if (health.adapter === "supabase" && health.ready) {
    return new SupabaseSignalOpsStore(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }

  return new MemorySignalOpsStore();
}
