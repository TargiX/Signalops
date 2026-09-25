import assert from "node:assert/strict";

import {
  isProductionRuntime,
  isSourceIngestAuthorized,
  isSourceIngestTokenConfigured,
  sourceIngestAllowsEphemeralStorage,
  sourceIngestAllowsUnauthenticated,
} from "../src/lib/signalops/ingest-auth.ts";

function headers(token) {
  return new Headers(token ? { authorization: `Bearer ${token}` } : {});
}

const localNoToken = {
  NODE_ENV: "development",
  VERCEL: "",
  SIGNALOPS_INGEST_TOKEN: "",
};
assert.equal(isProductionRuntime(localNoToken), false);
assert.equal(isSourceIngestTokenConfigured(localNoToken), false);
assert.equal(sourceIngestAllowsUnauthenticated(localNoToken), true);
assert.equal(sourceIngestAllowsEphemeralStorage(localNoToken), true);
assert.equal(isSourceIngestAuthorized(headers(), localNoToken), true);

const localProtected = {
  NODE_ENV: "development",
  VERCEL: "",
  SIGNALOPS_INGEST_TOKEN: "sop_local_ingest",
};
assert.equal(isSourceIngestTokenConfigured(localProtected), true);
assert.equal(sourceIngestAllowsUnauthenticated(localProtected), false);
assert.equal(sourceIngestAllowsEphemeralStorage(localProtected), true);
assert.equal(isSourceIngestAuthorized(headers(), localProtected), false);
assert.equal(isSourceIngestAuthorized(headers("wrong"), localProtected), false);
assert.equal(isSourceIngestAuthorized(headers("sop_local_ingest"), localProtected), true);

const productionNoToken = {
  NODE_ENV: "production",
  VERCEL: "",
  SIGNALOPS_INGEST_TOKEN: "",
};
assert.equal(isProductionRuntime(productionNoToken), true);
assert.equal(sourceIngestAllowsUnauthenticated(productionNoToken), false);
assert.equal(sourceIngestAllowsEphemeralStorage(productionNoToken), false);
assert.equal(isSourceIngestAuthorized(headers(), productionNoToken), false);

const vercelNoToken = {
  NODE_ENV: "development",
  VERCEL: "1",
  SIGNALOPS_INGEST_TOKEN: "",
};
assert.equal(isProductionRuntime(vercelNoToken), true);
assert.equal(sourceIngestAllowsUnauthenticated(vercelNoToken), false);
assert.equal(sourceIngestAllowsEphemeralStorage(vercelNoToken), false);
assert.equal(isSourceIngestAuthorized(headers(), vercelNoToken), false);

const productionPlaceholderToken = {
  NODE_ENV: "production",
  VERCEL: "1",
  SIGNALOPS_INGEST_TOKEN: "your_token",
};
assert.equal(isSourceIngestTokenConfigured(productionPlaceholderToken), false);
assert.equal(isSourceIngestAuthorized(headers("your_token"), productionPlaceholderToken), false);

const productionProtected = {
  NODE_ENV: "production",
  VERCEL: "",
  SIGNALOPS_INGEST_TOKEN: "sop_prod_ingest",
};
assert.equal(isSourceIngestTokenConfigured(productionProtected), true);
assert.equal(isSourceIngestAuthorized(headers("sop_prod_ingest"), productionProtected), true);
assert.equal(isSourceIngestAuthorized(new Headers({ authorization: "Token sop_prod_ingest" }), productionProtected), false);

const localEphemeralDisabled = {
  NODE_ENV: "development",
  VERCEL: "",
  SIGNALOPS_ALLOW_EPHEMERAL_INGEST: "false",
};
assert.equal(sourceIngestAllowsEphemeralStorage(localEphemeralDisabled), false);

const productionEphemeralRequested = {
  NODE_ENV: "production",
  VERCEL: "",
  SIGNALOPS_ALLOW_EPHEMERAL_INGEST: "true",
};
assert.equal(sourceIngestAllowsEphemeralStorage(productionEphemeralRequested), false);

console.log("ok: SignalOps ingest auth");
