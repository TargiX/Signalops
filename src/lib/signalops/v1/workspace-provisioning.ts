import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";

import type { SignalOpsPrincipalScopeV1 } from "./types.ts";
import {
  getSignalOpsSupabaseConfigV1,
  signalOpsSupabaseRestRequestV1,
  type SignalOpsSupabaseConfigV1,
} from "./supabase.ts";

const subjectPattern = /^[A-Za-z0-9][A-Za-z0-9._:/|-]{0,199}$/;
const credentialIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedScopes = new Set<SignalOpsPrincipalScopeV1>([
  "events:validate",
  "events:write",
]);

export type SignalOpsProvisionedWorkspaceV1 = {
  tenantId: string;
  tenantName: string;
  role: "owner";
  created: boolean;
};

export type SignalOpsIngestCredentialSummaryV1 = {
  id: string;
  tenantId: string;
  name: string;
  tokenPrefix: string;
  scopes: SignalOpsPrincipalScopeV1[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  rotatedFromId: string | null;
  revokedAt: string | null;
};

export type SignalOpsIssuedIngestCredentialV1 = {
  credential: SignalOpsIngestCredentialSummaryV1;
  token: string;
};

type WorkspaceRow = {
  tenant_id: string;
  tenant_name: string;
  role: "owner";
  created: boolean;
};

type CredentialRow = {
  id: string;
  tenant_id: string;
  name: string;
  token_prefix: string;
  scopes: SignalOpsPrincipalScopeV1[];
  created_at: string;
  last_used_at?: string | null;
  expires_at: string | null;
  rotated_from_id: string | null;
  revoked_at: string | null;
};

function requireConfig(config?: SignalOpsSupabaseConfigV1): SignalOpsSupabaseConfigV1 {
  const resolved = config ?? getSignalOpsSupabaseConfigV1();
  if (!resolved) throw new Error("SignalOps durable workspace storage is not configured");
  return resolved;
}

function assertSubject(subject: string): string {
  if (!subjectPattern.test(subject)) throw new TypeError("Invalid SignalOps operator subject");
  return subject;
}

function assertRequestId(requestId: string): string {
  if (!/^req_[A-Za-z0-9_-]{8,116}$/.test(requestId)) {
    throw new TypeError("Invalid SignalOps request id");
  }
  return requestId;
}

function mapCredential(row: CredentialRow): SignalOpsIngestCredentialSummaryV1 {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    scopes: row.scopes,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at ?? null,
    expiresAt: row.expires_at,
    rotatedFromId: row.rotated_from_id,
    revokedAt: row.revoked_at,
  };
}

export function isSignalOpsPublicSignupEnabledV1(): boolean {
  const explicit = process.env.SIGNALOPS_PUBLIC_SIGNUP?.trim();
  const enabled = explicit === "true" || (process.env.NODE_ENV !== "production" && explicit !== "false");
  const publishableKey = (
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )?.trim();
  return Boolean(enabled && publishableKey && getSignalOpsSupabaseConfigV1());
}

export function normalizeSignalOpsWorkspaceNameV1(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Workspace name is required");
  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError("Workspace name must be 2-120 characters without control characters");
  }
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 120) {
    throw new TypeError("Workspace name must be 2-120 characters without control characters");
  }
  return name;
}

export function createSignalOpsWorkspaceIdV1(
  workspaceName: string,
  entropy: Uint8Array = nodeRandomBytes(5),
): string {
  const base = normalizeSignalOpsWorkspaceNameV1(workspaceName)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "workspace";
  const suffix = Buffer.from(entropy).toString("hex").slice(0, 10).padEnd(10, "0");
  return `${base}-${suffix}`;
}

export function createSignalOpsIngestCredentialTokenV1(
  randomBytes: (size: number) => Uint8Array = nodeRandomBytes,
): string {
  return `sop_live_${Buffer.from(randomBytes(32)).toString("base64url")}`;
}

export function signalOpsCredentialExpiryV1(
  days: number,
  now = new Date(),
): string {
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new TypeError("Credential lifetime must be 1-365 days");
  }
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1_000).toISOString();
}

export function normalizeSignalOpsCredentialNameV1(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Credential name is required");
  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError("Credential name must be 2-120 characters without control characters");
  }
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 120) {
    throw new TypeError("Credential name must be 2-120 characters without control characters");
  }
  return name;
}

export async function provisionSignalOpsWorkspaceV1(input: {
  subject: string;
  workspaceName: unknown;
  requestId: string;
  entropy?: Uint8Array;
  config?: SignalOpsSupabaseConfigV1;
}): Promise<SignalOpsProvisionedWorkspaceV1> {
  const subject = assertSubject(input.subject);
  const workspaceName = normalizeSignalOpsWorkspaceNameV1(input.workspaceName);
  const requestId = assertRequestId(input.requestId);
  const rows = await signalOpsSupabaseRestRequestV1<WorkspaceRow[]>(
    requireConfig(input.config),
    "rpc/signalops_v1_provision_workspace",
    {
      method: "POST",
      body: JSON.stringify({
        p_tenant_id: createSignalOpsWorkspaceIdV1(workspaceName, input.entropy),
        p_tenant_name: workspaceName,
        p_subject: subject,
        p_request_id: requestId,
      }),
    },
  );
  const row = rows[0];
  if (!row || row.role !== "owner") throw new Error("Workspace provisioning returned no owner membership");
  return {
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    role: row.role,
    created: row.created,
  };
}

export async function listSignalOpsIngestCredentialsV1(input: {
  tenantId: string;
  config?: SignalOpsSupabaseConfigV1;
}): Promise<SignalOpsIngestCredentialSummaryV1[]> {
  const filters = new URLSearchParams({
    select: "id,tenant_id,name,token_prefix,scopes,created_at,last_used_at,expires_at,rotated_from_id,revoked_at",
    tenant_id: `eq.${input.tenantId}`,
    order: "created_at.desc",
    limit: "100",
  });
  const rows = await signalOpsSupabaseRestRequestV1<CredentialRow[]>(
    requireConfig(input.config),
    `signalops_v1_ingest_credentials?${filters}`,
  );
  return rows.map(mapCredential);
}

export async function issueSignalOpsIngestCredentialV1(input: {
  tenantId: string;
  subject: string;
  name: unknown;
  scopes?: SignalOpsPrincipalScopeV1[];
  expiresInDays?: number;
  rotatedFromId?: string | null;
  requestId: string;
  now?: Date;
  randomBytes?: (size: number) => Uint8Array;
  config?: SignalOpsSupabaseConfigV1;
}): Promise<SignalOpsIssuedIngestCredentialV1> {
  const subject = assertSubject(input.subject);
  const name = normalizeSignalOpsCredentialNameV1(input.name);
  const requestId = assertRequestId(input.requestId);
  const scopes = input.scopes ?? ["events:validate", "events:write"];
  if (scopes.length === 0 || new Set(scopes).size !== scopes.length || scopes.some((scope) => !allowedScopes.has(scope))) {
    throw new TypeError("Credential scopes are invalid");
  }
  if (input.rotatedFromId && !credentialIdPattern.test(input.rotatedFromId)) {
    throw new TypeError("Rotation source must be a credential UUID");
  }
  const token = createSignalOpsIngestCredentialTokenV1(input.randomBytes);
  const rows = await signalOpsSupabaseRestRequestV1<CredentialRow[]>(
    requireConfig(input.config),
    "rpc/signalops_v1_create_ingest_credential",
    {
      method: "POST",
      body: JSON.stringify({
        p_tenant_id: input.tenantId,
        p_subject: subject,
        p_name: name,
        p_token_prefix: token.slice(0, 16),
        p_token_hash: createHash("sha256").update(token, "utf8").digest("hex"),
        p_scopes: scopes,
        p_expires_at: signalOpsCredentialExpiryV1(input.expiresInDays ?? 90, input.now),
        p_rotated_from_id: input.rotatedFromId ?? null,
        p_request_id: requestId,
      }),
    },
  );
  const row = rows[0];
  if (!row) throw new Error("Credential creation returned no credential");
  return { credential: mapCredential(row), token };
}

export async function revokeSignalOpsIngestCredentialV1(input: {
  tenantId: string;
  subject: string;
  credentialId: string;
  requestId: string;
  config?: SignalOpsSupabaseConfigV1;
}): Promise<{ id: string; revokedAt: string }> {
  if (!credentialIdPattern.test(input.credentialId)) throw new TypeError("Credential id must be a UUID");
  const rows = await signalOpsSupabaseRestRequestV1<Array<{ id: string; revoked_at: string }>>(
    requireConfig(input.config),
    "rpc/signalops_v1_revoke_ingest_credential",
    {
      method: "POST",
      body: JSON.stringify({
        p_tenant_id: input.tenantId,
        p_subject: assertSubject(input.subject),
        p_credential_id: input.credentialId,
        p_request_id: assertRequestId(input.requestId),
      }),
    },
  );
  const row = rows[0];
  if (!row) throw new Error("Credential is not active or does not belong to this workspace");
  return { id: row.id, revokedAt: row.revoked_at };
}

export async function rotateSignalOpsIngestCredentialV1(input: {
  tenantId: string;
  subject: string;
  credentialId: string;
  name: unknown;
  scopes?: SignalOpsPrincipalScopeV1[];
  expiresInDays?: number;
  requestId: string;
  now?: Date;
  randomBytes?: (size: number) => Uint8Array;
  config?: SignalOpsSupabaseConfigV1;
}): Promise<SignalOpsIssuedIngestCredentialV1> {
  if (!credentialIdPattern.test(input.credentialId)) {
    throw new TypeError("Credential id must be a UUID");
  }
  const subject = assertSubject(input.subject);
  const name = normalizeSignalOpsCredentialNameV1(input.name);
  const requestId = assertRequestId(input.requestId);
  const scopes = input.scopes ?? ["events:validate", "events:write"];
  if (
    scopes.length === 0 ||
    new Set(scopes).size !== scopes.length ||
    scopes.some((scope) => !allowedScopes.has(scope))
  ) {
    throw new TypeError("Credential scopes are invalid");
  }
  const token = createSignalOpsIngestCredentialTokenV1(input.randomBytes);
  const rows = await signalOpsSupabaseRestRequestV1<CredentialRow[]>(
    requireConfig(input.config),
    "rpc/signalops_v1_rotate_ingest_credential",
    {
      method: "POST",
      body: JSON.stringify({
        p_tenant_id: input.tenantId,
        p_subject: subject,
        p_source_credential_id: input.credentialId,
        p_name: name,
        p_token_prefix: token.slice(0, 16),
        p_token_hash: createHash("sha256").update(token, "utf8").digest("hex"),
        p_scopes: scopes,
        p_expires_at: signalOpsCredentialExpiryV1(input.expiresInDays ?? 90, input.now),
        p_request_id: requestId,
      }),
    },
  );
  const row = rows[0];
  if (!row) throw new Error("Credential rotation returned no replacement credential");
  return { credential: mapCredential(row), token };
}

export async function claimSignalOpsProductMilestoneV1(input: {
  tenantId: string;
  milestone: string;
  metadata?: Record<string, boolean | number | string | null>;
  config?: SignalOpsSupabaseConfigV1;
}): Promise<boolean> {
  if (!/^[a-z][a-z0-9_]{0,119}$/.test(input.milestone)) {
    throw new TypeError("Invalid product milestone");
  }
  const claimed = await signalOpsSupabaseRestRequestV1<boolean>(
    requireConfig(input.config),
    "rpc/signalops_v1_claim_product_milestone",
    {
      method: "POST",
      body: JSON.stringify({
        p_tenant_id: input.tenantId,
        p_milestone: input.milestone,
        p_metadata: input.metadata ?? {},
      }),
    },
  );
  return claimed === true;
}
