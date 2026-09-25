#!/usr/bin/env node

import assert from "node:assert/strict";

const baseUrl = process.env.SIGNALOPS_BASE_URL || "https://signalops.cc";
const token = process.env.SIGNALOPS_INGEST_TOKEN;
const allowStorageGate = process.argv.includes("--allow-storage-gate");

function sampleEvent(generationId) {
  return {
    type: "generation.completed",
    generationId,
    providerId: "fal",
    modelId: "flux-2-pro",
    status: "succeeded",
    source: "source-smoke",
    durationMs: 12400,
    cost: 0.041,
    retryCount: 0,
  };
}

async function post(path, body, authorizationToken) {
  const response = await fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorizationToken ? { authorization: `Bearer ${authorizationToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  return { response, payload };
}

const generationId = `gen_source_smoke_${Date.now()}`;
const event = sampleEvent(generationId);

const validation = await post("/api/events/validate", event);
assert.equal(validation.response.status, 200, "public validation must accept the source smoke event");
assert.equal(validation.payload.ok, true, "validation response must be ok");
assert.equal(validation.payload.verificationOnly, true, "validation must be verification-only");
assert.equal(validation.payload.storedEvents, 0, "validation must store zero events");
assert.ok(validation.payload.diagnostics, "validation must return diagnostics");
assert.equal(validation.payload.diagnostics.coverage.latency, true, "validation diagnostics must detect latency coverage");
assert.equal(validation.payload.diagnostics.coverage.cost, true, "validation diagnostics must detect cost coverage");

const unauthenticated = await post("/api/events", event);
assert.equal(unauthenticated.response.status, 401, "unauthenticated ingest must be rejected");
assert.equal(unauthenticated.payload.code, "unauthorized", "unauthenticated ingest must return unauthorized");

let authenticated = null;
if (token) {
  authenticated = await post("/api/events", event, token);

  const setupGateCodes = new Set(["ingest_storage_not_configured", "workspace_not_configured"]);
  if (authenticated.response.status === 503 && setupGateCodes.has(authenticated.payload.code)) {
    if (!allowStorageGate) {
      throw new Error(
        `authenticated ingest passed auth but is blocked by ${authenticated.payload.code}; rerun with --allow-storage-gate during pre-cutover checks`,
      );
    }
  } else {
    assert.equal(authenticated.response.status, 200, "authenticated ingest must store events once durable storage is ready");
    assert.equal(authenticated.payload.ok, true, "authenticated ingest response must be ok");
    assert.ok(authenticated.payload.storedEvents >= 1, "authenticated ingest must store at least one event");
    assert.ok(authenticated.payload.diagnostics, "authenticated ingest must return diagnostics");
    assert.equal(
      authenticated.payload.receipt?.proof?.demoDataIncluded,
      false,
      "authenticated ingest must return a source-only receipt",
    );
    if (authenticated.payload.receipt?.storage?.durable === true) {
      assert.equal(
        authenticated.payload.receipt?.proof?.durableWrite,
        true,
        "durable authenticated ingest must return durableWrite proof",
      );
    } else {
      assert.equal(
        authenticated.payload.receipt?.proof?.durableWrite,
        false,
        "non-durable authenticated ingest must not claim durableWrite proof",
      );
    }
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      baseUrl,
      generationId,
      validation: {
        status: validation.response.status,
        storedEvents: validation.payload.storedEvents,
        readiness: validation.payload.diagnostics?.readiness,
        requestId: validation.payload.requestId,
      },
      unauthenticatedIngest: {
        status: unauthenticated.response.status,
        code: unauthenticated.payload.code,
      },
      authenticatedIngest: authenticated
        ? {
            status: authenticated.response.status,
            code: authenticated.payload.code,
            storedEvents: authenticated.payload.storedEvents ?? 0,
            receipt: authenticated.payload.receipt ?? null,
            storage: authenticated.payload.storage?.adapter,
          }
        : {
            skipped: true,
            reason: "SIGNALOPS_INGEST_TOKEN is not set in the runner environment",
          },
    },
    null,
    2,
  ),
);
