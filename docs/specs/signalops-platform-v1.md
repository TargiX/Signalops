# SignalOps Platform v1 Implementation SPEC

Status: Draft for implementation
Repository: `TargiX/signalops`
Target base: `main`
Depends on: [Canonical AI Telemetry Contract v1](./canonical-ai-telemetry-v1.md)
Last updated: 2026-08-23

## 1. Outcome

Turn the current synthetic SignalOps demonstration into a production-grade, multi-tenant,
read-only operations product for AI workloads. Phosphene is the first live tenant, but no
SignalOps persistence, projection, incident, or UI module may depend on Phosphene database names,
statuses, credits, or provider implementation details.

The first production outcome is:

> An authenticated Phosphene operator can open SignalOps, select `24h`, `7d`, or `30d`, and inspect
> real operation volume, attempt reliability, provider/model latency, retries, estimated or actual
> cost, and derived incidents without exposing user content or changing production routing.

## 2. Current state

The repository already contains:

- a strict v0 event validator with bounded payloads and redaction;
- protected Bearer ingest with idempotency receipts;
- an in-memory development sink;
- a public product entry and guided replay;
- a rich cockpit driven by an `OpsSnapshot` shape;
- synthetic providers, models, generations, incidents, consumers, and routing simulations.

The production sink is intentionally unavailable, and the cockpit imports `mock-data` directly.
This SPEC replaces those two limitations while preserving the public demo.

## 3. Scope

### 3.1 Included

- canonical v1 validation and ingestion;
- tenant-scoped API credentials;
- durable Postgres event storage;
- deterministic projections for operations, attempts, providers, models, timelines, costs, and
  data-quality conflicts;
- derived health and incidents;
- authenticated tenant cockpit backed by real projections;
- explicit separation between public demo and tenant data;
- compatibility path for existing v0 validator examples;
- operational readiness, migrations, contract fixtures, and deployment documentation.

### 3.2 Excluded

- automatic provider rerouting;
- storage of provider credentials;
- prompt/media inspection;
- billing invoices or payment reconciliation;
- support for non-AI infrastructure metrics;
- a general workflow engine;
- customer-configurable control actions;
- replacing Sentry, PostHog, or OpenTelemetry.

## 4. Required modules and seams

### 4.1 Telemetry ingestion module

External interface:

```ts
ingest(principal: TenantPrincipal, batch: unknown): Promise<IngestReceipt>
validate(principal: TenantPrincipal, batch: unknown): Promise<ValidationReceipt>
```

The module owns parsing, size limits, canonical validation, privacy enforcement, normalization,
idempotency comparison, and receipt construction. HTTP route handlers only translate transport
details into this interface.

Adapters:

- Postgres event-store adapter for production;
- in-memory event-store adapter for contract and module tests.

Both adapters MUST pass the same interface tests. Route handlers MUST NOT select storage based on
ad hoc environment checks inside domain logic.

### 4.2 Projection module

External interface:

```ts
project(events: readonly StoredCanonicalEvent[]): Promise<ProjectionReceipt>
rebuild(tenantId: string, range?: TimeRange): Promise<ProjectionReceipt>
```

The implementation owns out-of-order handling, terminal-state monotonicity, aggregate updates,
data-quality conflicts, and replay safety. Projectors MUST be idempotent and rebuildable from the
append-only event store.

### 4.3 Incident evaluation module

External interface:

```ts
evaluate(snapshot: HealthWindow, policy: IncidentPolicy): IncidentDecision[]
```

This module is pure computation. It returns decisions and evidence; persistence is outside its
interface. It MUST distinguish:

- provider attempt failure from overall operation failure;
- insufficient sample size from healthy;
- provider faults from client configuration, customer input, and post-processing faults;
- actual cost from estimated cost.

### 4.4 Cockpit query module

External interface:

```ts
getOpsSnapshot(principal: TenantPrincipal, range: "24h" | "7d" | "30d"): Promise<OpsSnapshotV1>
```

The implementation owns tenant scoping, query optimization, range semantics, and conversion from
projections into the UI snapshot. React components MUST NOT query event tables directly.

### 4.5 Demo data module

The existing synthetic dataset remains a real adapter behind the same cockpit query interface. The
public demo uses only this adapter. An authenticated tenant view uses only the tenant projection
adapter. No screen may blend synthetic and tenant data.

## 5. Persistence model

The exact migration syntax is an implementation choice, but the durable model MUST represent:

### 5.1 Tenancy and credentials

- `Tenant`: ID, slug, display name, status, timestamps;
- `IngestCredential`: tenant ID, hashed secret, prefix, scopes, created/last-used/revoked timestamps;
- `OperatorIdentity` or an equivalent authenticated tenant membership.

Raw API secrets are shown once and never stored. Credential comparisons are timing-safe. Initial
scopes are `events:validate` and `events:write`.

### 5.2 Append-only facts

- `TelemetryEvent`: tenant ID, canonical event ID, type, source, subject, occurred time, received
  time, schema version, canonical payload, payload digest;
- unique `(tenantId, eventId)` constraint;
- indexes for `(tenantId, occurredAt)`, `(tenantId, type, occurredAt)`, and projection scans.

Canonical facts are append-only. Corrections arrive as new events or explicit administrative
repair migrations; application code never edits an accepted event in place.

### 5.3 Projections

- `OperationProjection`;
- `AttemptProjection`;
- `ProviderWindowProjection`;
- `ModelWindowProjection`;
- `CostWindowProjection` with separate actual and estimated totals;
- `IncidentProjection`;
- `TelemetryConflict` and `ProjectionCheckpoint`.

Projection records always carry `tenantId`. Every uniqueness constraint that represents customer
identity includes `tenantId`.

## 6. Projection semantics

### 6.1 Operations

- Accepted and terminal times come from canonical lifecycle facts.
- Overall duration is terminal minus accepted unless the terminal event supplies a valid explicit
  duration.
- An operation terminal state never regresses.
- Operation failure rate uses operation terminal outcomes, not failed attempts.

### 6.2 Attempts

- Attempts are keyed by tenant, operation ID, and attempt ID.
- Retry count is derived from attempt numbers and observed distinct attempts.
- Provider/model reliability uses attempt terminal outcomes.
- A failed attempt followed by a successful attempt remains visible and contributes provider cost.

### 6.3 Cost

- `provider_reported` and `billing_reconciled` contribute to actual cost.
- `catalog_estimate` contributes to estimated cost only.
- The UI never silently sums different currencies.
- A projection with mixed currencies returns grouped totals or an explicit unavailable aggregate.
- Unknown cost remains unknown; it is not coerced to zero.

### 6.4 Provider health

Health is calculated per provider connection and optionally per model route. Initial policy:

- use a rolling 10-minute window;
- require at least 20 terminal attempts for traffic-derived health;
- below the minimum sample, return `insufficient_data` unless a probe is failing;
- exclude customer input and content-policy failures from provider failure rate;
- separate client configuration faults from provider faults;
- allow per-tenant warning and critical latency/failure thresholds;
- preserve the evaluation evidence with each incident.

Default thresholds are starter configuration, not universal truth. They MUST be stored as policy,
not hard-coded into React components.

### 6.5 Incidents

An incident has a stable fingerprint based on tenant, route scope, metric, and policy version.
Repeated evaluations update one open incident rather than creating alert storms. Incidents record:

- opened, last-observed, and resolved times;
- severity and lifecycle state;
- route scope;
- triggering evidence and sample size;
- policy version;
- affected operation and attempt counts;
- whether cost is actual, estimated, or unavailable.

Resolution requires a healthy evaluation window or an explicit operator action. v1 operator
actions affect SignalOps incident state only; they do not change customer routing.

## 7. HTTP surface

Required production routes:

- `POST /v1/events/validate`;
- `POST /v1/events`;
- `GET /v1/ops/snapshot?range=24h|7d|30d`;
- `GET /v1/incidents`;
- `GET /v1/incidents/:id`.

Requirements:

- JSON-only request and response bodies;
- `no-store` on authenticated data;
- tenant derived from authenticated principal;
- bounded query ranges and pagination;
- structured error codes with opaque request IDs;
- rate limiting by credential and tenant;
- no stack traces or storage errors in responses.

The existing `/api/events/validate` remains a public, zero-storage v0 demonstration during the v1
migration. The existing `/api/events` MUST NOT be presented as production-ready and may be removed
after v1 clients migrate.

## 8. Cockpit changes

### 8.1 Data source

Replace the direct `mock-data` import with a query adapter. Preserve current `OpsSnapshot` UI
behaviour where it is semantically valid, but introduce a versioned snapshot type that can express:

- `insufficient_data` provider health;
- actual and estimated cost separately;
- operations and attempts separately;
- data freshness and last projected event;
- incomplete or conflicting telemetry;
- tenant and environment labels.

### 8.2 Modes

- `/cockpit?mode=demo` or the public guided replay uses synthetic data and visibly says `Demo`.
- Authenticated tenant navigation uses live data and visibly identifies tenant/environment.
- Demo routing simulations remain demonstrations.
- Live mode shows recommendations as read-only and MUST NOT expose an Apply button in v1.

### 8.3 Consumer data

The current demo's consumer/account views are not part of canonical telemetry v1. Keep them demo-only
until a separate privacy-reviewed contract exists. Do not infer users from operation IDs.

## 9. Authentication and security

- Public demo and authenticated tenant routes have separate layouts and data loaders.
- API credentials are scoped, hashed, revocable, and auditable.
- Operator sessions cannot cross tenant scope.
- Every persistence adapter query receives tenant scope explicitly.
- Add automated cross-tenant isolation tests for every query interface.
- Apply CSP, CSRF protection where applicable, secure cookies, and redacted request logging.
- Never store prompts, media, emails, credentials, or raw provider messages.
- Sensitive configuration is injected by the deployment platform and never committed.

## 10. Reliability and operations

- Production ingestion is durable before returning `stored`.
- Projection can be asynchronous, but the receipt and UI expose projection freshness.
- Projection workers use checkpoints and recover safely after interruption.
- Database migration, backup, restore, and projection rebuild procedures are documented and tested.
- SignalOps monitors its own ingest availability, rejection rate, projection lag, conflicts, and
  database health.
- A broken projector does not destroy accepted events.
- Raw canonical events default to 30-day retention; hourly/daily aggregates default to 13 months.
  Retention is configurable and MUST be disclosed to tenants before onboarding.

## 11. Shared contract artifacts

Implementation MUST add:

- `schemas/ai-telemetry/v1/event.schema.json`;
- valid fixtures for every event type;
- invalid fixtures for privacy, cost, IDs, timestamps, enums, and forbidden nesting;
- a contract test runner usable by another repository without importing SignalOps implementation;
- a stable published artifact or versioned raw URL that Phosphene CI can pin.

Do not make Phosphene install the SignalOps web application package. The contract artifact is the
only shared dependency.

## 12. Delivery milestones

### S1 — Contract foundation

- check in canonical JSON Schema and fixtures;
- implement v1 normalization and validation;
- preserve v0 demo behaviour;
- pass duplicate/conflict/privacy tests with the in-memory adapter.

### S2 — Durable multi-tenant ingest

- add tenant and credential storage;
- add Postgres event store;
- implement production `/v1/events*` routes;
- pass storage parity, tenant isolation, migration, and restart tests.

### S3 — Projection and query

- build operation, attempt, provider/model, cost, and conflict projections;
- expose snapshot and incident query interfaces;
- prove deterministic rebuild from fixtures.

### S4 — Live cockpit

- introduce demo and tenant query adapters;
- render Phosphene live data without consumer PII;
- expose freshness, cost provenance, and insufficient-data states;
- retain guided replay unchanged in demo mode.

### S5 — Production readiness

- configure staging and production credentials;
- run load, replay, key rotation, backup/restore, and incident tests;
- document rollback and v0 migration;
- onboard Phosphene only after all gates pass.

## 13. Verification gates

Required before Phosphene production traffic is enabled:

1. Lint, typecheck, current contract tests, and production build pass.
2. JSON Schema fixtures pass in SignalOps and Phosphene CI.
3. Postgres and in-memory adapters pass the same ingestion interface suite.
4. Restarting the application does not lose accepted events.
5. Duplicate delivery is harmless; changed-payload reuse produces a conflict.
6. Out-of-order and contradictory terminal events produce deterministic projections.
7. Cross-tenant read/write attempts fail in automated tests.
8. Prompts, emails, media URLs, raw error messages, and secrets are absent from storage fixtures and
   logs.
9. Cockpit demo and live modes cannot mix data.
10. Projection lag and ingest failure alerts are wired and exercised.
11. A clean projection rebuild reproduces the same snapshot and incident fingerprints.
12. The live routing interface is absent or disabled; no telemetry credential can execute control.

## 14. Pull-request strategy

Keep changes independently reviewable:

1. contract/schema/fixtures;
2. durable storage and tenancy;
3. projections and incidents;
4. cockpit data-source split;
5. production configuration and runbooks.

Do not combine the provider-control plane with these PRs. Each PR must state which verification gates
it satisfies and which remain open.
