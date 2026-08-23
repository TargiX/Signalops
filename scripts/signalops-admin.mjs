#!/usr/bin/env node

import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TENANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const PROJECT_REF_PATTERN = /^[a-z0-9]{8,40}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUBJECT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/|-]{0,199}$/;
const ALLOWED_ROLES = new Set(["owner", "operator", "viewer"]);
const ALLOWED_SCOPES = new Set(["events:validate", "events:write"]);
const ALLOWED_RANGES = new Set(["24h", "7d", "30d", "90d", "all"]);
const BOOLEAN_FLAGS = new Set(["help", "send-invite", "replace-role", "no-expiry"]);

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

function fail(message) {
  throw new UsageError(message);
}

function parseFlags(argv) {
  const positional = [];
  const flags = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }

    const equalsIndex = value.indexOf("=");
    const name = value.slice(2, equalsIndex === -1 ? undefined : equalsIndex);
    if (!name || flags.has(name)) fail(`flag --${name || "<empty>"} may only be provided once`);

    if (equalsIndex !== -1) {
      if (BOOLEAN_FLAGS.has(name)) fail(`boolean flag --${name} does not take a value`);
      const flagValue = value.slice(equalsIndex + 1);
      if (!flagValue) fail(`flag --${name} requires a value`);
      flags.set(name, flagValue);
      continue;
    }

    if (BOOLEAN_FLAGS.has(name)) {
      flags.set(name, true);
      continue;
    }

    const flagValue = argv[index + 1];
    if (flagValue === undefined || flagValue.startsWith("--")) {
      fail(`flag --${name} requires a value`);
    }
    flags.set(name, flagValue);
    index += 1;
  }

  return { positional, flags };
}

function assertOnlyFlags(flags, allowed) {
  for (const name of flags.keys()) {
    if (!allowed.has(name)) fail(`unsupported flag --${name}`);
  }
}

function requiredFlag(flags, name) {
  const value = flags.get(name);
  if (typeof value !== "string" || !value.trim()) fail(`--${name} is required`);
  return value.trim();
}

function optionalFlag(flags, name) {
  const value = flags.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function boundedText(value, label, maximum) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    fail(`${label} must be 1-${maximum} characters without control characters`);
  }
  return normalized;
}

function tenantIdFlag(flags) {
  const value = requiredFlag(flags, "tenant-id");
  if (!TENANT_ID_PATTERN.test(value)) fail("--tenant-id must be a bounded opaque identifier");
  return value;
}

function subjectFlag(flags) {
  const value = requiredFlag(flags, "subject");
  if (!SUBJECT_PATTERN.test(value)) {
    fail("--subject must be an opaque non-email identifier using safe ASCII characters");
  }
  return value;
}

function roleFlag(flags) {
  const value = requiredFlag(flags, "role");
  if (!ALLOWED_ROLES.has(value)) fail("--role must be owner, operator, or viewer");
  return value;
}

function uuidFlag(flags, name) {
  const value = requiredFlag(flags, name);
  if (!UUID_PATTERN.test(value)) fail(`--${name} must be a UUID`);
  return value.toLowerCase();
}

function parseScopes(value) {
  const scopes = value
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  if (scopes.length === 0 || new Set(scopes).size !== scopes.length) {
    fail("--scopes must contain one or more unique comma-separated scopes");
  }
  for (const scope of scopes) {
    if (!ALLOWED_SCOPES.has(scope)) fail(`unsupported ingest scope: ${scope}`);
  }
  return scopes;
}

function parseExpiry(flags, now) {
  const expiresAt = optionalFlag(flags, "expires-at");
  const noExpiry = flags.get("no-expiry") === true;
  if (Boolean(expiresAt) === noExpiry) {
    fail("choose exactly one of --expires-at <ISO timestamp> or --no-expiry");
  }
  if (noExpiry) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(expiresAt)) {
    fail("--expires-at must be an ISO timestamp with an explicit timezone");
  }
  const milliseconds = Date.parse(expiresAt);
  if (!Number.isFinite(milliseconds) || milliseconds <= now().getTime()) {
    fail("--expires-at must be a valid timestamp in the future");
  }
  return new Date(milliseconds).toISOString();
}

function validateEmail(value) {
  const email = value.trim();
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ||
    /[\u0000-\u001f\u007f]/u.test(email)
  ) {
    fail("--email must be a valid email address");
  }
  return email;
}

function validateRedirectUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("--redirect-to must be a valid HTTPS URL");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    fail("--redirect-to must be a credential-free HTTPS URL");
  }
  return url.toString();
}

function decodeJwtPayload(value) {
  const segments = value.split(".");
  if (segments.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function validateSecretKey(secretKey) {
  if (secretKey.startsWith("sb_publishable_") || secretKey.startsWith("sb_anon_")) {
    fail("SUPABASE_SECRET_KEY must be a secret/service-role key, not a public key");
  }
  if (secretKey.startsWith("sb_secret_") && secretKey.length >= 24) return secretKey;
  const payload = decodeJwtPayload(secretKey);
  if (payload?.role === "service_role") return secretKey;
  fail("SUPABASE_SECRET_KEY must be an sb_secret_ key or a legacy service_role JWT");
}

export function resolveSignalOpsAdminTargetV1({ env, flags, mutation }) {
  const projectRef = requiredFlag(flags, "project-ref");
  if (!PROJECT_REF_PATTERN.test(projectRef)) {
    fail("--project-ref must be the lowercase Supabase project reference");
  }

  const configuredUrl = env.SUPABASE_URL?.trim();
  const configuredSecret = (env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!configuredUrl || !configuredSecret) {
    fail("SUPABASE_URL and SUPABASE_SECRET_KEY are required in the environment");
  }

  let url;
  try {
    url = new URL(configuredUrl);
  } catch {
    fail("SUPABASE_URL must be a valid hosted Supabase URL");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== `${projectRef}.supabase.co` ||
    url.port ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    fail(`SUPABASE_URL must be exactly https://${projectRef}.supabase.co`);
  }

  if (mutation) {
    const confirmation = requiredFlag(flags, "confirm-project-ref");
    if (confirmation !== projectRef) {
      fail("--confirm-project-ref must exactly match --project-ref for mutations");
    }
  }

  return {
    projectRef,
    url: `https://${projectRef}.supabase.co`,
    secretKey: validateSecretKey(configuredSecret),
  };
}

async function requestJson(fetchImpl, target, pathname, options = {}) {
  const method = options.method ?? "GET";
  const response = await fetchImpl(new URL(pathname, target.url), {
    method,
    headers: {
      accept: "application/json",
      apikey: target.secretKey,
      authorization: `Bearer ${target.secretKey}`,
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.prefer ? { prefer: options.prefer } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(10_000),
  });

  const text = await response.text();
  if (!response.ok) {
    const requestId = response.headers.get("x-request-id") ?? response.headers.get("sb-request-id");
    throw new Error(
      `Supabase ${method} ${new URL(pathname, target.url).pathname} failed with ${response.status}` +
        (requestId ? ` (request ${requestId})` : ""),
    );
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Supabase ${method} response was not valid JSON`);
  }
}

function restPath(table, parameters = {}) {
  const query = new URLSearchParams(parameters);
  return `/rest/v1/${table}${query.size ? `?${query}` : ""}`;
}

function writeJson(stdout, value) {
  stdout(`${JSON.stringify(value, null, 2)}\n`);
}

function actorForMutation(flags) {
  const actor = boundedText(requiredFlag(flags, "actor-subject"), "--actor-subject", 200);
  if (!SUBJECT_PATTERN.test(actor)) {
    fail("--actor-subject must be an opaque non-email identifier using safe ASCII characters");
  }
  return actor;
}

function auditTarget(kind, identifier) {
  const direct = `${kind}:${identifier}`;
  if (direct.length <= 200) return direct;
  const digest = createHash("sha256").update(identifier, "utf8").digest("hex");
  return `${kind}-sha256:${digest}`;
}

async function auditMutation(context, event) {
  try {
    await requestJson(context.fetchImpl, context.target, "/rest/v1/signalops_v1_audit_log", {
      method: "POST",
      prefer: "return=minimal",
      body: {
        tenant_id: event.tenantId ?? null,
        actor_subject: context.actor,
        action: event.action,
        target: event.target ?? null,
        metadata: event.metadata ?? {},
      },
    });
  } catch (error) {
    throw new Error(`mutation completed but audit persistence failed: ${error.message}`);
  }
}

async function requireActiveTenant(context, tenantId) {
  const rows = await requestJson(
    context.fetchImpl,
    context.target,
    restPath("signalops_v1_tenants", {
      select: "id,name,status",
      id: `eq.${tenantId}`,
      limit: "2",
    }),
  );
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0].status !== "active") {
    fail(`tenant ${tenantId} does not exist or is not active`);
  }
  return rows[0];
}

async function tenantList(context) {
  const rows = await requestJson(
    context.fetchImpl,
    context.target,
    restPath("signalops_v1_tenants", {
      select: "id,name,status,created_at,updated_at",
      order: "id.asc",
      limit: "500",
    }),
  );
  writeJson(context.stdout, {
    projectRef: context.target.projectRef,
    tenants: rows,
    mayBeTruncated: rows.length === 500,
  });
}

async function tenantBootstrap(context, flags) {
  const tenantId = tenantIdFlag(flags);
  const tenantName = boundedText(requiredFlag(flags, "tenant-name"), "--tenant-name", 120);
  const existing = await requestJson(
    context.fetchImpl,
    context.target,
    restPath("signalops_v1_tenants", {
      select: "id,name,status",
      id: `eq.${tenantId}`,
      limit: "2",
    }),
  );
  if (existing.length > 0) {
    if (existing.length === 1 && existing[0].name === tenantName && existing[0].status === "active") {
      writeJson(context.stdout, { status: "unchanged", tenant: existing[0] });
      return;
    }
    fail(`tenant ${tenantId} already exists with different properties; bootstrap never overwrites`);
  }

  const created = await requestJson(
    context.fetchImpl,
    context.target,
    restPath("signalops_v1_tenants", { select: "id,name,status,created_at" }),
    {
      method: "POST",
      prefer: "return=representation",
      body: { id: tenantId, name: tenantName, status: "active" },
    },
  );
  if (!Array.isArray(created) || created.length !== 1) {
    throw new Error("tenant insert did not return exactly one row; verify the target before retrying");
  }
  await auditMutation(context, {
    tenantId,
    action: "tenant.bootstrap",
    target: auditTarget("tenant", tenantId),
  });
  writeJson(context.stdout, { status: "created", tenant: created[0] });
}

async function membershipList(context, flags) {
  const tenantId = optionalFlag(flags, "tenant-id");
  const subject = optionalFlag(flags, "subject");
  if (tenantId && !TENANT_ID_PATTERN.test(tenantId)) fail("--tenant-id is invalid");
  if (subject && !SUBJECT_PATTERN.test(subject)) fail("--subject is invalid");
  const parameters = {
    select: "tenant_id,subject,role,created_at,updated_at",
    order: "tenant_id.asc,subject.asc",
    limit: "1000",
  };
  if (tenantId) parameters.tenant_id = `eq.${tenantId}`;
  if (subject) parameters.subject = `eq.${subject}`;
  const rows = await requestJson(
    context.fetchImpl,
    context.target,
    restPath("signalops_v1_operator_memberships", parameters),
  );
  writeJson(context.stdout, {
    projectRef: context.target.projectRef,
    memberships: rows,
    mayBeTruncated: rows.length === 1000,
  });
}

async function membershipGrant(context, flags) {
  const tenantId = tenantIdFlag(flags);
  const subject = subjectFlag(flags);
  const role = roleFlag(flags);
  await requireActiveTenant(context, tenantId);

  const parameters = {
    select: "tenant_id,subject,role,created_at,updated_at",
    tenant_id: `eq.${tenantId}`,
    subject: `eq.${subject}`,
    limit: "2",
  };
  const existing = await requestJson(
    context.fetchImpl,
    context.target,
    restPath("signalops_v1_operator_memberships", parameters),
  );

  if (existing.length === 1 && existing[0].role === role) {
    writeJson(context.stdout, { status: "unchanged", membership: existing[0] });
    return;
  }
  if (existing.length > 0 && flags.get("replace-role") !== true) {
    fail(
      `membership already has role ${existing[0].role}; pass --replace-role to explicitly change it`,
    );
  }

  let membership;
  let status;
  if (existing.length > 0) {
    const changed = await requestJson(
      context.fetchImpl,
      context.target,
      restPath("signalops_v1_operator_memberships", {
        select: "tenant_id,subject,role,updated_at",
        tenant_id: `eq.${tenantId}`,
        subject: `eq.${subject}`,
      }),
      {
        method: "PATCH",
        prefer: "return=representation",
        body: { role, updated_at: context.now().toISOString() },
      },
    );
    if (!Array.isArray(changed) || changed.length !== 1) {
      throw new Error("membership role update did not affect exactly one row");
    }
    [membership] = changed;
    status = "role-updated";
  } else {
    const created = await requestJson(
      context.fetchImpl,
      context.target,
      restPath("signalops_v1_operator_memberships", {
        select: "tenant_id,subject,role,created_at,updated_at",
      }),
      {
        method: "POST",
        prefer: "return=representation",
        body: { tenant_id: tenantId, subject, role },
      },
    );
    if (!Array.isArray(created) || created.length !== 1) {
      throw new Error("membership insert did not return exactly one row");
    }
    [membership] = created;
    status = "created";
  }

  await auditMutation(context, {
    tenantId,
    action: status === "created" ? "membership.grant" : "membership.role_change",
    target: auditTarget("membership", subject),
    metadata: { role },
  });
  writeJson(context.stdout, { status, membership });
}

async function authInvite(context, flags) {
  if (flags.get("send-invite") !== true) {
    fail("auth invite requires the explicit --send-invite mutation flag");
  }
  const email = validateEmail(requiredFlag(flags, "email"));
  const redirectTo = optionalFlag(flags, "redirect-to");
  const invitePath = redirectTo
    ? `/auth/v1/invite?${new URLSearchParams({ redirect_to: validateRedirectUrl(redirectTo) })}`
    : "/auth/v1/invite";

  const response = await requestJson(context.fetchImpl, context.target, invitePath, {
    method: "POST",
    body: { email },
  });
  const subject = response?.id ?? response?.user?.id;
  if (typeof subject !== "string" || !SUBJECT_PATTERN.test(subject)) {
    throw new Error("invite succeeded but did not return a usable subject; inspect Supabase Auth");
  }
  await auditMutation(context, {
    action: "auth.invite",
    target: auditTarget("auth-user", subject),
  });
  writeJson(context.stdout, {
    status: "invite-sent",
    subject,
    next: "grant membership explicitly with membership grant --subject <subject>",
  });
}

function credentialToken(randomBytes) {
  return `sop_live_${randomBytes(32).toString("base64url")}`;
}

function credentialInsertBody({ tenantId, name, scopes, expiresAt, rotatedFromId, token }) {
  return {
    tenant_id: tenantId,
    name,
    token_prefix: token.slice(0, 16),
    token_hash: createHash("sha256").update(token, "utf8").digest("hex"),
    scopes,
    expires_at: expiresAt,
    rotated_from_id: rotatedFromId ?? null,
  };
}

async function ensureUniqueActiveCredentialName(context, tenantId, name) {
  const rows = await requestJson(
    context.fetchImpl,
    context.target,
    restPath("signalops_v1_ingest_credentials", {
      select: "id,name",
      tenant_id: `eq.${tenantId}`,
      revoked_at: "is.null",
      limit: "500",
    }),
  );
  if (rows.length === 500) {
    fail("tenant has at least 500 active credentials; uniqueness cannot be proven safely");
  }
  if (rows.some((row) => row.name === name)) {
    fail(`an active credential named ${name} already exists for tenant ${tenantId}`);
  }
}

async function insertCredential(context, input) {
  const token = credentialToken(context.randomBytes);
  const body = credentialInsertBody({ ...input, token });
  const created = await requestJson(
    context.fetchImpl,
    context.target,
    restPath("signalops_v1_ingest_credentials", {
      select:
        "id,tenant_id,name,token_prefix,scopes,created_at,expires_at,rotated_from_id,revoked_at",
    }),
    {
      method: "POST",
      prefer: "return=representation",
      body,
    },
  );
  if (!Array.isArray(created) || created.length !== 1) {
    throw new Error(
      "credential insert did not return exactly one row; inspect the target before retrying",
    );
  }

  // This is intentionally the only write of the raw token. It happens immediately after durable
  // creation so a later audit failure cannot strand an active credential whose secret was hidden.
  context.stdout(`credential_token=${token}\n`);
  return created[0];
}

async function credentialList(context, flags) {
  const tenantId = tenantIdFlag(flags);
  const rows = await requestJson(
    context.fetchImpl,
    context.target,
    restPath("signalops_v1_ingest_credentials", {
      select:
        "id,tenant_id,name,token_prefix,scopes,created_at,last_used_at,expires_at,rotated_from_id,revoked_at",
      tenant_id: `eq.${tenantId}`,
      order: "created_at.desc",
      limit: "500",
    }),
  );
  writeJson(context.stdout, {
    projectRef: context.target.projectRef,
    credentials: rows,
    mayBeTruncated: rows.length === 500,
  });
}

async function credentialCreate(context, flags) {
  const tenantId = tenantIdFlag(flags);
  const name = boundedText(requiredFlag(flags, "name"), "--name", 120);
  const scopes = parseScopes(optionalFlag(flags, "scopes") ?? "events:validate,events:write");
  const expiresAt = parseExpiry(flags, context.now);
  await requireActiveTenant(context, tenantId);
  await ensureUniqueActiveCredentialName(context, tenantId, name);
  const credential = await insertCredential(context, {
    tenantId,
    name,
    scopes,
    expiresAt,
    rotatedFromId: null,
  });
  await auditMutation(context, {
    tenantId,
    action: "credential.create",
    target: auditTarget("credential", credential.id),
    metadata: { scopes, expiresAt: expiresAt ?? "none" },
  });
  writeJson(context.stdout, { status: "created", credential });
}

async function activeCredential(context, tenantId, credentialId) {
  const rows = await requestJson(
    context.fetchImpl,
    context.target,
    restPath("signalops_v1_ingest_credentials", {
      select: "id,tenant_id,name,scopes,expires_at,revoked_at",
      tenant_id: `eq.${tenantId}`,
      id: `eq.${credentialId}`,
      limit: "2",
    }),
  );
  if (!Array.isArray(rows) || rows.length !== 1) fail("credential was not found in the tenant");
  if (rows[0].revoked_at) fail("credential is already revoked");
  return rows[0];
}

async function credentialRotate(context, flags) {
  const tenantId = tenantIdFlag(flags);
  const credentialId = uuidFlag(flags, "credential-id");
  const confirmation = uuidFlag(flags, "confirm-rotate");
  if (confirmation !== credentialId) {
    fail("--confirm-rotate must exactly match --credential-id");
  }
  const name = boundedText(requiredFlag(flags, "name"), "--name", 120);
  const expiresAt = parseExpiry(flags, context.now);
  await requireActiveTenant(context, tenantId);
  const previous = await activeCredential(context, tenantId, credentialId);
  const scopes = optionalFlag(flags, "scopes")
    ? parseScopes(optionalFlag(flags, "scopes"))
    : parseScopes(Array.isArray(previous.scopes) ? previous.scopes.join(",") : "");
  await ensureUniqueActiveCredentialName(context, tenantId, name);

  const activeReplacements = await requestJson(
    context.fetchImpl,
    context.target,
    restPath("signalops_v1_ingest_credentials", {
      select: "id",
      tenant_id: `eq.${tenantId}`,
      rotated_from_id: `eq.${credentialId}`,
      revoked_at: "is.null",
      limit: "1",
    }),
  );
  if (activeReplacements.length > 0) {
    fail("an active replacement already exists; install or revoke it before rotating again");
  }

  const credential = await insertCredential(context, {
    tenantId,
    name,
    scopes,
    expiresAt,
    rotatedFromId: credentialId,
  });
  await auditMutation(context, {
    tenantId,
    action: "credential.rotate_stage",
    target: auditTarget("credential", credential.id),
    metadata: { rotatedFromId: credentialId, scopes, expiresAt: expiresAt ?? "none" },
  });
  writeJson(context.stdout, {
    status: "replacement-created",
    credential,
    previousCredential: { id: credentialId, status: "still-active" },
    next: "install and verify the replacement, then explicitly run credential revoke",
  });
}

async function credentialRevoke(context, flags) {
  const tenantId = tenantIdFlag(flags);
  const credentialId = uuidFlag(flags, "credential-id");
  const confirmation = uuidFlag(flags, "confirm-revoke");
  if (confirmation !== credentialId) {
    fail("--confirm-revoke must exactly match --credential-id");
  }
  await requireActiveTenant(context, tenantId);
  await activeCredential(context, tenantId, credentialId);
  const revokedAt = context.now().toISOString();
  const rows = await requestJson(
    context.fetchImpl,
    context.target,
    restPath("signalops_v1_ingest_credentials", {
      select: "id,tenant_id,name,token_prefix,scopes,revoked_at",
      tenant_id: `eq.${tenantId}`,
      id: `eq.${credentialId}`,
      revoked_at: "is.null",
    }),
    {
      method: "PATCH",
      prefer: "return=representation",
      body: { revoked_at: revokedAt },
    },
  );
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error("credential revoke did not affect exactly one active credential");
  }
  await auditMutation(context, {
    tenantId,
    action: "credential.revoke",
    target: auditTarget("credential", credentialId),
  });
  writeJson(context.stdout, { status: "revoked", credential: rows[0] });
}

async function projectionRebuild(context, flags) {
  const tenantId = tenantIdFlag(flags);
  const range = requiredFlag(flags, "range");
  if (!ALLOWED_RANGES.has(range)) fail("--range must be 24h, 7d, 30d, 90d, or all");
  if (requiredFlag(flags, "confirm-rebuild") !== tenantId) {
    fail("--confirm-rebuild must exactly match --tenant-id");
  }
  await requireActiveTenant(context, tenantId);

  const parameters = {
    select: "tenant_id,range_key,projected_at,source_event_count",
    tenant_id: `eq.${tenantId}`,
  };
  if (range !== "all") parameters.range_key = `eq.${range}`;
  const removed = await requestJson(
    context.fetchImpl,
    context.target,
    restPath("signalops_v1_projection_snapshots", parameters),
    { method: "DELETE", prefer: "return=representation" },
  );

  if (range === "all") {
    try {
      await requestJson(
        context.fetchImpl,
        context.target,
        restPath("signalops_v1_projection_checkpoints", {
          tenant_id: `eq.${tenantId}`,
          projector: "eq.ops-snapshot-v1",
        }),
        { method: "DELETE", prefer: "return=minimal" },
      );
    } catch (error) {
      throw new Error(
        `projection snapshots were invalidated but checkpoint cleanup failed: ${error.message}`,
      );
    }
  }

  await auditMutation(context, {
    tenantId,
    action: "projection.invalidate",
    target: auditTarget("projection", range),
    metadata: { removedSnapshots: Array.isArray(removed) ? removed.length : 0 },
  });
  writeJson(context.stdout, {
    status: "invalidated",
    tenantId,
    range,
    removedSnapshots: Array.isArray(removed) ? removed : [],
    next: "request each invalidated cockpit range and verify the new projection watermark",
  });
}

function usage() {
  return `SignalOps production administration

Every command requires:
  --project-ref <ref>                  must match SUPABASE_URL exactly

Every mutation additionally requires:
  --confirm-project-ref <ref>          exact project confirmation
  --actor-subject <opaque-subject>     audit actor

Commands:
  tenant list
  tenant bootstrap --tenant-id <id> --tenant-name <name>
  membership list [--tenant-id <id>] [--subject <subject>]
  membership grant --tenant-id <id> --subject <subject> --role <owner|operator|viewer>
                   [--replace-role]
  auth invite --email <email> --send-invite [--redirect-to <https-url>]
  credential list --tenant-id <id>
  credential create --tenant-id <id> --name <name> [--scopes <csv>]
                    (--expires-at <ISO> | --no-expiry)
  credential rotate --tenant-id <id> --credential-id <uuid> --confirm-rotate <uuid>
                    --name <replacement-name> [--scopes <csv>]
                    (--expires-at <ISO> | --no-expiry)
  credential revoke --tenant-id <id> --credential-id <uuid> --confirm-revoke <uuid>
  projection rebuild --tenant-id <id> --range <24h|7d|30d|90d|all>
                     --confirm-rebuild <tenant-id>

Secrets are read only from SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY).
Credential create/rotate prints the raw ingest token once. Rotation is staged: the old credential
remains active until a separate, explicitly confirmed revoke command.
`;
}

const COMMANDS = new Map([
  ["tenant list", { mutation: false, allowed: ["project-ref"], run: tenantList }],
  [
    "tenant bootstrap",
    {
      mutation: true,
      allowed: ["project-ref", "confirm-project-ref", "actor-subject", "tenant-id", "tenant-name"],
      run: tenantBootstrap,
    },
  ],
  [
    "membership list",
    { mutation: false, allowed: ["project-ref", "tenant-id", "subject"], run: membershipList },
  ],
  [
    "membership grant",
    {
      mutation: true,
      allowed: [
        "project-ref",
        "confirm-project-ref",
        "actor-subject",
        "tenant-id",
        "subject",
        "role",
        "replace-role",
      ],
      run: membershipGrant,
    },
  ],
  [
    "auth invite",
    {
      mutation: true,
      allowed: [
        "project-ref",
        "confirm-project-ref",
        "actor-subject",
        "email",
        "send-invite",
        "redirect-to",
      ],
      run: authInvite,
    },
  ],
  [
    "credential list",
    { mutation: false, allowed: ["project-ref", "tenant-id"], run: credentialList },
  ],
  [
    "credential create",
    {
      mutation: true,
      allowed: [
        "project-ref",
        "confirm-project-ref",
        "actor-subject",
        "tenant-id",
        "name",
        "scopes",
        "expires-at",
        "no-expiry",
      ],
      run: credentialCreate,
    },
  ],
  [
    "credential rotate",
    {
      mutation: true,
      allowed: [
        "project-ref",
        "confirm-project-ref",
        "actor-subject",
        "tenant-id",
        "credential-id",
        "confirm-rotate",
        "name",
        "scopes",
        "expires-at",
        "no-expiry",
      ],
      run: credentialRotate,
    },
  ],
  [
    "credential revoke",
    {
      mutation: true,
      allowed: [
        "project-ref",
        "confirm-project-ref",
        "actor-subject",
        "tenant-id",
        "credential-id",
        "confirm-revoke",
      ],
      run: credentialRevoke,
    },
  ],
  [
    "projection rebuild",
    {
      mutation: true,
      allowed: [
        "project-ref",
        "confirm-project-ref",
        "actor-subject",
        "tenant-id",
        "range",
        "confirm-rebuild",
      ],
      run: projectionRebuild,
    },
  ],
]);

export async function runSignalOpsAdminV1({
  argv,
  env = process.env,
  fetchImpl = globalThis.fetch,
  stdout = (text) => process.stdout.write(text),
  stderr = (text) => process.stderr.write(text),
  randomBytes = nodeRandomBytes,
  now = () => new Date(),
}) {
  const { positional, flags } = parseFlags(argv);
  if (flags.get("help") === true || positional.length === 0) {
    assertOnlyFlags(flags, new Set(["help"]));
    stdout(usage());
    return;
  }
  if (positional.length !== 2) fail("commands have exactly two words; run with --help");
  const commandName = positional.join(" ");
  const command = COMMANDS.get(commandName);
  if (!command) fail(`unknown command: ${commandName}`);
  assertOnlyFlags(flags, new Set(command.allowed));
  const target = resolveSignalOpsAdminTargetV1({ env, flags, mutation: command.mutation });
  const context = { target, fetchImpl, stdout, stderr, randomBytes, now };
  if (command.mutation) context.actor = actorForMutation(flags);
  await command.run(context, flags);
}

async function main() {
  try {
    await runSignalOpsAdminV1({ argv: process.argv.slice(2) });
  } catch (error) {
    const prefix = error instanceof UsageError ? "usage error" : "admin error";
    process.stderr.write(`${prefix}: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) await main();
