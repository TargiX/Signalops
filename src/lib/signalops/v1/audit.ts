import {
  getSignalOpsSupabaseConfigV1,
  signalOpsSupabaseRestRequestV1,
} from "./supabase.ts";

type AuditScalar = string | number | boolean | null;

export type SignalOpsAuditEventV1 = {
  tenantId?: string;
  actorSubject: string;
  action: string;
  target?: string;
  requestId?: string;
  metadata?: Record<string, AuditScalar>;
};

const forbiddenMetadataKey = /(email|prompt|token|secret|password|authorization|media|url|user.?id)/i;

function sanitizeMetadata(metadata: Record<string, AuditScalar> = {}): Record<string, AuditScalar> {
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([key]) => key.length <= 64 && !forbiddenMetadataKey.test(key))
      .slice(0, 20)
      .map(([key, value]) => [
        key,
        typeof value === "string" ? value.slice(0, 200) : value,
      ]),
  );
}

export async function writeSignalOpsAuditEventV1(
  event: SignalOpsAuditEventV1,
): Promise<void> {
  const config = getSignalOpsSupabaseConfigV1();
  const row = {
    tenant_id: event.tenantId ?? null,
    actor_subject: event.actorSubject.slice(0, 200),
    action: event.action.slice(0, 120),
    target: event.target?.slice(0, 200) ?? null,
    request_id: event.requestId?.slice(0, 120) ?? null,
    metadata: sanitizeMetadata(event.metadata),
  };
  if (!config) {
    if (process.env.NODE_ENV !== "test") {
      console.info("[SignalOps] audit", row);
    }
    return;
  }
  await signalOpsSupabaseRestRequestV1<null>(config, "signalops_v1_audit_log", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
}
