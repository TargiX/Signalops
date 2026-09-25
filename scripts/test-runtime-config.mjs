import assert from "node:assert/strict";

import {
  firstConfiguredSecret,
  hasConfiguredSecret,
  isConfiguredDeliveryUrl,
  isConfiguredHttpUrl,
  isConfiguredPublicBaseUrl,
  isPlaceholderValue,
  missingConfiguredEnv,
} from "../src/lib/signalops/runtime-config.ts";

assert.equal(isPlaceholderValue(undefined), true);
assert.equal(isPlaceholderValue(""), true);
assert.equal(isPlaceholderValue("https://your_project.supabase.co"), true);
assert.equal(isPlaceholderValue("your_database_id"), true);
assert.equal(isPlaceholderValue("your_account_id"), true);
assert.equal(isPlaceholderValue("your_token"), true);
assert.equal(isPlaceholderValue("your_password"), true);
assert.equal(isPlaceholderValue("your_secret"), true);
assert.equal(isPlaceholderValue("placeholder"), true);
assert.equal(isPlaceholderValue("acct_live_123"), false);
assert.equal(isPlaceholderValue("https://signalops.example.net"), false);

assert.equal(isConfiguredHttpUrl("https://signalops.example.net/hook"), true);
assert.equal(isConfiguredHttpUrl("ftp://signalops.example.net/hook"), false);
assert.equal(isConfiguredHttpUrl("https://your_project.example.com/hook"), false);
assert.equal(isConfiguredDeliveryUrl("http://127.0.0.1:3000/hook", { NODE_ENV: "development", VERCEL: "" }), true);
assert.equal(isConfiguredDeliveryUrl("http://127.0.0.1:3000/hook", { NODE_ENV: "production", VERCEL: "" }), false);
assert.equal(isConfiguredDeliveryUrl("http://127.0.0.1:3000/hook", { NODE_ENV: "development", VERCEL: "1" }), false);
assert.equal(isConfiguredDeliveryUrl("https://ops.signalops.test/hook", { NODE_ENV: "production", VERCEL: "" }), true);
assert.equal(isConfiguredDeliveryUrl("ftp://ops.signalops.test/hook", { NODE_ENV: "development", VERCEL: "" }), false);
assert.equal(isConfiguredPublicBaseUrl("https://signalops.cc"), true);
assert.equal(isConfiguredPublicBaseUrl("http://signalops.cc"), false);
assert.equal(isConfiguredPublicBaseUrl("https://your_project.example.com"), false);
assert.equal(isConfiguredPublicBaseUrl("https://localhost:3020"), false);

assert.equal(hasConfiguredSecret("sop_live_secret"), true);
assert.equal(hasConfiguredSecret("your_token"), false);
assert.equal(firstConfiguredSecret("your_key", "re_live_123"), "re_live_123");
assert.equal(firstConfiguredSecret("", "placeholder", undefined), undefined);

const originalEnv = {
  SIGNALOPS_TEST_PRESENT: process.env.SIGNALOPS_TEST_PRESENT,
  SIGNALOPS_TEST_PLACEHOLDER: process.env.SIGNALOPS_TEST_PLACEHOLDER,
  SIGNALOPS_TEST_MISSING: process.env.SIGNALOPS_TEST_MISSING,
};

try {
  process.env.SIGNALOPS_TEST_PRESENT = "configured_value";
  process.env.SIGNALOPS_TEST_PLACEHOLDER = "your_database_id";
  delete process.env.SIGNALOPS_TEST_MISSING;
  assert.deepEqual(
    missingConfiguredEnv([
      "SIGNALOPS_TEST_PRESENT",
      "SIGNALOPS_TEST_PLACEHOLDER",
      "SIGNALOPS_TEST_MISSING",
    ]),
    ["SIGNALOPS_TEST_PLACEHOLDER", "SIGNALOPS_TEST_MISSING"],
  );
} finally {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

console.log("ok: SignalOps runtime config");
