# SignalOps Canonical AI Telemetry Contract v1

Status: Draft for implementation
Contract owner: SignalOps
Initial reference integration: Phosphene
Last updated: 2026-08-23

## 1. Purpose

This document defines the vendor-neutral telemetry interface between an AI product and SignalOps.
It is the normative source for event meaning, identity, privacy, delivery, versioning, and
compatibility. Client implementations may use any database, queue, provider SDK, or job model as
long as the events crossing this seam conform to this contract.

Phosphene is the first production integration, not the domain model for this contract. Names such
as `GenerationJob`, Phosphene credits, Prisma statuses, and Phosphene provider aliases MUST NOT
appear as required canonical fields.

## 2. Design principles

1. **Operation and attempt are distinct.** An operation is the customer-visible AI task. An
   attempt is one invocation of one provider route. One operation may have zero, one, or many
   attempts.
2. **Provider identity and connection identity are distinct.** `providerVendor` identifies a
   vendor such as `fal` or `openai`. `providerKey` identifies the client's configured connection,
   such as `primary-fal-us`.
3. **Requested and executed models are distinct.** The operation may name a logical model or
   capability. Each attempt records the provider/model route actually executed.
4. **Health is derived from observations.** Attempt outcomes and optional provider probes are
   facts. `healthy`, `degraded`, and `incident` are SignalOps projections, not trusted client
   assertions.
5. **Cost provenance is mandatory.** A cost without currency and source is not comparable and MUST
   NOT be accepted.
6. **Delivery is at least once.** Producers use stable event IDs. SignalOps provides idempotent
   ingestion.
7. **Telemetry never controls routing implicitly.** Observation and control are separate seams.
8. **Private content is excluded by default.** Prompts, media, email addresses, raw provider
   payloads, credentials, and unrestricted error messages do not belong in this contract.

## 3. Domain terms

### 3.1 Operation

A customer-visible AI task with a stable ID and one terminal outcome. Examples include image
generation, video generation, text generation, embedding, transcription, or model training.

### 3.2 Attempt

A single execution against a concrete provider connection and provider model. Retries create new
attempts with increasing `number`; they do not rewrite a prior attempt.

### 3.3 Route

The concrete execution destination for an attempt: client connection, normalized vendor, and
executed model. Routing policy remains inside the client unless an optional control adapter is
installed later.

### 3.4 Provider connection

A client's configured relationship with a provider. Multiple connections may share a vendor but
use different accounts, regions, quotas, or credentials. Credentials are never sent to SignalOps.

### 3.5 Probe

An optional active observation of a provider connection independent of a customer operation, such
as a health check or synthetic request. Probes supplement but do not override real attempt data.

## 4. Transport envelope

Events use a CloudEvents-style JSON envelope. SignalOps does not claim full CloudEvents transport
conformance in v1, but it preserves the familiar field meanings so a later CloudEvents adapter does
not require a semantic migration.

```ts
type SignalOpsEventV1 = {
  specversion: "1.0"
  id: string
  source: string
  type:
    | "com.signalops.ai.operation.accepted.v1"
    | "com.signalops.ai.operation.terminal.v1"
    | "com.signalops.ai.attempt.started.v1"
    | "com.signalops.ai.attempt.terminal.v1"
    | "com.signalops.ai.provider.probe.v1"
  subject: string
  time: string
  datacontenttype: "application/json"
  dataschema: "https://signalops.cc/schemas/ai-telemetry/v1"
  traceparent?: string
  data:
    | OperationAcceptedDataV1
    | OperationTerminalDataV1
    | AttemptStartedDataV1
    | AttemptTerminalDataV1
    | ProviderProbeEventDataV1
}
```

Envelope invariants:

- `id` MUST be stable across retries of delivery and unique within a SignalOps tenant.
- `source` MUST be a stable URI identifying the producer, not a hostname generated per process.
  Userinfo, query parameters, and fragments are forbidden so credentials cannot be embedded in it.
- `subject` MUST be `operation/<operationId>` for operation and attempt events, or
  `provider/<providerKey>` for probes.
- `time` MUST be UTC ISO-8601 with milliseconds.
- `traceparent`, when present, MUST follow W3C Trace Context syntax.
- The authenticated API key determines the tenant. Payloads MUST NOT contain or override a tenant
  ID.
- Unknown top-level fields are rejected. Product-specific values belong in bounded `attributes`.

## 5. Shared value objects

```ts
type OperationKind =
  | "image_generation"
  | "video_generation"
  | "text_generation"
  | "embedding"
  | "transcription"
  | "training"
  | "other"

type TerminalStatus = "succeeded" | "failed" | "cancelled" | "expired" | "abandoned"

type FailureCategory =
  | "provider_capacity"
  | "provider_rate_limit"
  | "provider_auth"
  | "provider_rejected"
  | "provider_timeout"
  | "provider_error"
  | "content_policy"
  | "invalid_input"
  | "customer_cancelled"
  | "client_configuration"
  | "application_error"
  | "postprocessing_error"
  | "storage_error"
  | "unknown"

type FailureResponsibility = "provider" | "customer" | "client" | "platform" | "unknown"

type CostSource = "provider_reported" | "catalog_estimate" | "billing_reconciled"

type Cost = {
  amount: string
  currency: string
  source: CostSource
}

type Resource = {
  environment: string
  service: string
  release?: string
  region?: string
}

type OperationIdentity = {
  id: string
  kind: OperationKind
  logicalModelKey?: string
}

type AttemptIdentity = {
  id: string
  number: number
}

type Route = {
  providerKey: string
  providerVendor?: string
  modelKey: string
  providerModelKey?: string
  region?: string
}

type Failure = {
  category: FailureCategory
  responsibility: FailureResponsibility
  code?: string
  retryable?: boolean
}
```

Value invariants:

- IDs and keys are opaque, non-empty strings. SignalOps MUST NOT parse business meaning from them.
- `AttemptIdentity.number` is a positive integer and increases within an operation.
- `Cost.amount` is a nonnegative base-10 decimal string, never a floating-point JSON number.
- `Cost.currency` is an uppercase ISO-4217 code such as `USD`.
- `failure.code` is a bounded machine-readable code. It MUST NOT contain a raw provider message.
- `attributes` keys and values are bounded primitives. Nested arbitrary JSON is rejected.

## 6. Event data

### 6.1 Operation accepted

Emitted once when the client has durably accepted responsibility for an operation. Acceptance does
not mean that a provider attempt has started.

```ts
type OperationAcceptedDataV1 = {
  operation: OperationIdentity
  resource: Resource
  attributes?: Record<string, string | number | boolean>
}
```

### 6.2 Operation terminal

Emitted once when the customer-visible operation becomes terminal.

```ts
type OperationTerminalDataV1 = {
  operation: OperationIdentity
  outcome: {
    status: TerminalStatus
    failure?: Failure
  }
  metrics?: {
    totalDurationMs?: number
    attemptCount?: number
  }
  resource: Resource
  attributes?: Record<string, string | number | boolean>
}
```

`failure` is required for `failed`, `expired`, or `abandoned`; it is forbidden for `succeeded`.

### 6.3 Attempt started

Emitted when an invocation is about to cross the provider seam. Creating a local queue record alone
does not constitute an attempt.

```ts
type AttemptStartedDataV1 = {
  operation: OperationIdentity
  attempt: AttemptIdentity
  route: Route
  resource: Resource
  attributes?: Record<string, string | number | boolean>
}
```

### 6.4 Attempt terminal

Emitted once when that provider attempt reaches a terminal state.

```ts
type AttemptTerminalDataV1 = {
  operation: OperationIdentity
  attempt: AttemptIdentity
  route: Route
  outcome: {
    status: TerminalStatus
    failure?: Failure
  }
  metrics?: {
    durationMs?: number
    queueDurationMs?: number
    outputUnits?: number
  }
  cost?: Cost
  resource: Resource
  attributes?: Record<string, string | number | boolean>
}
```

An attempt can fail while its operation later succeeds through a subsequent attempt. SignalOps MUST
calculate operation success and provider-attempt reliability separately.

### 6.5 Provider probe

```ts
type ProviderProbeEventDataV1 = {
  route: Omit<Route, "modelKey"> & { modelKey?: string }
  outcome: {
    status: "succeeded" | "failed"
    failure?: Failure
  }
  metrics?: {
    durationMs?: number
  }
  resource: Resource
  attributes?: Record<string, string | number | boolean>
}
```

SignalOps derives health from windows of attempts and probes. A producer cannot directly set the
projected health state.

## 7. Canonical example

```json
{
  "specversion": "1.0",
  "id": "evt_job_123_attempt_2_terminal",
  "source": "urn:phosphene:production:generation-worker",
  "type": "com.signalops.ai.attempt.terminal.v1",
  "subject": "operation/job_123",
  "time": "2026-08-23T04:30:12.345Z",
  "datacontenttype": "application/json",
  "dataschema": "https://signalops.cc/schemas/ai-telemetry/v1",
  "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  "data": {
    "operation": {
      "id": "job_123",
      "kind": "image_generation",
      "logicalModelKey": "image.fast"
    },
    "attempt": {
      "id": "attempt_456",
      "number": 2
    },
    "route": {
      "providerKey": "primary-fal",
      "providerVendor": "fal",
      "modelKey": "flux-2-pro",
      "providerModelKey": "fal-ai/flux-2-pro",
      "region": "iad"
    },
    "outcome": {
      "status": "succeeded"
    },
    "metrics": {
      "durationMs": 18340,
      "outputUnits": 1
    },
    "cost": {
      "amount": "0.053",
      "currency": "USD",
      "source": "catalog_estimate"
    },
    "resource": {
      "environment": "production",
      "service": "generation-worker",
      "release": "de4918457d6009cfe90a10222439881af8be8e14",
      "region": "hetzner"
    },
    "attributes": {
      "mediaType": "image",
      "source": "canvas",
      "usageMode": "clean"
    }
  }
}
```

## 8. Privacy and cardinality

The following values are forbidden in v1:

- prompts or prompt fragments;
- generated or reference media and URLs;
- names, emails, IP addresses, or raw customer IDs;
- API keys, tokens, credential names, or authorization headers;
- raw provider requests/responses;
- stack traces or unrestricted exception messages;
- payment or credit-ledger records.

Operation IDs, attempt IDs, provider keys, and model keys MUST be non-personal opaque identifiers.
If a client's native ID contains personal data, its adapter MUST hash or replace it before emission.

Initial limits:

- request body: 256 KiB;
- events per batch: 100;
- event ID: 160 characters;
- other identifier/key fields: 120 characters;
- `failure.code`: 120 characters;
- attributes: at most 20 entries;
- attribute key: 64 characters;
- string attribute value: 240 characters.

## 9. Ingestion and idempotency

Production endpoints:

- `POST /v1/events/validate`: authentication required, validates but stores nothing;
- `POST /v1/events`: authentication required, validates and durably stores accepted events.

The public demo validator may remain available for synthetic examples but MUST NOT accept a tenant
credential or imply that events were retained.

Storage identity is `(tenantId, event.id)`. Repeating an identical event is a successful duplicate.
Reusing the same ID for a different canonical payload is an idempotency conflict. SignalOps records
`receivedAt` itself and excludes it from payload comparison.

The ingest receipt reports accepted, stored, duplicate, rejected, and conflicted counts plus opaque
event references. It never echoes tenant credentials or sensitive payload values.

Producers SHOULD batch events, retry timeouts, `429`, and `5xx` with bounded exponential backoff and
jitter, and retain a dead-letter record after the retry budget is exhausted. A telemetry failure
MUST NOT turn a successful customer operation into a failure.

## 10. Ordering and late arrival

- SignalOps MUST tolerate events arriving out of order.
- Projectors order lifecycle facts by event `time` and use `receivedAt` as a deterministic tiebreaker.
- An operation or attempt projection MUST NOT regress from terminal to active because of a late
  event.
- A contradictory second terminal event is retained as evidence and marks the projection as a data
  quality conflict; it does not silently overwrite the first terminal fact.
- Backfilled events set their original `time`; an attribute such as `backfill=true` may identify the
  import path.

## 11. Versioning and compatibility

- The event type suffix and `dataschema` version are normative.
- V1 is closed-world. Adding, removing, or renaming any field changes the accepted instance set and
  requires v2.
- Changing a field's meaning, an accepted enum, or money/status semantics also requires v2.
- SignalOps MUST retain v1 ingestion for at least one documented migration window after v2 ships.
- Client adapters MUST pin a contract version and pass shared fixtures before release.
- The existing prototype event shapes are v0. SignalOps may provide a v0-to-v1 compatibility
  adapter, but no new client should emit v0.

## 12. Control-plane exclusion

This contract carries observations only. Routing recommendations, approvals, policy changes, and
execution receipts require a separate versioned control interface. Possession of a telemetry API
key never grants control authority.

## 13. Contract acceptance criteria

The contract is implementation-ready when:

1. A checked-in JSON Schema represents this document without weakening its invariants.
2. Valid and invalid shared fixtures run in SignalOps CI and the Phosphene adapter CI.
3. An in-memory ingest adapter and the production Postgres adapter pass the same interface tests.
4. Duplicate, conflict, partial batch, late-arrival, and contradictory-terminal cases are covered.
5. A PII fixture proves forbidden content is rejected or removed before durable storage.
6. The canonical example above validates byte-for-byte after timestamp-independent normalization.
