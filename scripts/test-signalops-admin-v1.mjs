import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { runSignalOpsAdminV1 } from "./signalops-admin.mjs";

const PROJECT_REF = "abcdefghijklmnopqrst";
const BASE_ENV = Object.freeze({
  SUPABASE_URL: `https://${PROJECT_REF}.supabase.co`,
  SUPABASE_SECRET_KEY: "sb_secret_123456789012345678901234567890",
});
const ACTOR_FLAGS = [
  "--project-ref",
  PROJECT_REF,
  "--confirm-project-ref",
  PROJECT_REF,
  "--actor-subject",
  "ops-admin-01",
];
const TENANT_ID = "phosphene-production";
const OLD_CREDENTIAL_ID = "11111111-1111-4111-8111-111111111111";
const NEW_CREDENTIAL_ID = "22222222-2222-4222-8222-222222222222";
const FIXED_NOW = new Date("2026-08-23T10:00:00.000Z");
const FIXED_RANDOM = Buffer.alloc(32, 7);
const FIXED_TOKEN = `sop_live_${FIXED_RANDOM.toString("base64url")}`;

function jsonResponse(value, status = 200) {
  return new Response(value === null ? null : JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function captureRun(argv, handler, overrides = {}) {
  const calls = [];
  const stdout = [];
  const stderr = [];
  const fetchImpl = async (url, init) => {
    const call = {
      url: new URL(url),
      init,
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return handler(call, calls.length - 1);
  };
  await runSignalOpsAdminV1({
    argv,
    env: BASE_ENV,
    fetchImpl,
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    randomBytes: () => FIXED_RANDOM,
    now: () => FIXED_NOW,
    ...overrides,
  });
  return { calls, stdout: stdout.join(""), stderr: stderr.join("") };
}

function activeTenant() {
  return { id: TENANT_ID, name: "Phosphene Production", status: "active" };
}

{
  let called = false;
  await assert.rejects(
    () =>
      runSignalOpsAdminV1({
        argv: ["tenant", "list", "--project-ref", "wrongprojectref00000"],
        env: BASE_ENV,
        fetchImpl: async () => {
          called = true;
          return jsonResponse([]);
        },
      }),
    /SUPABASE_URL must be exactly/,
  );
  assert.equal(called, false, "a target mismatch must fail before network access");
}

{
  await assert.rejects(
    () =>
      runSignalOpsAdminV1({
        argv: ["tenant", "list", "--project-ref", PROJECT_REF],
        env: { ...BASE_ENV, SUPABASE_SECRET_KEY: "sb_publishable_not-an-admin-key" },
        fetchImpl: async () => jsonResponse([]),
      }),
    /secret\/service-role key/,
  );
}

{
  const result = await captureRun(
    ["tenant", "list", "--project-ref", PROJECT_REF],
    (call) => {
      assert.equal(call.url.pathname, "/rest/v1/signalops_v1_tenants");
      assert.equal(call.init.method, "GET");
      assert.equal(call.init.headers.apikey, BASE_ENV.SUPABASE_SECRET_KEY);
      return jsonResponse([activeTenant()]);
    },
  );
  assert.equal(result.calls.length, 1);
  assert.match(result.stdout, new RegExp(PROJECT_REF));
  assert.match(result.stdout, new RegExp(TENANT_ID));
}

{
  let called = false;
  await assert.rejects(
    () =>
      runSignalOpsAdminV1({
        argv: [
          "tenant",
          "bootstrap",
          "--project-ref",
          PROJECT_REF,
          "--confirm-project-ref",
          "a-different-project",
          "--actor-subject",
          "ops-admin-01",
          "--tenant-id",
          TENANT_ID,
          "--tenant-name",
          "Phosphene Production",
        ],
        env: BASE_ENV,
        fetchImpl: async () => {
          called = true;
          return jsonResponse([]);
        },
      }),
    /confirm-project-ref must exactly match/,
  );
  assert.equal(called, false);
}

{
  let called = false;
  await assert.rejects(
    () =>
      runSignalOpsAdminV1({
        argv: [
          "tenant",
          "bootstrap",
          "--project-ref",
          PROJECT_REF,
          "--confirm-project-ref",
          PROJECT_REF,
          "--actor-subject",
          "admin@example.com",
          "--tenant-id",
          TENANT_ID,
          "--tenant-name",
          "Phosphene Production",
        ],
        env: BASE_ENV,
        fetchImpl: async () => {
          called = true;
          return jsonResponse([]);
        },
      }),
    /actor-subject must be an opaque non-email identifier/,
  );
  assert.equal(called, false, "an email must never be persisted as the audit actor");
}

{
  const result = await captureRun(
    [
      "tenant",
      "bootstrap",
      ...ACTOR_FLAGS,
      "--tenant-id",
      TENANT_ID,
      "--tenant-name",
      "Phosphene Production",
    ],
    (call) => {
      if (call.url.pathname.endsWith("signalops_v1_tenants") && call.init.method === "GET") {
        return jsonResponse([]);
      }
      if (call.url.pathname.endsWith("signalops_v1_tenants") && call.init.method === "POST") {
        assert.deepEqual(call.body, {
          id: TENANT_ID,
          name: "Phosphene Production",
          status: "active",
        });
        return jsonResponse([{ ...activeTenant(), created_at: FIXED_NOW.toISOString() }], 201);
      }
      if (call.url.pathname.endsWith("signalops_v1_audit_log")) {
        assert.equal(call.body.action, "tenant.bootstrap");
        assert.equal(call.body.actor_subject, "ops-admin-01");
        return jsonResponse(null, 201);
      }
      throw new Error(`unexpected fake request: ${call.init.method} ${call.url}`);
    },
  );
  assert.equal(result.calls.length, 3);
  assert.match(result.stdout, /"status": "created"/);
}

{
  const argv = [
    "membership",
    "grant",
    ...ACTOR_FLAGS,
    "--tenant-id",
    TENANT_ID,
    "--subject",
    "70ea64ef-445a-45b4-b12b-c67bc7d758fd",
    "--role",
    "owner",
  ];
  const resultPromise = captureRun(argv, (call) => {
    if (call.url.pathname.endsWith("signalops_v1_tenants")) return jsonResponse([activeTenant()]);
    if (call.url.pathname.endsWith("signalops_v1_operator_memberships")) {
      return jsonResponse([
        {
          tenant_id: TENANT_ID,
          subject: "70ea64ef-445a-45b4-b12b-c67bc7d758fd",
          role: "viewer",
        },
      ]);
    }
    throw new Error(`unexpected fake request: ${call.url}`);
  });
  await assert.rejects(resultPromise, /pass --replace-role/);
}

{
  const subject = "70ea64ef-445a-45b4-b12b-c67bc7d758fd";
  const result = await captureRun(
    [
      "membership",
      "grant",
      ...ACTOR_FLAGS,
      "--tenant-id",
      TENANT_ID,
      "--subject",
      subject,
      "--role",
      "operator",
    ],
    (call) => {
      if (call.url.pathname.endsWith("signalops_v1_tenants")) return jsonResponse([activeTenant()]);
      if (call.url.pathname.endsWith("signalops_v1_operator_memberships")) {
        if (call.init.method === "GET") return jsonResponse([]);
        assert.equal(call.init.method, "POST");
        assert.deepEqual(call.body, { tenant_id: TENANT_ID, subject, role: "operator" });
        return jsonResponse(
          [
            {
              ...call.body,
              created_at: FIXED_NOW.toISOString(),
              updated_at: FIXED_NOW.toISOString(),
            },
          ],
          201,
        );
      }
      if (call.url.pathname.endsWith("signalops_v1_audit_log")) {
        assert.equal(call.body.action, "membership.grant");
        return jsonResponse(null, 201);
      }
      throw new Error(`unexpected fake request: ${call.url}`);
    },
  );
  assert.match(result.stdout, /"status": "created"/);
  assert.equal(result.calls.length, 4);
}

{
  let called = false;
  await assert.rejects(
    () =>
      runSignalOpsAdminV1({
        argv: ["auth", "invite", ...ACTOR_FLAGS, "--email", "operator@example.com"],
        env: BASE_ENV,
        fetchImpl: async () => {
          called = true;
          return jsonResponse({});
        },
      }),
    /explicit --send-invite/,
  );
  assert.equal(called, false);
}

{
  const result = await captureRun(
    [
      "credential",
      "revoke",
      ...ACTOR_FLAGS,
      "--tenant-id",
      TENANT_ID,
      "--credential-id",
      OLD_CREDENTIAL_ID,
      "--confirm-revoke",
      OLD_CREDENTIAL_ID,
    ],
    (call) => {
      if (call.url.pathname.endsWith("signalops_v1_tenants")) return jsonResponse([activeTenant()]);
      if (call.url.pathname.endsWith("signalops_v1_ingest_credentials")) {
        if (call.init.method === "GET") {
          return jsonResponse([
            {
              id: OLD_CREDENTIAL_ID,
              tenant_id: TENANT_ID,
              name: "phosphene-prod-2026-08",
              scopes: ["events:validate", "events:write"],
              expires_at: "2026-11-23T10:00:00.000Z",
              revoked_at: null,
            },
          ]);
        }
        assert.equal(call.init.method, "PATCH");
        assert.deepEqual(call.body, { revoked_at: FIXED_NOW.toISOString() });
        return jsonResponse([
          {
            id: OLD_CREDENTIAL_ID,
            tenant_id: TENANT_ID,
            name: "phosphene-prod-2026-08",
            token_prefix: "sop_live_oldpref",
            scopes: ["events:validate", "events:write"],
            revoked_at: FIXED_NOW.toISOString(),
          },
        ]);
      }
      if (call.url.pathname.endsWith("signalops_v1_audit_log")) {
        assert.equal(call.body.action, "credential.revoke");
        return jsonResponse(null, 201);
      }
      throw new Error(`unexpected fake request: ${call.url}`);
    },
  );
  assert.match(result.stdout, /"status": "revoked"/);
  assert.equal(result.calls.length, 4);
}

{
  const invitedSubject = "70ea64ef-445a-45b4-b12b-c67bc7d758fd";
  const result = await captureRun(
    [
      "auth",
      "invite",
      ...ACTOR_FLAGS,
      "--email",
      "operator@example.com",
      "--send-invite",
      "--redirect-to",
      "https://signalops.example/auth/callback",
    ],
    (call) => {
      if (call.url.pathname === "/auth/v1/invite") {
        assert.deepEqual(call.body, { email: "operator@example.com" });
        assert.equal(
          call.url.searchParams.get("redirect_to"),
          "https://signalops.example/auth/callback",
        );
        return jsonResponse({ id: invitedSubject }, 200);
      }
      if (call.url.pathname.endsWith("signalops_v1_audit_log")) {
        assert.equal(call.body.target, `auth-user:${invitedSubject}`);
        assert.equal(JSON.stringify(call.body).includes("operator@example.com"), false);
        return jsonResponse(null, 201);
      }
      throw new Error(`unexpected fake request: ${call.url}`);
    },
  );
  assert.equal(result.calls.length, 2);
  assert.match(result.stdout, new RegExp(invitedSubject));
  assert.equal(result.stdout.includes("operator@example.com"), false);
}

{
  let insertedBody;
  const result = await captureRun(
    [
      "credential",
      "create",
      ...ACTOR_FLAGS,
      "--tenant-id",
      TENANT_ID,
      "--name",
      "phosphene-prod-2026-08",
      "--expires-at",
      "2026-11-23T10:00:00.000Z",
    ],
    (call) => {
      if (call.url.pathname.endsWith("signalops_v1_tenants")) return jsonResponse([activeTenant()]);
      if (call.url.pathname.endsWith("signalops_v1_ingest_credentials")) {
        if (call.init.method === "GET") return jsonResponse([]);
        insertedBody = call.body;
        assert.equal(call.init.method, "POST");
        return jsonResponse(
          [
            {
              id: NEW_CREDENTIAL_ID,
              tenant_id: TENANT_ID,
              name: call.body.name,
              token_prefix: call.body.token_prefix,
              scopes: call.body.scopes,
              created_at: FIXED_NOW.toISOString(),
              expires_at: call.body.expires_at,
              rotated_from_id: null,
              revoked_at: null,
            },
          ],
          201,
        );
      }
      if (call.url.pathname.endsWith("signalops_v1_audit_log")) return jsonResponse(null, 201);
      throw new Error(`unexpected fake request: ${call.url}`);
    },
  );
  assert.equal(insertedBody.token_hash, createSha256(FIXED_TOKEN));
  assert.equal(insertedBody.token_prefix, FIXED_TOKEN.slice(0, 16));
  assert.equal(JSON.stringify(insertedBody).includes(FIXED_TOKEN), false);
  assert.equal(result.stdout.split(FIXED_TOKEN).length - 1, 1, "raw token must be printed once");
  assert.equal(
    result.calls.some((call) => (JSON.stringify(call.body) ?? "").includes(FIXED_TOKEN)),
    false,
  );
}

{
  const result = await captureRun(
    [
      "credential",
      "rotate",
      ...ACTOR_FLAGS,
      "--tenant-id",
      TENANT_ID,
      "--credential-id",
      OLD_CREDENTIAL_ID,
      "--confirm-rotate",
      OLD_CREDENTIAL_ID,
      "--name",
      "phosphene-prod-2026-11",
      "--expires-at",
      "2027-02-23T10:00:00.000Z",
    ],
    (call) => {
      if (call.url.pathname.endsWith("signalops_v1_tenants")) return jsonResponse([activeTenant()]);
      if (call.url.pathname.endsWith("signalops_v1_ingest_credentials")) {
        if (call.init.method === "GET" && call.url.searchParams.has("id")) {
          return jsonResponse([
            {
              id: OLD_CREDENTIAL_ID,
              tenant_id: TENANT_ID,
              name: "phosphene-prod-2026-08",
              scopes: ["events:validate", "events:write"],
              expires_at: "2026-11-23T10:00:00.000Z",
              revoked_at: null,
            },
          ]);
        }
        if (call.init.method === "GET") return jsonResponse([]);
        assert.equal(call.init.method, "POST");
        assert.equal(call.body.rotated_from_id, OLD_CREDENTIAL_ID);
        return jsonResponse(
          [
            {
              id: NEW_CREDENTIAL_ID,
              tenant_id: TENANT_ID,
              name: call.body.name,
              token_prefix: call.body.token_prefix,
              scopes: call.body.scopes,
              created_at: FIXED_NOW.toISOString(),
              expires_at: call.body.expires_at,
              rotated_from_id: OLD_CREDENTIAL_ID,
              revoked_at: null,
            },
          ],
          201,
        );
      }
      if (call.url.pathname.endsWith("signalops_v1_audit_log")) return jsonResponse(null, 201);
      throw new Error(`unexpected fake request: ${call.url}`);
    },
  );
  assert.equal(result.stdout.split(FIXED_TOKEN).length - 1, 1);
  assert.match(result.stdout, /"status": "still-active"/);
  assert.equal(
    result.calls.some(
      (call) =>
        call.url.pathname.endsWith("signalops_v1_ingest_credentials") &&
        ["PATCH", "DELETE"].includes(call.init.method),
    ),
    false,
    "staged rotation must never revoke the previous credential",
  );
}

{
  let called = false;
  await assert.rejects(
    () =>
      runSignalOpsAdminV1({
        argv: [
          "credential",
          "revoke",
          ...ACTOR_FLAGS,
          "--tenant-id",
          TENANT_ID,
          "--credential-id",
          OLD_CREDENTIAL_ID,
          "--confirm-revoke",
          NEW_CREDENTIAL_ID,
        ],
        env: BASE_ENV,
        fetchImpl: async () => {
          called = true;
          return jsonResponse([]);
        },
      }),
    /confirm-revoke must exactly match/,
  );
  assert.equal(called, false);
}

{
  const result = await captureRun(
    [
      "projection",
      "rebuild",
      ...ACTOR_FLAGS,
      "--tenant-id",
      TENANT_ID,
      "--range",
      "7d",
      "--confirm-rebuild",
      TENANT_ID,
    ],
    (call) => {
      if (call.url.pathname.endsWith("signalops_v1_tenants")) return jsonResponse([activeTenant()]);
      if (call.url.pathname.endsWith("signalops_v1_projection_snapshots")) {
        assert.equal(call.init.method, "DELETE");
        assert.equal(call.url.searchParams.get("range_key"), "eq.7d");
        return jsonResponse([
          {
            tenant_id: TENANT_ID,
            range_key: "7d",
            projected_at: FIXED_NOW.toISOString(),
            source_event_count: 42,
          },
        ]);
      }
      if (call.url.pathname.endsWith("signalops_v1_audit_log")) return jsonResponse(null, 201);
      throw new Error(`unexpected fake request: ${call.url}`);
    },
  );
  assert.match(result.stdout, /"status": "invalidated"/);
  assert.equal(
    result.calls.some((call) => call.url.pathname.endsWith("signalops_v1_events")),
    false,
    "projection rebuild must never touch canonical events",
  );
}

function createSha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

console.log("signalops admin v1 checks passed");
