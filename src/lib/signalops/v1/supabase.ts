import type {
  SignalOpsEventReaderV1,
  SignalOpsEventStoreV1,
  StoredSignalOpsEventV1,
} from "./event-store.ts";
import { signalOpsEventDigestV1 } from "./event-store.ts";
import { assertSignalOpsTenantPrincipalV1 } from "./principal.ts";
import type { SignalOpsPrincipalScopeV1, SignalOpsTenantPrincipalV1 } from "./types.ts";

export type SignalOpsSupabaseConfigV1 = {
  url: string;
  secretKey: string;
};

type EventRow = {
  tenant_id: string;
  event_id: string;
  payload: StoredSignalOpsEventV1["event"];
  payload_digest: string;
  received_at: string;
};

type CredentialRow = {
  id: string;
  tenant_id: string;
  scopes: SignalOpsPrincipalScopeV1[];
  expires_at: string | null;
};

type IdempotencyConflictRow = {
  tenant_id: string;
  event_id: string;
  conflict_kind: "idempotency_payload";
  existing_digest: string | null;
  observed_digest: string;
  evidence: Record<string, never>;
};

async function recordIdempotencyConflicts(
  config: SignalOpsSupabaseConfigV1,
  rows: readonly IdempotencyConflictRow[],
): Promise<void> {
  if (rows.length === 0) return;
  await signalOpsSupabaseRestRequestV1<null>(
    config,
    "signalops_v1_telemetry_conflicts?on_conflict=tenant_id,event_id,conflict_kind,observed_digest",
    {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    },
  );
}

export function getSignalOpsSupabaseConfigV1(): SignalOpsSupabaseConfigV1 | null {
  const url = process.env.SUPABASE_URL?.trim();
  const secretKey = (
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!url || !secretKey || /YOUR_PROJECT/i.test(url)) return null;
  return { url: url.replace(/\/$/, ""), secretKey };
}

export async function signalOpsSupabaseRestRequestV1<T>(
  config: SignalOpsSupabaseConfigV1,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: config.secretKey,
      authorization: `Bearer ${config.secretKey}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
    signal: init.signal ?? AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`SignalOps Supabase request failed (${response.status}): ${text.slice(0, 300)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

function eventRowsPath(tenantId: string, eventIds: readonly string[]): string {
  const filters = new URLSearchParams({
    select: "tenant_id,event_id,payload,payload_digest,received_at",
    tenant_id: `eq.${tenantId}`,
    event_id: `in.(${eventIds.join(",")})`,
  });
  return `signalops_v1_events?${filters}`;
}

export function createSupabaseSignalOpsEventStoreV1(
  config: SignalOpsSupabaseConfigV1,
): SignalOpsEventStoreV1 & SignalOpsEventReaderV1 {
  return {
    async store(principal, events) {
      assertSignalOpsTenantPrincipalV1(principal, "events:write");
      if (events.length === 0) {
        return { storedEventIds: [], duplicateEventIds: [], conflictEventIds: [] };
      }

      const existing = await signalOpsSupabaseRestRequestV1<EventRow[]>(
        config,
        eventRowsPath(principal.tenantId, events.map((event) => event.id)),
      );
      const existingById = new Map(existing.map((row) => [row.event_id, row]));
      const duplicateEventIds: string[] = [];
      const conflictEventIds: string[] = [];
      const conflictRows: IdempotencyConflictRow[] = [];
      const candidates = events.filter((event) => {
        const row = existingById.get(event.id);
        if (!row) return true;
        const observedDigest = signalOpsEventDigestV1(event);
        if (row.payload_digest === observedDigest) duplicateEventIds.push(event.id);
        else {
          conflictEventIds.push(event.id);
          conflictRows.push({
            tenant_id: principal.tenantId,
            event_id: event.id,
            conflict_kind: "idempotency_payload",
            existing_digest: row.payload_digest,
            observed_digest: observedDigest,
            evidence: {},
          });
        }
        return false;
      });

      let storedEventIds: string[] = [];
      if (candidates.length > 0) {
        const inserted = await signalOpsSupabaseRestRequestV1<Array<{ event_id: string }>>(
          config,
          "signalops_v1_events?on_conflict=tenant_id,event_id&select=event_id",
          {
            method: "POST",
            headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
            body: JSON.stringify(
              candidates.map((event) => ({
                tenant_id: principal.tenantId,
                event_id: event.id,
                event_type: event.type,
                event_time: event.time,
                payload: event,
                payload_digest: signalOpsEventDigestV1(event),
              })),
            ),
          },
        );
        storedEventIds = inserted.map((row) => row.event_id);

        const racedIds = candidates
          .map((event) => event.id)
          .filter((id) => !storedEventIds.includes(id));
        if (racedIds.length > 0) {
          const raced = await signalOpsSupabaseRestRequestV1<EventRow[]>(
            config,
            eventRowsPath(principal.tenantId, racedIds),
          );
          const racedById = new Map(raced.map((row) => [row.event_id, row]));
          for (const event of candidates.filter((candidate) => racedIds.includes(candidate.id))) {
            const row = racedById.get(event.id);
            if (row?.payload_digest === signalOpsEventDigestV1(event)) duplicateEventIds.push(event.id);
            else {
              const observedDigest = signalOpsEventDigestV1(event);
              conflictEventIds.push(event.id);
              conflictRows.push({
                tenant_id: principal.tenantId,
                event_id: event.id,
                conflict_kind: "idempotency_payload",
                existing_digest: row?.payload_digest ?? null,
                observed_digest: observedDigest,
                evidence: {},
              });
            }
          }
        }
      }

      await recordIdempotencyConflicts(config, conflictRows);

      return { storedEventIds, duplicateEventIds, conflictEventIds };
    },
    async list(tenantId, options = {}) {
      const targetLimit = Math.max(1, Math.min(options.limit ?? 5_000, 100_001));
      const pageSize = 1_000;
      const rows: EventRow[] = [];
      while (rows.length < targetLimit) {
        const filters = new URLSearchParams({
          select: "tenant_id,event_id,payload,payload_digest,received_at",
          tenant_id: `eq.${tenantId}`,
          order: "event_time.desc,event_id.desc",
          limit: String(Math.min(pageSize, targetLimit - rows.length)),
          offset: String(rows.length),
        });
        if (options.since) filters.set("event_time", `gte.${options.since}`);
        const page = await signalOpsSupabaseRestRequestV1<EventRow[]>(
          config,
          `signalops_v1_events?${filters}`,
        );
        rows.push(...page);
        if (page.length < pageSize) break;
      }
      return rows.map((row) => ({
        tenantId: row.tenant_id,
        event: row.payload,
        payloadDigest: row.payload_digest,
        receivedAt: row.received_at,
      }));
    },
    async watermark(tenantId, options = {}) {
      const rows = await signalOpsSupabaseRestRequestV1<
        Array<{ event_count: number; event_id: string | null; received_at: string | null }>
      >(config, "rpc/signalops_v1_event_watermark", {
        method: "POST",
        body: JSON.stringify({
          p_tenant_id: tenantId,
          p_since: options.since ?? new Date(0).toISOString(),
        }),
      });
      return {
        receivedAt: rows[0]?.received_at ?? null,
        eventId: rows[0]?.event_id ?? null,
        eventCount: Number(rows[0]?.event_count ?? 0),
      };
    },
  };
}

export async function resolveSupabaseSignalOpsPrincipalV1(input: {
  config: SignalOpsSupabaseConfigV1;
  tokenHash: string;
}): Promise<SignalOpsTenantPrincipalV1 | null> {
  const filters = new URLSearchParams({
    select: "id,tenant_id,scopes,expires_at",
    token_hash: `eq.${input.tokenHash}`,
    revoked_at: "is.null",
    limit: "1",
  });
  const rows = await signalOpsSupabaseRestRequestV1<CredentialRow[]>(
    input.config,
    `signalops_v1_ingest_credentials?${filters}`,
  );
  const credential = rows[0];
  if (!credential) return null;
  if (credential.expires_at && Date.parse(credential.expires_at) <= Date.now()) return null;
  const tenantFilters = new URLSearchParams({
    select: "id,status",
    id: `eq.${credential.tenant_id}`,
    status: "eq.active",
    limit: "1",
  });
  const tenants = await signalOpsSupabaseRestRequestV1<Array<{ id: string; status: string }>>(
    input.config,
    `signalops_v1_tenants?${tenantFilters}`,
  );
  if (tenants.length !== 1) return null;
  void signalOpsSupabaseRestRequestV1(
    input.config,
    `signalops_v1_ingest_credentials?id=eq.${encodeURIComponent(credential.id)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ last_used_at: new Date().toISOString() }),
    },
  ).catch(() => undefined);
  return {
    tenantId: credential.tenant_id,
    credentialId: credential.id,
    scopes: credential.scopes,
  };
}
