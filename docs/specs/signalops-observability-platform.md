# SignalOps universal observability platform

Status: approved for incremental implementation and Phosphene dogfooding
Date: 2026-08-23
Contract boundary: Canonical AI Telemetry V1

## Product outcome

SignalOps must let an operator answer, from real production evidence:

1. Are customer-visible AI operations succeeding, and how fast are they?
2. Which concrete provider route and attempt caused a failure or latency spike?
3. Is the answer trustworthy, or is producer instrumentation incomplete?
4. What did the execution cost, and what is the provenance of that amount?
5. Which policy is currently violated, who was alerted, and has the condition recovered?

Phosphene is the first producer, not a special product mode. All producer-specific translation stays behind the producer adapter and the same conformance suite must be usable by future clients.

## Product boundaries

SignalOps owns observations, validation, tenant isolation, projections, investigation, incidents, and alert delivery. Source applications own operation execution, provider credentials, prompt and media data, routing decisions, and any automatic remediation.

SignalOps V1 remains observation-only. Control-plane actions such as rerouting or pausing a provider require a separate contract and authorization model.

The platform never requires prompts, media URLs, email addresses, source user identifiers, provider credentials, raw error messages, or stack traces.

## Architecture

### Producer edge

A version-pinned producer adapter exposes operation and attempt lifecycle recording through a small interface. It owns canonical envelopes, stable event identifiers, safe failure normalization, retry-safe delivery, bounded buffering, and a dead-letter callback. Telemetry delivery failure must never fail the customer operation.

An executable conformance kit validates any adapter against shared lifecycle, retry, privacy, idempotency, and out-of-order fixtures. Phosphene must pass this kit without SignalOps importing Phosphene code.

### Observation plane

Canonical events remain immutable and tenant scoped. The event reader exposes a subject-indexed seam so an operation trace does not require rebuilding or downloading the tenant's complete history.

### Projection plane

Projections report both business outcomes and evidence quality. Coverage metrics have explicit numerators and denominators; unavailable evidence is shown as unavailable, never as zero. Currency and cost provenance remain separate.

### Investigation plane

Every visible operation can open a tenant-safe trace containing lifecycle boundaries, ordered attempts, routes, normalized outcomes, duration, cost evidence, and integrity diagnostics. Attributes and raw source payloads are excluded from the operator response.

### Reliability plane

Versioned policies evaluate provider-route health, operation success and latency, telemetry coverage, and projection freshness. Incidents use stable fingerprints and the existing retry-safe alert delivery mechanism. Observation and control remain separate.

## Delivery increments

### Increment 1 — trustworthy investigation

- Add an indexed subject read path to every event-store adapter and the production database.
- Add a pure operation-trace projector and authenticated operation-trace endpoint.
- Add snapshot coverage metrics and normalized failure breakdowns.
- Add an operation investigation drawer and instrumentation-quality panel to the live cockpit.
- Prove tenant isolation, out-of-order handling, contradictions, missing lifecycle facts, cache invalidation, and database query shape.

### Increment 2 — universal producer adapter

- Publish the framework-neutral Node/TypeScript recorder and transport interfaces.
- Provide an in-memory conformance transport and a bounded HTTP transport.
- Publish the adapter conformance runner and a minimal integration example.
- Move Phosphene mapping behind the adapter and reach at least 95% operation attempt coverage on newly emitted production operations.

### Increment 3 — SLO and incident intelligence

- Add versioned tenant reliability policies for operation failure rate, latency, coverage, and freshness.
- Extend incident evaluation and existing webhook delivery to those policies.
- Add incident evidence, acknowledgement ownership, and recovery history to the cockpit.

### Increment 4 — cost and fleet intelligence

- Add immutable cost-adjustment observations in the next compatible contract version.
- Reconcile estimates, provider reports, and billing facts without mutating execution history.
- Add per-operation, per-route, and per-model unit economics and anomaly detection.

## Increment 1 acceptance criteria

- An authenticated operator can open any retained operation shown in the cockpit and see its trace without exposing raw event payloads.
- The lookup is tenant scoped at both application and database query boundaries.
- A trace of up to 1,000 observations is deterministic under duplicate delivery and out-of-order arrival; truncation is explicit.
- Snapshot coverage reports accepted operations, terminal operations, operations with attempts, paired attempt lifecycles, classified operation failures, and costed terminal attempts as numerator, denominator, and ratio.
- Failure breakdowns include `unknown` rather than hiding missing normalization.
- Existing materialized snapshots without the new projection shape are rejected and rebuilt.
- Memory, file, and Supabase event readers implement the same subject lookup interface.
- Unit, contract, route-source, PostgreSQL migration, lint, type, and production builds pass.

## Release gates

- No cross-tenant trace access in adapter tests or endpoint construction.
- No raw prompt, media, identity, credential, raw error, or stack data in new responses.
- New database migration is additive, indexed, RLS-preserving, and exercised against PostgreSQL before production.
- Existing ingest, cockpit authentication, incident delivery, projection rebuild, and readiness behavior remain green.
- Production deployment is verified with authenticated real data after merge.

## Deferred decisions

- A browser SDK is deferred until the server-side adapter establishes delivery and privacy semantics.
- Automatic provider rerouting is deferred to a separate control-plane specification.
- Cross-currency aggregation is forbidden until an explicit exchange-rate evidence model exists.
- Billing reconciliation requires a compatible additive event contract and is not simulated from catalog estimates.
