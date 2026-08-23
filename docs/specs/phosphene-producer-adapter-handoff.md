# Phosphene to SignalOps producer adapter handoff

Status: implementation handoff
Contract: SignalOps Canonical AI Telemetry V1
Producer: `@signalops/producer-node` 0.1.x

## Outcome

New Phosphene generation operations produce complete, privacy-safe operation and provider-attempt
lifecycles through the same public adapter and conformance suite available to every future client.
SignalOps must not import Phosphene models, provider configuration, or routing code.

## Ownership boundary

Phosphene owns job execution, provider connections, routing, durable source records, credentials,
prompts, media, and user identity. The adapter translates durable lifecycle facts into canonical
events. SignalOps owns validation, idempotent ingest, tenant isolation, projections, traces,
coverage, incidents, retention, and operator access.

SignalOps remains observation-only. Do not add callbacks that let it select, disable, or reroute a
Phosphene provider.

## Required mapping

| Phosphene fact | SignalOps V1 fact | Requirement |
| --- | --- | --- |
| Generation accepted into durable work | operation accepted | Emit after the source transaction commits. |
| Generation/job ID | operation ID | Opaque, stable, non-user identifier. |
| Product task type | operation kind | Map to image, video, text, embedding, transcription, training, or other. |
| Product model class | logical model key | Do not infer the provider route from this value. |
| One outbound provider call | attempt started | Every retry and fallback receives a new attempt ID and increasing number. |
| Provider connection record | provider key | Use the connection identity, not only the vendor name. |
| Vendor and exact upstream model | route metadata | Preserve vendor, provider model, and region when known. |
| Provider call result | attempt terminal | Record outcome, normalized failure, duration, output units, and explicit cost evidence. |
| Final durable job state | operation terminal | Exactly one success, failure, cancellation, expiry, or abandonment boundary. |

Use the source database timestamps when replaying or retrying telemetry. Stable event IDs do not
make a changed timestamp idempotent; the same event ID with a changed payload is an ingest conflict.

## Delivery integration

Keep Phosphene's durable outbox as the production transport boundary. Implement
`SignalOpsProducerTransportV1` over that outbox, or enqueue the SDK-produced canonical event in the
same source transaction as the lifecycle change. The built-in HTTP transport is appropriate for
long-lived Node processes and tests, but an in-memory queue alone is not a durable serverless
delivery guarantee.

The outbox worker may use `createSignalOpsHttpTransportV1` for bounded batches, receipt
reconciliation, timeout, retry, and dead-letter classification. A delivery failure must never
change a generation outcome. Store only the canonical event and delivery metadata; never store the
ingest credential in an outbox row.

## Failure mapping

Create one explicit translator from Phosphene/provider error codes to the closed V1 taxonomy. It
returns only:

- category;
- responsibility;
- stable code;
- retryability.

Unknown inputs map to `unknown`; they do not fall back to a message. Never send raw provider error
text, request/response bodies, stack traces, prompt text, media URLs, email, user/account ID, IP,
authorization headers, or provider credentials.

## Cutover

1. Pin exact SignalOps package versions and run `runSignalOpsProducerConformanceV1` in Phosphene CI.
2. Exercise the adapter against `POST /v1/events/validate` with production-shaped fixtures and no
   storage. Do not shadow-write the same lifecycle boundaries into production ingest.
3. Assign one instrumentation implementation per operation at acceptance time. Existing in-flight
   operations finish with their assigned emitter; new canary operations use the SDK. Never choose
   the emitter independently at each lifecycle boundary.
4. Roll out the new-operation cohort at 5%, 25%, and 100%. Hold each stage until its telemetry SLO
   and ingest conflict checks are green.
5. Remove the old event construction only after the 100% cohort remains healthy for a full
   operation-retention window appropriate to the longest generation type.

Dual-writing old and new emitters to production is forbidden because their event identifiers differ
and duplicate boundaries would create contradictory evidence.

## Acceptance gates for newly accepted operations

- Operation acceptance and terminal coverage: at least 99%.
- Operations with explicit provider attempts: at least 95%; pre-provider failures are classified
  separately rather than disguised as attempts.
- Paired attempt start/terminal coverage: at least 99%.
- Failure category and responsibility coverage: at least 95% of failed operations.
- Stable failure code coverage: at least 95% of failed operations.
- Ingest conflicts: zero.
- Unresolved dead letters older than 15 minutes: zero.
- Canonical privacy fixture violations: zero.
- Customer generation latency and outcome remain unchanged within the normal deployment envelope.

Measure these gates on a cutover cohort or `acceptedAt` boundary. Historical Phosphene rows cannot
be made complete by guessing provider routes or failure causes.

## Rollback

If a gate fails, route only newly accepted operations back to the previous emitter. Let existing
operations finish with the emitter assigned at acceptance. Preserve failed canonical events in the
outbox/dead-letter store and replay them with their original event IDs and timestamps after the fix.
Do not rewrite or delete already accepted SignalOps observations.
