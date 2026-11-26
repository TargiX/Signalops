import assert from "node:assert/strict";

import {
  authorizeSignalOpsOperatorSessionV1,
  listAuthorizedSignalOpsMembershipsV1,
} from "../src/lib/signalops/v1/operator-session.ts";
import {
  createSignalOpsOperatorSessionTokenV1,
  signalOpsCockpitSessionCookieV1,
} from "../src/lib/signalops/v1/session.ts";

const ENV_KEYS = [
  "NODE_ENV",
  "SIGNALOPS_COCKPIT_PASSWORD",
  "SIGNALOPS_SESSION_SECRET",
  "SIGNALOPS_WORKSPACE_SLUG",
  "SIGNALOPS_WORKSPACE_NAME",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
];

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

async function withEnv(overrides, run) {
  for (const key of ENV_KEYS) {
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }
  try {
    await run();
  } finally {
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function requestWithSessionCookie(token) {
  return new Request("https://signalops.test/api/cockpit/session", {
    headers: { cookie: `${signalOpsCockpitSessionCookieV1}=${encodeURIComponent(token)}` },
  });
}

const passwordEnv = {
  NODE_ENV: "test",
  SIGNALOPS_COCKPIT_PASSWORD: "test-cockpit-password",
  SIGNALOPS_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  SIGNALOPS_WORKSPACE_SLUG: "acme",
  SIGNALOPS_WORKSPACE_NAME: "Acme Workspace",
};

await withEnv(passwordEnv, async () => {
  // A request with no session cookie authorizes nobody.
  assert.equal(await authorizeSignalOpsOperatorSessionV1(new Request("https://signalops.test/")), null);

  // A garbage or unsigned token authorizes nobody.
  assert.equal(
    await authorizeSignalOpsOperatorSessionV1(requestWithSessionCookie("not-a-token")),
    null,
  );

  // A valid password-mode session authorizes through the password gate.
  const token = createSignalOpsOperatorSessionTokenV1();
  const session = await authorizeSignalOpsOperatorSessionV1(requestWithSessionCookie(token));
  assert.ok(session, "password-mode session must authorize when password auth is configured");
  assert.equal(session.tenantId, "acme");
  assert.equal(session.tenantName, "Acme Workspace");
  assert.equal(session.role, "owner");
  assert.equal(session.authMode, "password");

  // Password-mode operators see exactly one membership: the configured workspace as owner.
  assert.deepEqual(await listAuthorizedSignalOpsMembershipsV1(session), [
    { tenantId: "acme", tenantName: "Acme Workspace", role: "owner" },
  ]);
});

await withEnv({ ...passwordEnv, SIGNALOPS_COCKPIT_PASSWORD: undefined }, async () => {
  // A password-mode session must NOT authorize when password auth is not configured.
  const token = createSignalOpsOperatorSessionTokenV1();
  assert.equal(await authorizeSignalOpsOperatorSessionV1(requestWithSessionCookie(token)), null);
});

await withEnv({ ...passwordEnv, SIGNALOPS_SESSION_SECRET: undefined }, async () => {
  // A session signed without a secret cannot be created or verified: the cookie gate stays shut.
  assert.throws(() => createSignalOpsOperatorSessionTokenV1(), /SIGNALOPS_SESSION_SECRET/);
});

await withEnv({ ...passwordEnv, SUPABASE_URL: undefined }, async () => {
  // A supabase-mode session must NOT authorize when Supabase auth is not configured,
  // and the rejection must happen before any Supabase user lookup.
  const supabaseToken = createSignalOpsOperatorSessionTokenV1({
    tenantId: "acme",
    tenantName: "Acme Workspace",
    subject: "user-123",
    role: "operator",
    authMode: "supabase",
  });
  assert.equal(
    await authorizeSignalOpsOperatorSessionV1(requestWithSessionCookie(supabaseToken)),
    null,
  );
});

console.log("ok: SignalOps operator session authorization");
