import { createHash, createHmac } from "node:crypto";

import { writeSignalOpsAuditEventV1 } from "./audit.ts";
import type { SignalOpsOpsSnapshotV1 } from "./ops-snapshot.ts";
import {
  getSignalOpsSupabaseConfigV1,
  signalOpsSupabaseRestRequestV1,
} from "./supabase.ts";

export type SignalOpsIncidentSeverityV1 = "warning" | "critical";
export type SignalOpsIncidentStateV1 = "open" | "resolved";

export type SignalOpsIncidentEvidenceV1 = Record<string, string | number | boolean | null>;

export type SignalOpsIncidentV1 = {
  tenantId: string;
  id: string;
  fingerprint: string;
  state: SignalOpsIncidentStateV1;
  severity: SignalOpsIncidentSeverityV1;
  metric: string;
  providerKey?: string;
  modelKey?: string;
  policyVersion: string;
  title: string;
  evidence: SignalOpsIncidentEvidenceV1;
  openedAt: string;
  lastObservedAt: string;
  resolvedAt: string | null;
  alertVersion: number;
};

export type SignalOpsIncidentDecisionV1 = Omit<
  SignalOpsIncidentV1,
  "state" | "openedAt" | "lastObservedAt" | "resolvedAt" | "alertVersion"
>;

type IncidentRow = {
  tenant_id: string;
  id: string;
  fingerprint: string;
  state: SignalOpsIncidentStateV1;
  severity: SignalOpsIncidentSeverityV1;
  metric: string;
  provider_key: string | null;
  model_key: string | null;
  policy_version: string;
  title: string;
  evidence: SignalOpsIncidentEvidenceV1;
  opened_at: string;
  last_observed_at: string;
  resolved_at: string | null;
  alert_version: number;
};

const globalIncidentState = globalThis as typeof globalThis & {
  __signalOpsIncidentsV1?: Map<string, SignalOpsIncidentV1>;
  __signalOpsAlertClaimsV1?: Set<string>;
};
const localIncidents = globalIncidentState.__signalOpsIncidentsV1 ?? new Map();
const localAlertClaims = globalIncidentState.__signalOpsAlertClaimsV1 ?? new Set();
globalIncidentState.__signalOpsIncidentsV1 = localIncidents;
globalIncidentState.__signalOpsAlertClaimsV1 = localAlertClaims;

function fingerprint(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u0000"), "utf8").digest("hex");
}

function decision(input: Omit<SignalOpsIncidentDecisionV1, "id" | "fingerprint">) {
  const value = fingerprint([
    input.tenantId,
    input.metric,
    input.providerKey ?? "*",
    input.modelKey ?? "*",
    input.policyVersion,
  ]);
  return { ...input, id: `inc_${value.slice(0, 24)}`, fingerprint: value };
}

export function evaluateSignalOpsIncidentsV1(
  snapshot: SignalOpsOpsSnapshotV1,
): SignalOpsIncidentDecisionV1[] {
  const decisions: SignalOpsIncidentDecisionV1[] = [];
  for (const provider of snapshot.providers) {
    if (provider.health.status !== "degraded" && provider.health.status !== "incident") continue;
    const severity: SignalOpsIncidentSeverityV1 =
      provider.health.status === "incident" ? "critical" : "warning";
    decisions.push(
      decision({
        tenantId: snapshot.tenant.id,
        severity,
        metric: "provider_health",
        providerKey: provider.providerKey,
        modelKey: provider.modelKey,
        policyVersion: provider.health.policyVersion,
        title: `${provider.providerVendor ?? provider.providerKey} / ${provider.modelKey} is ${provider.health.status}`,
        evidence: {
          sampleSize: provider.health.sampleSize,
          failureRate: provider.health.failureRate,
          p95DurationMs: provider.health.p95DurationMs,
          windowMinutes: provider.health.windowMinutes,
        },
      }),
    );
  }

  const dataQualityCount =
    snapshot.dataQuality.contradictoryTerminals +
    snapshot.dataQuality.identityCollisions +
    snapshot.dataQuality.idempotencyConflicts;
  if (dataQualityCount > 0) {
    decisions.push(
      decision({
        tenantId: snapshot.tenant.id,
        severity:
          snapshot.dataQuality.identityCollisions > 0 ||
          snapshot.dataQuality.idempotencyConflicts > 0
            ? "critical"
            : "warning",
        metric: "telemetry_conflict",
        policyVersion: "telemetry-quality-2026-08-23",
        title: "Canonical telemetry contains conflicting lifecycle facts",
        evidence: {
          contradictoryTerminals: snapshot.dataQuality.contradictoryTerminals,
          identityCollisions: snapshot.dataQuality.identityCollisions,
          idempotencyConflicts: snapshot.dataQuality.idempotencyConflicts,
        },
      }),
    );
  }
  if (snapshot.dataQuality.truncated) {
    decisions.push(
      decision({
        tenantId: snapshot.tenant.id,
        severity: "critical",
        metric: "projection_truncated",
        policyVersion: "projection-capacity-2026-08-23",
        title: "Projection rebuild exceeded its bounded event capacity",
        evidence: { sourceEventCount: snapshot.projection.sourceEventCount },
      }),
    );
  }
  return decisions.sort((left, right) => left.id.localeCompare(right.id));
}

function fromRow(row: IncidentRow): SignalOpsIncidentV1 {
  return {
    tenantId: row.tenant_id,
    id: row.id,
    fingerprint: row.fingerprint,
    state: row.state,
    severity: row.severity,
    metric: row.metric,
    providerKey: row.provider_key ?? undefined,
    modelKey: row.model_key ?? undefined,
    policyVersion: row.policy_version,
    title: row.title,
    evidence: row.evidence,
    openedAt: row.opened_at,
    lastObservedAt: row.last_observed_at,
    resolvedAt: row.resolved_at,
    alertVersion: row.alert_version,
  };
}

function toRow(incident: SignalOpsIncidentV1): IncidentRow {
  return {
    tenant_id: incident.tenantId,
    id: incident.id,
    fingerprint: incident.fingerprint,
    state: incident.state,
    severity: incident.severity,
    metric: incident.metric,
    provider_key: incident.providerKey ?? null,
    model_key: incident.modelKey ?? null,
    policy_version: incident.policyVersion,
    title: incident.title,
    evidence: incident.evidence,
    opened_at: incident.openedAt,
    last_observed_at: incident.lastObservedAt,
    resolved_at: incident.resolvedAt,
    alert_version: incident.alertVersion,
  };
}

async function listStoredIncidents(tenantId: string): Promise<SignalOpsIncidentV1[]> {
  const config = getSignalOpsSupabaseConfigV1();
  if (!config) {
    return [...localIncidents.values()].filter((incident) => incident.tenantId === tenantId);
  }
  const filters = new URLSearchParams({
    select: "*",
    tenant_id: `eq.${tenantId}`,
    order: "last_observed_at.desc",
    limit: "500",
  });
  const rows = await signalOpsSupabaseRestRequestV1<IncidentRow[]>(
    config,
    `signalops_v1_incidents?${filters}`,
  );
  return rows.map(fromRow);
}

async function storeIncident(incident: SignalOpsIncidentV1): Promise<void> {
  const config = getSignalOpsSupabaseConfigV1();
  if (!config) {
    localIncidents.set(`${incident.tenantId}:${incident.id}`, structuredClone(incident));
    return;
  }
  await signalOpsSupabaseRestRequestV1<null>(
    config,
    "signalops_v1_incidents?on_conflict=tenant_id,id",
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(toRow(incident)),
    },
  );
}

export async function syncSignalOpsIncidentsV1(input: {
  tenantId: string;
  decisions: readonly SignalOpsIncidentDecisionV1[];
  now?: Date;
}): Promise<{ incidents: SignalOpsIncidentV1[]; transitions: SignalOpsIncidentV1[] }> {
  const now = (input.now ?? new Date()).toISOString();
  const existing = await listStoredIncidents(input.tenantId);
  const existingById = new Map(existing.map((incident) => [incident.id, incident]));
  const activeIds = new Set(input.decisions.map((item) => item.id));
  const transitions: SignalOpsIncidentV1[] = [];

  for (const item of input.decisions) {
    const previous = existingById.get(item.id);
    const transitioned =
      !previous || previous.state === "resolved" || previous.severity !== item.severity;
    const incident: SignalOpsIncidentV1 = {
      ...item,
      state: "open",
      openedAt: !previous || previous.state === "resolved" ? now : previous.openedAt,
      lastObservedAt: now,
      resolvedAt: null,
      alertVersion: transitioned ? (previous?.alertVersion ?? 0) + 1 : previous.alertVersion,
    };
    await storeIncident(incident);
    existingById.set(incident.id, incident);
    if (transitioned) transitions.push(incident);
  }

  for (const previous of existing) {
    if (previous.state !== "open" || activeIds.has(previous.id)) continue;
    const resolved: SignalOpsIncidentV1 = {
      ...previous,
      state: "resolved",
      lastObservedAt: now,
      resolvedAt: now,
      alertVersion: previous.alertVersion + 1,
    };
    await storeIncident(resolved);
    existingById.set(resolved.id, resolved);
    transitions.push(resolved);
  }

  return {
    incidents: [...existingById.values()].sort((left, right) =>
      right.lastObservedAt.localeCompare(left.lastObservedAt),
    ),
    transitions,
  };
}

export async function listSignalOpsIncidentsV1(input: {
  tenantId: string;
  state?: SignalOpsIncidentStateV1;
  limit?: number;
}): Promise<SignalOpsIncidentV1[]> {
  return (await listStoredIncidents(input.tenantId))
    .filter((incident) => !input.state || incident.state === input.state)
    .slice(0, Math.max(1, Math.min(input.limit ?? 100, 500)));
}

export async function getSignalOpsIncidentV1(input: {
  tenantId: string;
  incidentId: string;
}): Promise<SignalOpsIncidentV1 | null> {
  return (
    (await listStoredIncidents(input.tenantId)).find(
      (incident) => incident.id === input.incidentId,
    ) ?? null
  );
}

function webhookConfig(): { url: string; secret: string } | null {
  const url = process.env.SIGNALOPS_ALERT_WEBHOOK_URL?.trim();
  const secret = process.env.SIGNALOPS_ALERT_WEBHOOK_SECRET?.trim();
  if (!url || !secret) return null;
  if (process.env.NODE_ENV === "production" && secret.length < 32) {
    throw new Error("SignalOps alert webhook secret must be at least 32 characters");
  }
  const parsed = new URL(url);
  const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (parsed.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && local)) {
    throw new Error("SignalOps alert webhook must use HTTPS in production");
  }
  return { url: parsed.toString(), secret };
}

async function claimAlert(incident: SignalOpsIncidentV1): Promise<boolean> {
  const claimKey = `${incident.tenantId}:${incident.id}:${incident.alertVersion}`;
  const config = getSignalOpsSupabaseConfigV1();
  if (!config) {
    if (localAlertClaims.has(claimKey)) return false;
    localAlertClaims.add(claimKey);
    return true;
  }
  const rows = await signalOpsSupabaseRestRequestV1<
    Array<{ claimed: boolean; attempt_count: number }>
  >(config, "rpc/signalops_v1_claim_alert_delivery", {
    method: "POST",
    body: JSON.stringify({
      p_tenant_id: incident.tenantId,
      p_incident_id: incident.id,
      p_alert_version: incident.alertVersion,
    }),
  });
  return rows[0]?.claimed ?? false;
}

async function updateAlertStatus(
  incident: SignalOpsIncidentV1,
  status: "delivered" | "failed",
  errorCode?: string,
): Promise<void> {
  const config = getSignalOpsSupabaseConfigV1();
  if (!config) return;
  const filters = new URLSearchParams({
    tenant_id: `eq.${incident.tenantId}`,
    incident_id: `eq.${incident.id}`,
    alert_version: `eq.${incident.alertVersion}`,
  });
  await signalOpsSupabaseRestRequestV1<null>(
    config,
    `signalops_v1_alert_deliveries?${filters}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        status,
        last_error_code: errorCode?.slice(0, 120) ?? null,
        delivered_at: status === "delivered" ? new Date().toISOString() : null,
      }),
    },
  );
}

export async function dispatchSignalOpsIncidentAlertsV1(
  incidents: readonly SignalOpsIncidentV1[],
): Promise<void> {
  const config = webhookConfig();
  if (!config) return;
  for (let offset = 0; offset < incidents.length; offset += 5) {
    await Promise.all(
      incidents.slice(offset, offset + 5).map(async (incident) => {
        if (!(await claimAlert(incident))) return;
        const body = JSON.stringify({
          type: "com.signalops.incident.transition.v1",
          incident: {
            id: incident.id,
            tenantId: incident.tenantId,
            state: incident.state,
            severity: incident.severity,
            metric: incident.metric,
            providerKey: incident.providerKey,
            modelKey: incident.modelKey,
            title: incident.title,
            evidence: incident.evidence,
            alertVersion: incident.alertVersion,
            observedAt: incident.lastObservedAt,
          },
        });
        const signature = createHmac("sha256", config.secret).update(body).digest("hex");
        try {
          const response = await fetch(config.url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-signalops-signature": `sha256=${signature}`,
              "x-signalops-event": "incident.transition.v1",
            },
            body,
            signal: AbortSignal.timeout(5_000),
          });
          if (!response.ok) throw new Error(`webhook_http_${response.status}`);
          await updateAlertStatus(incident, "delivered");
          await writeSignalOpsAuditEventV1({
            tenantId: incident.tenantId,
            actorSubject: "system:incident-evaluator",
            action: "incident.alert_delivered",
            target: incident.id,
            metadata: { alertVersion: incident.alertVersion },
          });
        } catch (error) {
          const errorCode =
            error instanceof Error && error.message.startsWith("webhook_http_")
              ? error.message
              : error instanceof Error
                ? error.name
                : "AlertDeliveryError";
          await updateAlertStatus(incident, "failed", errorCode);
          console.error("[SignalOps] incident alert delivery failed", {
            incidentId: incident.id,
            errorCode,
          });
        }
      }),
    );
  }
}
