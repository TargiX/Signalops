import assert from "node:assert/strict";

import { resolveSignalOpsTenantPrincipalV1 } from "../src/lib/signalops/v1/auth.ts";
import {
  createSignalOpsOperatorSessionTokenV1,
  readSignalOpsOperatorSessionV1,
  serializeSignalOpsOperatorSessionCookieV1,
  verifySignalOpsOperatorPasswordV1,
} from "../src/lib/signalops/v1/session.ts";

process.env.SIGNALOPS_INGEST_TOKEN = "sop_live_test_abcdefghijklmnopqrstuvwxyz0123456789";
process.env.SIGNALOPS_WORKSPACE_SLUG = "tenant-auth-test";
process.env.SIGNALOPS_WORKSPACE_NAME = "Tenant Auth Test";
process.env.SIGNALOPS_COCKPIT_PASSWORD = "test-password-not-for-production";
process.env.SIGNALOPS_SESSION_SECRET = "test-session-secret-with-more-than-thirty-two-bytes";
process.env.SIGNALOPS_SESSION_TTL_SECONDS = "3600";

const principal = await resolveSignalOpsTenantPrincipalV1(
  new Request("https://signalops.test/v1/events", {
    headers: { authorization: `Bearer ${process.env.SIGNALOPS_INGEST_TOKEN}` },
  }),
);
assert.deepEqual(principal, {
  tenantId: "tenant-auth-test",
  credentialId: "bootstrap-environment-credential",
  scopes: ["events:validate", "events:write"],
});
assert.equal(
  await resolveSignalOpsTenantPrincipalV1(
    new Request("https://signalops.test/v1/events", {
      headers: { authorization: "Bearer sop_live_wrong_abcdefghijklmnopqrstuvwxyz" },
    }),
  ),
  null,
);
assert.equal(verifySignalOpsOperatorPasswordV1("test-password-not-for-production"), true);
assert.equal(verifySignalOpsOperatorPasswordV1("wrong"), false);

const token = createSignalOpsOperatorSessionTokenV1();
const serialized = serializeSignalOpsOperatorSessionCookieV1(token);
const session = readSignalOpsOperatorSessionV1(
  new Request("https://signalops.test/cockpit", {
    headers: { cookie: serialized.split(";")[0] },
  }),
);
assert.deepEqual(session && { tenantId: session.tenantId, tenantName: session.tenantName }, {
  tenantId: "tenant-auth-test",
  tenantName: "Tenant Auth Test",
});
assert.equal(
  readSignalOpsOperatorSessionV1(
    new Request("https://signalops.test/cockpit", {
      headers: { cookie: `signalops_operator_session=${token}tampered` },
    }),
  ),
  null,
);

console.log("signalops auth v1 checks passed");
