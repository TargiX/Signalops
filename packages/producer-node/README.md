# @signalops/producer-node

A framework-neutral Node.js producer SDK for SignalOps Canonical AI Telemetry V1. It records
operation and provider-attempt lifecycles without importing Next.js, Nuxt, Supabase, or any client
application code.

## Install

```bash
pnpm add @signalops/producer-node @signalops/contracts
```

Use Node.js 20 or newer. Keep the ingest credential in server-side environment configuration; never
bundle this package or its credential into a browser application.

## Record a lifecycle

```ts
import {
  createSignalOpsHttpTransportV1,
  createSignalOpsProducerV1,
} from "@signalops/producer-node";

const transport = createSignalOpsHttpTransportV1({
  endpoint: "https://signalops.cc/v1/events",
  getCredential: () => process.env.SIGNALOPS_INGEST_CREDENTIAL!,
  onDeadLetter: persistToYourOwnOutbox,
});

const signalOps = createSignalOpsProducerV1({
  source: "https://product.example/generation-worker",
  resource: {
    environment: "production",
    service: "generation-worker",
    release: process.env.APP_RELEASE!,
  },
  transport,
});

const operation = signalOps.startOperation({
  operation: {
    id: job.id,
    kind: "image_generation",
    logicalModelKey: job.modelClass,
  },
  time: job.createdAt, // stable source timestamp for replay-safe idempotency
});

const attempt = operation.startAttempt({
  attempt: { id: providerRequest.id, number: 1 },
  route: {
    providerKey: connection.key,
    providerVendor: connection.vendor,
    modelKey: job.modelClass,
    providerModelKey: providerRequest.model,
  },
  time: providerRequest.startedAt,
});

attempt.fail({
  category: "provider_timeout",
  responsibility: "provider",
  code: "upstream_timeout",
  retryable: true,
}, { time: providerRequest.finishedAt });
operation.fail({
  category: "provider_timeout",
  responsibility: "provider",
  code: "attempts_exhausted",
  retryable: false,
}, { time: job.finishedAt });

await signalOps.flush();
```

The complete runnable example is in `examples/basic.mjs`.

## Guarantees

- Stable event IDs are derived from the source, lifecycle boundary, and opaque entity ID.
- Duplicate terminal calls are idempotent; contradictory terminals are ignored and diagnosed.
- Raw errors are never accepted as canonical failure text. Only category, responsibility, code, and
  retryability survive normalization.
- Unsafe attributes are dropped before enqueue. Prompts, identities, URLs, credentials, raw errors,
  and stack fields cannot reach the transport.
- HTTP batches never exceed 100 events or 256 KiB.
- Network failures, timeouts, 408/425/429, and 5xx responses retry with bounded exponential backoff
  and jitter. Authentication and other non-retryable responses go directly to dead letter.
- Delivery errors and diagnostic callback errors do not throw into the customer operation.
- The queue is bounded. Configure `onDeadLetter` to persist failed canonical events in the client's
  durable outbox.

`flush()` is the delivery boundary for tests and graceful shutdown. `close()` drains the current
queue and rejects later events to dead letter. On serverless runtimes, call `flush()` from the host's
background-work primitive or persist canonical events to a durable outbox before returning.

## Conformance

`runSignalOpsProducerConformanceV1` executes fixed success and failure scenarios twice. It checks
canonical validation, all four lifecycle boundaries, stable IDs, route preservation, duration
evidence, normalized failure evidence, privacy canaries, and order-independent validation.

A different client adapter can implement the small `capture(scenario)` harness and run the same
suite with the validator backed by `@signalops/contracts` artifacts. Phosphene must pass this suite;
SignalOps does not import Phosphene models or provider-management code.

## Phosphene mapping boundary

| Client fact | Canonical fact |
| --- | --- |
| Generation job accepted | operation accepted |
| One provider request, retry, or fallback | one numbered attempt |
| Provider connection key | route provider key |
| Provider vendor | route vendor metadata, never connection identity |
| User-facing model class | logical model key / route model key |
| Exact upstream model | provider model key |
| Provider result | attempt terminal outcome, metrics, and cost evidence |
| Final job result | operation terminal outcome |

Do not send prompts, media, user/account IDs, provider credentials, raw errors, or stack traces.
SignalOps observes routing; it does not control it.
