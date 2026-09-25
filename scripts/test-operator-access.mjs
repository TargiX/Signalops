import assert from "node:assert/strict";

import {
  isCockpitAuthRequiredFromEnv,
  isCockpitPasswordAuthPilotReadyFromEnv,
  isCockpitSessionSecretConfiguredFromEnv,
  isOperatorAccessConfiguredFromEnv,
  isOperatorAccessPilotReadyFromEnv,
  isOperatorApiTokenConfiguredFromEnv,
} from "../src/lib/signalops/operator-access.ts";

assert.equal(
  isCockpitAuthRequiredFromEnv({
    SIGNALOPS_REQUIRE_AUTH: "true",
    SIGNALOPS_COCKPIT_PASSWORD: "your_password",
  }),
  false,
);
assert.equal(
  isCockpitAuthRequiredFromEnv({
    SIGNALOPS_REQUIRE_AUTH: "true",
    SIGNALOPS_COCKPIT_PASSWORD: "sop_cockpit_password",
  }),
  true,
);
assert.equal(
  isCockpitPasswordAuthPilotReadyFromEnv({
    SIGNALOPS_REQUIRE_AUTH: "true",
    SIGNALOPS_COCKPIT_PASSWORD: "sop_cockpit_password",
  }),
  false,
);
assert.equal(
  isCockpitSessionSecretConfiguredFromEnv({
    SIGNALOPS_SESSION_SECRET: "your_secret",
  }),
  false,
);
assert.equal(
  isCockpitPasswordAuthPilotReadyFromEnv({
    SIGNALOPS_REQUIRE_AUTH: "true",
    SIGNALOPS_COCKPIT_PASSWORD: "sop_cockpit_password",
    SIGNALOPS_SESSION_SECRET: "sop_session_secret",
  }),
  true,
);
assert.equal(
  isCockpitPasswordAuthPilotReadyFromEnv({
    SIGNALOPS_REQUIRE_AUTH: "true",
    SIGNALOPS_COCKPIT_PASSWORD: "sop_shared_secret",
    SIGNALOPS_SESSION_SECRET: "sop_session_secret",
    SIGNALOPS_INGEST_TOKEN: "sop_shared_secret",
  }),
  false,
);
assert.equal(
  isCockpitPasswordAuthPilotReadyFromEnv({
    SIGNALOPS_REQUIRE_AUTH: "true",
    SIGNALOPS_COCKPIT_PASSWORD: "sop_shared_secret",
    SIGNALOPS_SESSION_SECRET: "sop_shared_secret",
  }),
  false,
);
assert.equal(
  isOperatorApiTokenConfiguredFromEnv({
    SIGNALOPS_OPERATOR_TOKEN: "your_token",
  }),
  false,
);
assert.equal(
  isOperatorApiTokenConfiguredFromEnv({
    SIGNALOPS_OPERATOR_TOKEN: "sop_operator_token",
  }),
  true,
);
assert.equal(
  isOperatorApiTokenConfiguredFromEnv({
    SIGNALOPS_OPERATOR_TOKEN: "sop_shared_token",
    SIGNALOPS_INGEST_TOKEN: "sop_shared_token",
  }),
  false,
);
assert.equal(
  isOperatorAccessConfiguredFromEnv({
    SIGNALOPS_REQUIRE_AUTH: "true",
    SIGNALOPS_COCKPIT_PASSWORD: "placeholder",
    SIGNALOPS_OPERATOR_TOKEN: "your_token",
  }),
  false,
);
assert.equal(
  isOperatorAccessConfiguredFromEnv({
    SIGNALOPS_REQUIRE_AUTH: "true",
    SIGNALOPS_COCKPIT_PASSWORD: "placeholder",
    SIGNALOPS_OPERATOR_TOKEN: "sop_operator_token",
  }),
  true,
);
assert.equal(
  isOperatorAccessPilotReadyFromEnv({
    SIGNALOPS_REQUIRE_AUTH: "true",
    SIGNALOPS_COCKPIT_PASSWORD: "sop_cockpit_password",
    SIGNALOPS_OPERATOR_TOKEN: "",
  }),
  false,
);
assert.equal(
  isOperatorAccessPilotReadyFromEnv({
    SIGNALOPS_REQUIRE_AUTH: "true",
    SIGNALOPS_COCKPIT_PASSWORD: "sop_cockpit_password",
    SIGNALOPS_SESSION_SECRET: "sop_session_secret",
  }),
  true,
);
assert.equal(
  isOperatorAccessPilotReadyFromEnv({
    SIGNALOPS_OPERATOR_TOKEN: "sop_operator_token",
  }),
  true,
);

console.log("ok: SignalOps operator access");
