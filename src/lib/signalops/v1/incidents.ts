import { createHash, createHmac } from "node:crypto";

import { writeSignalOpsAuditEventV1 } from "./audit.ts";
import type { SignalOpsOpsSnapshotV1 } from "./ops-snapshot.ts";
import {
  getSignalOpsSupabaseConfigV1,
  signalOpsSupabaseRestRequestV1,
} from "./supabase.ts";
import {
  defaultSignalOpsSloPoliciesV1,
  evaluateSignalOpsSloPoliciesV1,
  type SignalOpsSloPolicyV1,
} from "./slo.ts";

export type SignalOpsIncidentSeverityV1 = "warning" | "critical";
export type SignalOpsIncidentStateV1 = "open" | "acknowledged" | "resolved";
export type SignalOpsIncidentTransitionTypeV1 =
  | "opened"
  | "reopened"
  | "escalated"
  | "deescalated"
  | "acknowledged"
  | "unacknowledged"
  | "resolved";

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
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  acknowledgementNote: string | null;
  alertVersion: number;
};

export type SignalOpsIncidentTransitionV1 = {
  tenantId: string;
  id: string;
  incidentId: string;
  type: SignalOpsIncidentTransitionTypeV1;
  actorSubject: string;
  fromState: SignalOpsIncidentStateV1 | null;
  toState: SignalOpsIncidentStateV1;
  fromSeverity: SignalOpsIncidentSeverityV1 | null;
  toSeverity: SignalOpsIncidentSeverityV1;
  alertVersion: number;
  evidence: SignalOpsIncidentEvidenceV1;
  createdAt: string;
};

export type SignalOpsIncidentDecisionV1 = Omit<
  SignalOpsIncidentV1,
  | "state"
  | "openedAt"
  | "lastObservedAt"
  | "resolvedAt"
  | "acknowledgedAt"
  | "acknowledgedBy"
  | "acknowledgementNote"
  | "alertVersion"
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
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  acknowledgement_note: string | null;
  alert_version: number;
};

type IncidentTransitionRow = {
  tenant_id: string;
  id: string;
  incident_id: string;
  transition_type: SignalOpsIncidentTransitionTypeV1;
  actor_subject: string;
  from_state: SignalOpsIncidentStateV1 | null;
  to_state: SignalOpsIncidentStateV1;
  from_severity: SignalOpsIncidentSeverityV1 | null;
  to_severity: SignalOpsIncidentSeverityV1;
  alert_version: number;
  evidence: SignalOpsIncidentEvidenceV1;
  created_at: string;
};

const globalIncidentState = globalThis as typeof globalThis & {
  __signalOpsIncidentsV1?: Map<string, SignalOpsIncidentV1>;
  __signalOpsIncidentTransitionsV1?: Map<string, SignalOpsIncidentTransitionV1>;
  __signalOpsAlertClaimsV1?: Set<string>;
};
const localIncidents = globalIncidentState.__signalOpsIncidentsV1 ?? new Map();
const localIncidentTransitions =
  globalIncidentState.__signalOpsIncidentTransitionsV1 ?? new Map();
const localAlertClaims = globalIncidentState.__signalOpsAlertClaimsV1 ?? new Set();
globalIncidentState.__signalOpsIncidentsV1 = localIncidents;
globalIncidentState.__signalOpsIncidentTransitionsV1 = localIncidentTransitions;
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
  policies: readonly SignalOpsSloPolicyV1[] = defaultSignalOpsSloPoliciesV1(
    snapshot.tenant.id,
  ),
): SignalOpsIncidentDecisionV1[] {
  const decisions: SignalOpsIncidentDecisionV1[] = [];
  const sloEvaluations = evaluateSignalOpsSloPoliciesV1({ snapshot, policies });
  for (const evaluation of sloEvaluations) {
    if (evaluation.status !== "breached" || !evaluation.severity) continue;
    decisions.push(
      decision({
        tenantId: snapshot.tenant.id,
        severity: evaluation.severity,
        metric: `slo:${evaluation.policy.metric}`,
        policyVersion: evaluation.policy.version,
        title: `${evaluation.policy.name} SLO breached`,
        evidence: {
          sloId: evaluation.policy.id,
          observedValue: evaluation.observedValue,
          objective: evaluation.policy.objective,
          warningThreshold: evaluation.policy.warningThreshold,
          criticalThreshold: evaluation.policy.criticalThreshold,
          comparator: evaluation.policy.comparator,
          sampleSize: evaluation.sampleSize,
          minimumSample: evaluation.policy.minimumSample,
          windowMinutes: evaluation.policy.windowMinutes,
        },
      }),
    );
  }
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
    acknowledgedAt: row.acknowledged_at,
    acknowledgedBy: row.acknowledged_by,
    acknowledgementNote: row.acknowledgement_note,
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
    acknowledged_at: incident.acknowledgedAt,
    acknowledged_by: incident.acknowledgedBy,
    acknowledgement_note: incident.acknowledgementNote,
    alert_version: incident.alertVersion,
  };
}

async function listStoredIncidents(tenantId: string): Promise<SignalOpsIncidentV1[]> {
  const config = getSignalOpsSupabaseConfigV1();
  if (!config) {
    return [...localIncidents.values()]
      .filter((incident) => incident.tenantId === tenantId)
      .sort((left, right) => right.lastObservedAt.localeCompare(left.lastObservedAt));
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

function transitionFromRow(row: IncidentTransitionRow): SignalOpsIncidentTransitionV1 {
  return {
    tenantId: row.tenant_id,
    id: row.id,
    incidentId: row.incident_id,
    type: row.transition_type,
    actorSubject: row.actor_subject,
    fromState: row.from_state,
    toState: row.to_state,
    fromSeverity: row.from_severity,
    toSeverity: row.to_severity,
    alertVersion: row.alert_version,
    evidence: row.evidence,
    createdAt: row.created_at,
  };
}

function transitionToRow(transition: SignalOpsIncidentTransitionV1): IncidentTransitionRow {
  return {
    tenant_id: transition.tenantId,
    id: transition.id,
    incident_id: transition.incidentId,
    transition_type: transition.type,
    actor_subject: transition.actorSubject,
    from_state: transition.fromState,
    to_state: transition.toState,
    from_severity: transition.fromSeverity,
    to_severity: transition.toSeverity,
    alert_version: transition.alertVersion,
    evidence: transition.evidence,
    created_at: transition.createdAt,
  };
}

function createIncidentTransition(
  input: Omit<SignalOpsIncidentTransitionV1, "id">,
): SignalOpsIncidentTransitionV1 {
  const digest = fingerprint([
    input.tenantId,
    input.incidentId,
    input.type,
    String(input.alertVersion),
    input.actorSubject,
    input.createdAt,
  ]);
  return {
    ...input,
    id: `trn_${digest.slice(0, 24)}`,
  };
}

async function storeIncidentWithTransition(
  incident: SignalOpsIncidentV1,
  input: Omit<SignalOpsIncidentTransitionV1, "id">,
): Promise<void> {
  const transition = createIncidentTransition(input);
  const config = getSignalOpsSupabaseConfigV1();
  if (!config) {
    localIncidents.set(`${incident.tenantId}:${incident.id}`, structuredClone(incident));
    localIncidentTransitions.set(
      `${transition.tenantId}:${transition.id}`,
      structuredClone(transition),
    );
    return;
  }
  await signalOpsSupabaseRestRequestV1<null>(
    config,
    "rpc/signalops_v1_persist_incident_transition",
    {
      method: "POST",
      body: JSON.stringify({
        p_incident: toRow(incident),
        p_transition: transitionToRow(transition),
      }),
    },
  );
}

export async function listSignalOpsIncidentTransitionsV1(input: {
  tenantId: string;
  incidentId: string;
  limit?: number;
}): Promise<SignalOpsIncidentTransitionV1[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
  const config = getSignalOpsSupabaseConfigV1();
  if (!config) {
    return [...localIncidentTransitions.values()]
      .filter(
        (transition) =>
          transition.tenantId === input.tenantId &&
          transition.incidentId === input.incidentId,
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(-limit);
  }
  const filters = new URLSearchParams({
    select: "*",
    tenant_id: `eq.${input.tenantId}`,
    incident_id: `eq.${input.incidentId}`,
    order: "created_at.desc",
    limit: String(limit),
  });
  const rows = await signalOpsSupabaseRestRequestV1<IncidentTransitionRow[]>(
    config,
    `signalops_v1_incident_transitions?${filters}`,
  );
  return rows.map(transitionFromRow).reverse();
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
    const transitionType: SignalOpsIncidentTransitionTypeV1 | null = !previous
      ? "opened"
      : previous.state === "resolved"
        ? "reopened"
        : previous.severity !== item.severity
          ? item.severity === "critical"
            ? "escalated"
            : "deescalated"
          : null;
    const transitioned = transitionType !== null;
    const reopened = previous?.state === "resolved";
    const incident: SignalOpsIncidentV1 = {
      ...item,
      state:
        previous?.state === "acknowledged" && !reopened ? "acknowledged" : "open",
      openedAt: !previous || reopened ? now : previous.openedAt,
      lastObservedAt: now,
      resolvedAt: null,
      acknowledgedAt: reopened ? null : (previous?.acknowledgedAt ?? null),
      acknowledgedBy: reopened ? null : (previous?.acknowledgedBy ?? null),
      acknowledgementNote: reopened ? null : (previous?.acknowledgementNote ?? null),
      alertVersion: transitioned
        ? (previous?.alertVersion ?? 0) + 1
        : (previous?.alertVersion ?? 1),
    };
    if (transitionType) {
      await storeIncidentWithTransition(incident, {
        tenantId: incident.tenantId,
        incidentId: incident.id,
        type: transitionType,
        actorSubject: "system:incident-evaluator",
        fromState: previous?.state ?? null,
        toState: incident.state,
        fromSeverity: previous?.severity ?? null,
        toSeverity: incident.severity,
        alertVersion: incident.alertVersion,
        evidence: incident.evidence,
        createdAt: now,
      });
      transitions.push(incident);
    } else {
      await storeIncident(incident);
    }
    existingById.set(incident.id, incident);
  }

  for (const previous of existing) {
    if (previous.state === "resolved" || activeIds.has(previous.id)) continue;
    const resolved: SignalOpsIncidentV1 = {
      ...previous,
      state: "resolved",
      lastObservedAt: now,
      resolvedAt: now,
      alertVersion: previous.alertVersion + 1,
    };
    await storeIncidentWithTransition(resolved, {
      tenantId: resolved.tenantId,
      incidentId: resolved.id,
      type: "resolved",
      actorSubject: "system:incident-evaluator",
      fromState: previous.state,
      toState: resolved.state,
      fromSeverity: previous.severity,
      toSeverity: resolved.severity,
      alertVersion: resolved.alertVersion,
      evidence: resolved.evidence,
      createdAt: now,
    });
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
  state?: SignalOpsIncidentStateV1 | "active";
  limit?: number;
}): Promise<SignalOpsIncidentV1[]> {
  return (await listStoredIncidents(input.tenantId))
    .filter(
      (incident) =>
        !input.state ||
        (input.state === "active"
          ? incident.state !== "resolved"
          : incident.state === input.state),
    )
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

function normalizeAcknowledgementNote(value: string | null | undefined): string | null {
  if (!value) return null;
  const note = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return note ? note.slice(0, 500) : null;
}

export async function setSignalOpsIncidentAcknowledgementV1(input: {
  tenantId: string;
  incidentId: string;
  actorSubject: string;
  acknowledged: boolean;
  note?: string | null;
  now?: Date;
}): Promise<{ incident: SignalOpsIncidentV1 | null; changed: boolean }> {
  const previous = await getSignalOpsIncidentV1({
    tenantId: input.tenantId,
    incidentId: input.incidentId,
  });
  if (!previous || previous.state === "resolved") {
    return { incident: previous, changed: false };
  }
  const targetState: SignalOpsIncidentStateV1 = input.acknowledged
    ? "acknowledged"
    : "open";
  if (previous.state === targetState) return { incident: previous, changed: false };

  const now = (input.now ?? new Date()).toISOString();
  const incident: SignalOpsIncidentV1 = {
    ...previous,
    state: targetState,
    acknowledgedAt: input.acknowledged ? now : null,
    acknowledgedBy: input.acknowledged ? input.actorSubject.slice(0, 200) : null,
    acknowledgementNote: input.acknowledged
      ? normalizeAcknowledgementNote(input.note)
      : null,
  };
  await storeIncidentWithTransition(incident, {
    tenantId: incident.tenantId,
    incidentId: incident.id,
    type: input.acknowledged ? "acknowledged" : "unacknowledged",
    actorSubject: input.actorSubject.slice(0, 200),
    fromState: previous.state,
    toState: incident.state,
    fromSeverity: previous.severity,
    toSeverity: incident.severity,
    alertVersion: incident.alertVersion,
    evidence: {
      note: incident.acknowledgementNote,
    },
    createdAt: now,
  });
  return { incident, changed: true };
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
