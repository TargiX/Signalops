import assert from "node:assert/strict";

import {
  createSignalOpsIngestCredentialTokenV1,
  createSignalOpsWorkspaceIdV1,
  issueSignalOpsIngestCredentialV1,
  normalizeSignalOpsCredentialNameV1,
  normalizeSignalOpsWorkspaceNameV1,
  provisionSignalOpsWorkspaceV1,
  rotateSignalOpsIngestCredentialV1,
  signalOpsCredentialExpiryV1,
} from "../src/lib/signalops/v1/workspace-provisioning.ts";
import { buildSignalOpsRawHttpQuickstartV1 } from "../src/lib/signalops/v1/quickstart.ts";

assert.equal(normalizeSignalOpsWorkspaceNameV1("  Acme   Generation  "), "Acme Generation");
assert.equal(normalizeSignalOpsCredentialNameV1(" Production   worker "), "Production worker");
assert.throws(() => normalizeSignalOpsWorkspaceNameV1("x"), /2-120/);
assert.throws(() => normalizeSignalOpsCredentialNameV1("bad\nname"), /control/);
assert.equal(
  createSignalOpsWorkspaceIdV1("Crème Génération", Buffer.from("0102030405", "hex")),
  "creme-generation-0102030405",
);
assert.equal(
  createSignalOpsWorkspaceIdV1("生成", Buffer.alloc(5, 7)),
  "workspace-0707070707",
);
const fixedCredentialBytes = Buffer.alloc(32, 11);
const token = createSignalOpsIngestCredentialTokenV1(() => fixedCredentialBytes);
assert.match(token, /^sop_live_[A-Za-z0-9_-]{43}$/);
assert.equal(
  signalOpsCredentialExpiryV1(90, new Date("2026-08-24T00:00:00.000Z")),
  "2026-11-22T00:00:00.000Z",
);
assert.throws(() => signalOpsCredentialExpiryV1(366), /1-365/);

const quickstart = buildSignalOpsRawHttpQuickstartV1({
  endpoint: "https://signalops.cc/v1/events",
  service: "generation-worker",
});
assert.match(quickstart, /SIGNALOPS_INGEST_CREDENTIAL/);
assert.match(quickstart, /com\.signalops\.ai\.attempt\.terminal\.v1/);
assert.match(quickstart, /provider_reported/);
assert.doesNotMatch(quickstart, /sop_live_/);
assert.throws(
  () => buildSignalOpsRawHttpQuickstartV1({ endpoint: "https://user:secret@signalops.cc/v1/events" }),
  /must not contain credentials/,
);

const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, init) => {
  const body = init?.body ? JSON.parse(init.body) : null;
  calls.push({ url: String(url), init, body });
  if (String(url).endsWith("/rpc/signalops_v1_provision_workspace")) {
    return Response.json([
      {
        tenant_id: body.p_tenant_id,
        tenant_name: body.p_tenant_name,
        role: "owner",
        created: true,
      },
    ]);
  }
  if (String(url).endsWith("/rpc/signalops_v1_create_ingest_credential")) {
    return Response.json([
      {
        id: "11111111-1111-4111-8111-111111111111",
        tenant_id: body.p_tenant_id,
        name: body.p_name,
        token_prefix: body.p_token_prefix,
        scopes: body.p_scopes,
        created_at: "2026-08-24T00:00:00.000Z",
        expires_at: body.p_expires_at,
        rotated_from_id: body.p_rotated_from_id,
        revoked_at: null,
      },
    ]);
  }
  if (String(url).endsWith("/rpc/signalops_v1_rotate_ingest_credential")) {
    return Response.json([
      {
        id: "22222222-2222-4222-8222-222222222222",
        tenant_id: body.p_tenant_id,
        name: body.p_name,
        token_prefix: body.p_token_prefix,
        scopes: body.p_scopes,
        created_at: "2026-08-24T00:05:00.000Z",
        expires_at: body.p_expires_at,
        rotated_from_id: body.p_source_credential_id,
        revoked_at: null,
      },
    ]);
  }
  throw new Error(`unexpected test request ${url}`);
};

try {
  const config = { url: "https://signalops.test", secretKey: "sb_secret_test" };
  const workspace = await provisionSignalOpsWorkspaceV1({
    subject: "70ea64ef-445a-45b4-b12b-c67bc7d758fd",
    workspaceName: "Acme Generation",
    requestId: "req_12345678",
    entropy: Buffer.from("0102030405", "hex"),
    config,
  });
  assert.deepEqual(workspace, {
    tenantId: "acme-generation-0102030405",
    tenantName: "Acme Generation",
    role: "owner",
    created: true,
  });

  const issued = await issueSignalOpsIngestCredentialV1({
    tenantId: workspace.tenantId,
    subject: "70ea64ef-445a-45b4-b12b-c67bc7d758fd",
    name: "Production worker",
    expiresInDays: 90,
    requestId: "req_abcdefgh",
    now: new Date("2026-08-24T00:00:00.000Z"),
    randomBytes: () => fixedCredentialBytes,
    config,
  });
  assert.equal(issued.token, token);
  assert.equal(issued.credential.tokenPrefix, token.slice(0, 16));
  assert.equal(calls[1].body.p_token_hash.length, 64);
  assert.equal(calls[1].body.p_expires_at, "2026-11-22T00:00:00.000Z");
  assert.equal(calls[1].body.p_subject, "70ea64ef-445a-45b4-b12b-c67bc7d758fd");

  const rotated = await rotateSignalOpsIngestCredentialV1({
    tenantId: workspace.tenantId,
    subject: "70ea64ef-445a-45b4-b12b-c67bc7d758fd",
    credentialId: issued.credential.id,
    name: "Production worker · rotated",
    expiresInDays: 30,
    requestId: "req_rotation1",
    now: new Date("2026-08-24T00:00:00.000Z"),
    randomBytes: () => Buffer.alloc(32, 12),
    config,
  });
  assert.equal(rotated.credential.rotatedFromId, issued.credential.id);
  assert.equal(calls[2].body.p_source_credential_id, issued.credential.id);
  assert.equal(calls[2].body.p_expires_at, "2026-09-23T00:00:00.000Z");
  assert.ok(!JSON.stringify(calls).includes("@"), "self-serve persistence must not include email");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("signalops self-serve v1 checks passed");
