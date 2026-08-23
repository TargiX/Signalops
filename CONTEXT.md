# SignalOps domain language

## Observation

An immutable, tenant-scoped fact emitted by a source application and accepted under a versioned canonical telemetry contract. An observation never commands a source application to change routing or execution.

## Operation

A customer-visible AI task from acceptance to one terminal outcome. An operation may require zero or more provider attempts and is identified by an opaque, source-assigned identifier.

## Attempt

One concrete invocation of a provider route for an operation. Retries and fallbacks are separate attempts with stable identifiers and increasing attempt numbers.

## Route

The provider connection and exact model used by an attempt. A route is observed execution evidence, not a desired routing rule.

## Provider connection

A client-defined connection identity represented by a provider key. It may refer to a direct vendor account, gateway, region, or other independently operated path; the vendor name alone is not its identity.

## Operation trace

The ordered, privacy-safe lifecycle evidence for one operation and its attempts, including route, outcome, duration, cost evidence, and telemetry integrity.

## Telemetry coverage

The measured proportion of expected lifecycle evidence that is present for a population. Coverage is reported explicitly and is never inferred from logical model names.

## Failure classification

A normalized category, responsibility, stable code, and optional retryability attached to an unsuccessful terminal outcome. Raw provider errors are not failure classifications and are not stored.

## Cost evidence

A currency amount with explicit provenance: provider reported, catalog estimated, or billing reconciled. Amounts in different currencies or with different provenance are never silently combined.

## Incident

A stable, policy-derived operational condition with a lifecycle of its own. An incident is derived from observations and is not asserted by a producer.

## Tenant

The isolation boundary for observations, projections, incidents, operators, and credentials.

## Operator

An authenticated person with a tenant membership and a role who can inspect SignalOps data. An operator identity is separate from a source application's ingest credential.

## Producer adapter

A client-side implementation that translates an application's operation and attempt lifecycles into canonical observations without exposing application-specific data to SignalOps.

## Avoided terms

- **Job** when the intended concept is an operation; source systems may use “job” for unrelated queues or records.
- **Provider** when the intended concept is a provider connection; a vendor can have multiple independently operated connections.
- **Health event** for an observation; health is derived by policy.
- **Error message** for a failure classification; raw errors can contain secrets or personal data.
